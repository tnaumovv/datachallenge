/** One synthetic request. No imported conversations, secrets or provider prose in output. */
import { providerFromEnv } from '../../server/src/evaluations/config.js';
import { validateCandidate } from '../../server/src/evaluations/candidate.js';
import { defaultChecklist } from '../../server/src/checklists/default.js';
import type { Conversation, ChecklistVersion } from '../../shared/contracts.js';
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
const provider = providerFromEnv({ ...process.env, AI_PROVIDER: 'gemini' })!;
const started = Date.now();
try {
  const response = await provider.generate({
    conversation,
    checklist,
    signal: AbortSignal.timeout(60000),
    policyVersion: 'facts-first-v1',
  });
  if (response.blockReason || response.finishReason !== 'STOP')
    throw new Error('INCOMPLETE_RESPONSE');
  const output = validateCandidate(JSON.parse(response.text), conversation, checklist);
  console.log(
    JSON.stringify({
      success: true,
      assessments: output.assessments.map((a) => a.status),
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
