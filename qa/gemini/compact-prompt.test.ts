import { expect, it } from 'vitest';
import { buildEvaluationPrompt } from './compact-prompt.js';
import { defaultChecklist } from '../../server/src/checklists/default.js';
import type { ChecklistVersion, Conversation } from '../../shared/contracts.js';

it('preserves complete ordered dialogue, custom rules, scales and repair feedback', () => {
  const conversation: Conversation = {
    id: 'c',
    sourceConversationId: 's',
    groupId: 'DEV',
    transcriptHash: 'h',
    channel: 'agent chat',
    language: 'KZ',
    audioUrl: null,
    importedAt: 'now',
    messages: [
      { id: 'm0001', speaker: 'client', text: 'Сұрақ', timestamp: '00:01' },
      { id: 'm0002', speaker: 'operator', text: 'Ответ', timestamp: '00:02' },
    ],
  };
  const checklist: ChecklistVersion = {
    ...structuredClone(defaultChecklist),
    id: 'v',
    checklistId: 'custom',
    version: 2,
    createdAt: 'now',
  };
  const criterion = checklist.criteria.find((c) => c.id === 'consultation')!;
  criterion.instruction = 'Проверь подтверждение клиентом';
  criterion.levels = [0, 50, 100];
  criterion.levelDescriptions = { '0': 'Нет', '50': 'Частично', '100': 'Да' };
  const repair = { failureStage: 'schema' as const, finishReason: 'STOP', validationErrors: [] };
  const prompt = buildEvaluationPrompt(conversation, checklist, repair);
  const input = JSON.parse(prompt.user);
  expect(input.conversation.messages).toEqual(conversation.messages);
  expect(input.conversation.language).toBe('KZ');
  expect(
    input.checklist.criteria.find((c: { id: string }) => c.id === 'consultation'),
  ).toMatchObject({
    instruction: 'Проверь подтверждение клиентом',
    levels: [0, 50, 100],
    levelDescriptions: { '0': 'Нет', '50': 'Частично', '100': 'Да' },
  });
  expect(input.repair).toEqual(repair);
  // The old 20/5 scoring example must not override a user's new scale.
  expect(prompt.system).not.toContain('решению (20)');
});
