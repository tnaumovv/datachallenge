import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  ChecklistInputSchema,
  CriterionAnswerSchema,
  GroupIdSchema,
  SourceConversationSchema,
} from '../../../shared/contracts.js';
import { formatCompletedEvaluation, standardCriteria, type ResultsDocument } from './format.js';

const OptionsSchema = z.strictObject({
  group: z.enum(['DEV', 'PROD']),
  sourceGroup: GroupIdSchema.optional(),
  teamName: z.string().trim().min(1),
  checklistVersionId: z.string().min(1),
});
export type ExportOptions = z.input<typeof OptionsSchema>;

// Explicit production adapters only. CompatibleProvider fixes cloud endpoints
// and constrains Ollama to a loopback endpoint and local model names.
const providerModes = new Map<string, 'local' | 'external_api'>([
  ['gemini', 'external_api'],
  ['groq', 'external_api'],
  ['openai', 'external_api'],
  ['deepseek', 'external_api'],
  ['ollama', 'local'],
]);

const ConversationSchema = z.object({
  id: z.string().min(1),
  sourceConversationId: z.string().min(1),
  groupId: GroupIdSchema,
  channel: SourceConversationSchema.shape.channel,
  messages: z
    .array(
      z.object({
        id: z.string().min(1),
        timestamp: z.string().min(1),
        speaker: z.enum(['client', 'operator', 'bot', 'system']),
        text: z.string(),
      }),
    )
    .min(1),
});
const EvaluationSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  checklistVersionId: z.string().min(1),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  providerId: z.string().min(1),
  modelId: z.string().trim().min(1),
  originalAnswers: z.array(CriterionAnswerSchema),
  originalScore: z.object({ total: z.number().min(0).max(100).nullable() }).nullable(),
  attempts: z.array(
    z.object({
      status: z.enum(['running', 'completed', 'failed']),
      modelVersion: z.string().trim().min(1).nullable().optional(),
    }),
  ),
  error: z.object({ code: z.string().trim().min(1), message: z.string().trim().min(1) }).nullable(),
});

/** Only SELECTs inside a consistent read transaction; never initializes queues, providers or schema. */
export function exportResults(db: DatabaseSync, input: ExportOptions): ResultsDocument {
  const options = OptionsSchema.parse(input);
  const sourceGroup = options.sourceGroup ?? options.group;
  db.exec('BEGIN');
  try {
    const rows = db
      .prepare(
        'SELECT id,group_id,source_id,payload FROM conversations WHERE group_id=? ORDER BY rowid',
      )
      .all(sourceGroup);
    const conversations = rows.map((row) => {
      const c = ConversationSchema.parse(JSON.parse(row.payload as string));
      if (c.id !== row.id || c.groupId !== row.group_id || c.sourceConversationId !== row.source_id)
        throw new Error('Inconsistent conversation metadata: payload/column mismatch');
      return c;
    });
    const sourceIds = new Set<string>();
    for (const c of conversations) {
      if (sourceIds.has(c.sourceConversationId))
        throw new Error(`Duplicate source conversation_id: ${c.sourceConversationId}`);
      sourceIds.add(c.sourceConversationId);
    }
    const expectedCount = options.group === 'DEV' ? 65 : 10;
    if (conversations.length !== expectedCount)
      throw new Error(
        `${options.group} requires a count of exactly ${expectedCount}; found ${conversations.length}`,
      );
    const chats = conversations.filter((c) => c.channel === 'agent chat').length;
    const calls = conversations.length - chats;
    if (
      chats !== (options.group === 'DEV' ? 60 : 10) ||
      calls !== (options.group === 'DEV' ? 5 : 0)
    )
      throw new Error(
        `${options.group} channel composition must be ${options.group === 'DEV' ? '60 chats and 5 calls' : '10 chats'}`,
      );

    const checklistRow = db
      .prepare('SELECT payload FROM checklist_versions WHERE id=?')
      .get(options.checklistVersionId);
    if (!checklistRow) throw new Error('Selected checklist version does not exist');
    const checklistPayload = JSON.parse(checklistRow.payload as string);
    if (checklistPayload.id !== options.checklistVersionId)
      throw new Error('Checklist payload/column mismatch');
    const checklist = standardCriteria(ChecklistInputSchema.parse(checklistPayload));

    const history = db
      .prepare(
        `
      SELECT e.id,e.conversation_id,e.checklist_version_id,e.status,e.payload
      FROM evaluations e JOIN conversations c ON c.id=e.conversation_id
      WHERE c.group_id=? AND e.checklist_version_id=? ORDER BY e.rowid DESC
    `,
      )
      .all(sourceGroup, options.checklistVersionId);
    const latest = new Map<string, (typeof history)[number]>();
    for (const row of history)
      if (!latest.has(row.conversation_id as string))
        latest.set(row.conversation_id as string, row);

    const models = new Set<string>();
    const modes = new Set<'local' | 'external_api'>();
    const results = conversations.map((conversation): ResultsDocument['results'][number] => {
      const row = latest.get(conversation.id);
      if (!row)
        throw new Error(`Missing persisted evaluation: ${conversation.sourceConversationId}`);
      const e = EvaluationSchema.parse(JSON.parse(row.payload as string));
      if (
        e.id !== row.id ||
        e.conversationId !== conversation.id ||
        e.checklistVersionId !== row.checklist_version_id ||
        e.status !== row.status
      )
        throw new Error(`Evaluation payload/column mismatch: ${conversation.sourceConversationId}`);
      if (e.status !== 'completed' && e.status !== 'failed')
        throw new Error(
          `Latest evaluation is ${e.status}, not terminal: ${conversation.sourceConversationId}`,
        );
      const mode = providerModes.get(e.providerId);
      if (!mode) throw new Error(`Unsupported provider mode: ${e.providerId}`);
      for (const attempt of e.attempts) {
        models.add(attempt.modelVersion ?? e.modelId);
        modes.add(mode);
      }
      if (e.status === 'failed') {
        if (!e.error)
          throw new Error(
            `Failed evaluation has no saved error reason: ${conversation.sourceConversationId}`,
          );
        return {
          conversation_id: conversation.sourceConversationId,
          status: 'error',
          criteria: [],
          score: null,
          error: `${e.error.code}: ${e.error.message}`,
        };
      }
      if (!e.attempts.some((a) => a.status === 'completed'))
        throw new Error(
          `Completed evaluation has no completed model attempt: ${conversation.sourceConversationId}`,
        );
      return formatCompletedEvaluation(conversation, e, checklist);
    });
    if (!models.size) throw new Error('No actually attempted model is recorded in this dataset');
    const document: ResultsDocument = {
      schema_version: '1.0',
      team_name: options.teamName,
      model: {
        mode: modes.size > 1 ? 'hybrid' : modes.values().next().value!,
        name: [...models].sort().join(', '),
      },
      results,
    };
    db.exec('COMMIT');
    return document;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
