/** One synthetic request. No imported conversations, secrets or provider prose in output. */
import { CompatibleProvider } from '../../server/src/evaluations/compatible.js';
import { defaultChecklist } from '../../server/src/checklists/default.js';
import { parseRubricOutput } from '../../server/src/evaluations/rubric.js';
import { validateEvidence } from '../../server/src/evaluations/evidence.js';
import { scoreEvaluation } from '../../server/src/evaluations/scoring.js';
import type { Conversation, ChecklistVersion } from '../../shared/contracts.js';
if (!process.env.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY in local .env');
const conversation: Conversation = {
  id: 'synthetic-smoke',
  sourceConversationId: 'synthetic-smoke',
  groupId: 'DEV',
  transcriptHash: 'synthetic',
  channel: 'agent chat',
  language: 'RU',
  audioUrl: null,
  importedAt: new Date().toISOString(),
  messages: [
    {
      id: 'm0001',
      timestamp: '00:00',
      speaker: 'client',
      text: 'Здравствуйте! Где посмотреть список тарифов?',
    },
    {
      id: 'm0002',
      timestamp: '00:01',
      speaker: 'operator',
      text: 'Здравствуйте! Меня зовут Анна, поддержка. Список тарифов находится на сайте в разделе «Тарифы».',
    },
  ],
};
const checklist: ChecklistVersion = {
  ...defaultChecklist,
  criteria: defaultChecklist.criteria.filter((c) => c.id === 'contact'),
  id: 'smoke',
  checklistId: 'smoke',
  version: 1,
  createdAt: new Date().toISOString(),
};
const provider = new CompatibleProvider({
  kind: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  modelId: process.env.OPENAI_MODEL || 'gpt-6-luna',
  reasoningEffort: 'none',
  maxOutputTokens: 1024,
});
const started = Date.now();
try {
  const response = await provider.generate({
    conversation,
    checklist,
    signal: AbortSignal.timeout(60000),
  });
  if (response.blockReason || response.finishReason !== 'STOP')
    throw new Error('INCOMPLETE_RESPONSE');
  const answers = parseRubricOutput(JSON.parse(response.text), conversation, checklist);
  scoreEvaluation(checklist.criteria, answers);
  validateEvidence(conversation, answers, checklist.criteria);
  console.log(
    JSON.stringify({
      success: true,
      provider: provider.id,
      model: provider.modelId,
      durationMs: Date.now() - started,
      usage: response.usage,
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      success: false,
      code:
        error instanceof Error && /^[A-Z_]+$/.test(error.message)
          ? error.message
          : 'SMOKE_VALIDATION_FAILED',
      durationMs: Date.now() - started,
    }),
  );
  process.exitCode = 1;
}
