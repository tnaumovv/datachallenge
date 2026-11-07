/** Synthetic records for isolated automated tests only. Never imported by the application. */
import type {
  Appeal,
  ChecklistVersion,
  Conversation,
  Evaluation,
  TokenUsage,
} from '../../shared/contracts.js';
import { defaultChecklist } from '../../server/src/checklists/default.js';
import { scoreEvaluation } from '../../server/src/evaluations/scoring.js';
import { demoImport, scoreExampleAnswers } from '../../shared/fixtures.js';

export const version: ChecklistVersion = {
  ...structuredClone(defaultChecklist),
  id: 'version-test-1',
  checklistId: 'default',
  version: 1,
  createdAt: '2026-11-07T10:00:00.000Z',
};
if (demoImport.source !== 'json') throw new Error('Tests require JSON source');
export const conversation: Conversation = {
  id: 'conversation-test-1',
  sourceConversationId: 'UI-001',
  groupId: 'UI-TEST',
  language: 'RU',
  channel: 'agent chat',
  audioUrl: null,
  transcriptHash: 'synthetic-hash',
  importedAt: '2026-11-07T10:00:00.000Z',
  messages: demoImport.records[0].transcript.map((message, index) => ({
    ...message,
    id: 'm' + String(index + 1).padStart(4, '0'),
  })),
};
const answers = scoreExampleAnswers.map((answer) => ({
  ...answer,
  explanation: answer.naReason ?? 'Иллюстративный ответ тестового провайдера.',
  evidenceMessageIds: answer.value === 'NA' ? [] : ['m0002'],
  checkedSpanMessageIds:
    answer.value === 'NA'
      ? ['m0001']
      : answer.value === false || answer.value === 0
        ? conversation.messages.map((message) => message.id)
        : [],
}));
const score = scoreEvaluation(version.criteria, answers);
const usage: TokenUsage = {
  inputTokens: null,
  outputTokens: null,
  thinkingTokens: null,
  totalTokens: null,
};
export const evaluation: Evaluation = {
  id: 'evaluation-test-1',
  conversationId: conversation.id,
  checklistVersionId: version.id,
  providerId: 'test',
  modelId: 'test-only',
  configurationId: 'test-config',
  promptVersion: 'test',
  status: 'completed',
  retryOfId: null,
  createdAt: '2026-11-07T10:01:00.000Z',
  startedAt: '2026-11-07T10:01:00.000Z',
  finishedAt: '2026-11-07T10:01:01.000Z',
  originalAnswers: structuredClone(answers),
  effectiveAnswers: structuredClone(answers),
  evidence: answers.map((answer) => ({
    criterionId: answer.criterionId,
    evidence: conversation.messages.filter((message) =>
      answer.evidenceMessageIds.includes(message.id),
    ),
    checkedSpan: conversation.messages.filter((message) =>
      answer.checkedSpanMessageIds.includes(message.id),
    ),
  })),
  originalScore: score,
  finalScore: score,
  attempts: [],
  usage: { ...usage, calls: 1 },
  error: null,
};
export const appeal: Appeal = {
  id: 'appeal-test-1',
  evaluationId: evaluation.id,
  criterionId: 'consultation',
  comment: 'В ответе есть инструкция.',
  status: 'pending',
  decision: null,
  replacementValue: null,
  reason: null,
  createdAt: '2026-11-07T10:02:00.000Z',
  resolvedAt: null,
  beforeAnswer: evaluation.effectiveAnswers.find(
    (answer) => answer.criterionId === 'consultation',
  )!,
  afterAnswer: null,
  scoreBefore: null,
  scoreAfter: null,
};
