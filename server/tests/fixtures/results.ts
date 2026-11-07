import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  ChecklistVersion,
  Conversation,
  CriterionAnswer,
  Evaluation,
  SourceConversation,
} from '../../../shared/contracts.js';
import { ChecklistService } from '../../src/checklists/service.js';
import { ConversationService } from '../../src/conversations/service.js';
import { scoreEvaluation } from '../../src/evaluations/scoring.js';

/** Fictional persisted data for exporter tests. Never a submission or quality label. */
export const fixtureAnswers: CriterionAnswer[] = [
  ['contact', true, 'Оператор поздоровался и представился.', [4], [], null],
  [
    'needs',
    'NA',
    'Клиент сразу ясно изложил вопрос.',
    [],
    [1],
    'Клиент сразу ясно изложил вопрос.',
  ],
  [
    'identity',
    'NA',
    'Общий вопрос не требует идентификации.',
    [],
    [1],
    'Общий вопрос не требует идентификации.',
  ],
  ['consultation', 15, 'Основной вопрос решён, упущена деталь.', [5], [6], null],
  ['empathy', true, 'Вежливо признал неудобство клиента.', [4, 5], [], null],
  ['dialogue', 7, 'Есть повтор, но ход диалога понятен.', [5, 6], [], null],
  ['closing', true, 'Предложил дальнейшую помощь и попрощался.', [8], [], null],
  ['gross', false, 'Грубых нарушений в репликах нет.', [], [4, 5, 6, 8], null],
].map(([criterionId, value, explanation, evidence, checked, naReason]) => ({
  criterionId: criterionId as string,
  value: value as CriterionAnswer['value'],
  explanation: explanation as string,
  evidenceMessageIds: (evidence as number[]).map((n) => `m${String(n).padStart(4, '0')}`),
  checkedSpanMessageIds: (checked as number[]).map((n) => `m${String(n).padStart(4, '0')}`),
  naReason: naReason as string | null,
}));

export function fixtureEvaluation(
  conversationId: string,
  checklist: ChecklistVersion,
  overrides: Partial<Evaluation> = {},
): Evaluation {
  const answers = structuredClone(fixtureAnswers);
  const score = scoreEvaluation(checklist.criteria, answers);
  return {
    id: randomUUID(),
    conversationId,
    checklistVersionId: checklist.id,
    providerId: 'gemini',
    modelId: 'fixture-model-alias',
    configurationId: 'fixture-v1',
    promptVersion: 'fixture-v1',
    status: 'completed',
    retryOfId: null,
    createdAt: '2026-11-07T00:00:00.000Z',
    startedAt: '2026-11-07T00:00:00.000Z',
    finishedAt: '2026-11-07T00:00:01.000Z',
    originalAnswers: answers,
    effectiveAnswers: structuredClone(answers),
    evidence: [],
    originalScore: score,
    finalScore: structuredClone(score),
    attempts: [
      {
        number: 1,
        startedAt: '2026-11-07T00:00:00.000Z',
        finishedAt: '2026-11-07T00:00:01.000Z',
        durationMs: 1000,
        status: 'completed',
        errorCode: null,
        failureStage: null,
        finishReason: 'STOP',
        blockReason: null,
        validationErrors: [],
        modelVersion: 'fixture-model-001',
        usage: { inputTokens: 10, outputTokens: 10, thinkingTokens: 0, totalTokens: 20 },
      },
    ],
    usage: { calls: 1, inputTokens: 10, outputTokens: 10, thinkingTokens: 0, totalTokens: 20 },
    error: null,
    ...overrides,
  };
}

export function insertEvaluation(db: DatabaseSync, evaluation: Evaluation): void {
  db.prepare('INSERT INTO evaluations VALUES (?,?,?,?,?,?)').run(
    evaluation.id,
    evaluation.conversationId,
    evaluation.checklistVersionId,
    randomUUID(),
    evaluation.status,
    JSON.stringify(evaluation),
  );
}

export function updateEvaluation(db: DatabaseSync, evaluation: Evaluation): void {
  db.prepare('UPDATE evaluations SET status=?,payload=? WHERE id=?').run(
    evaluation.status,
    JSON.stringify(evaluation),
    evaluation.id,
  );
}

export function seedResults(
  db: DatabaseSync,
  group: 'DEV' | 'PROD' = 'PROD',
  sourceGroup: string = group,
) {
  const checklist = new ChecklistService(db).seed();
  const records: SourceConversation[] = Array.from(
    { length: group === 'DEV' ? 65 : 10 },
    (_, i) => ({
      conversation_id: `fixture-${String(i + 1).padStart(3, '0')}`,
      channel: group === 'DEV' && i >= 60 ? 'voice call' : 'agent chat',
      language: 'RU',
      audio_url: null,
      transcript: [
        'client',
        'bot',
        'system',
        'operator',
        'operator',
        'operator',
        'client',
        'operator',
      ].map((speaker, turn) => ({
        speaker: speaker as SourceConversation['transcript'][number]['speaker'],
        timestamp: `00:${String(turn).padStart(2, '0')}`,
        text: `Вымышленная тестовая реплика ${turn + 1}`,
      })),
    }),
  );
  const service = new ConversationService(db);
  const imported = service.importRecords(sourceGroup, records);
  const conversations: Conversation[] = imported.conversationIds.map((id) => service.get(id)!);
  const evaluations = conversations.map((c) => fixtureEvaluation(c.id, checklist));
  for (const evaluation of evaluations) insertEvaluation(db, evaluation);
  return {
    checklist,
    records,
    conversations,
    evaluations,
    options: { group, sourceGroup, teamName: 'Fixture team', checklistVersionId: checklist.id },
  };
}
