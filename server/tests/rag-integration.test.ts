import { afterEach, expect, it } from 'vitest';
import { createDatabase } from '../src/db.js';
import { KnowledgeService } from '../src/knowledge/service.js';
import { ConversationService } from '../src/conversations/service.js';
import { ChecklistService } from '../src/checklists/service.js';
import { EvaluationService } from '../src/evaluations/service.js';
import type { EvaluationProvider, ProviderInput } from '../src/evaluations/provider.js';
import { demoImport, scoreExampleAnswers } from '../../shared/fixtures.js';
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup.length = 0;
});
function setup() {
  const db = createDatabase(':memory:');
  cleanup.push(() => db.close());
  const knowledge = new KnowledgeService(db);
  const imported = new ConversationService(db).importRecords(
    'TEST',
    demoImport.source === 'json' ? demoImport.records : [],
  );
  const checklist = new ChecklistService(db).seed();
  const calls: ProviderInput[] = [];
  const provider: EvaluationProvider = {
    id: 'test',
    modelId: 'test',
    configurationId: 'test',
    generate: async (input) => {
      calls.push(input);
      return {
        text: JSON.stringify({
          answers: scoreExampleAnswers.map((a) => ({
            ...a,
            explanation: 'Обосновано репликой оператора.',
            evidenceMessageIds: a.value === 'NA' ? [] : ['m0002'],
            checkedSpanMessageIds:
              a.value === 'NA' ? ['m0001'] : a.value === false ? ['m0002', 'm0004'] : [],
          })),
        }),
        usage: {},
      };
    },
  };
  const s = new EvaluationService(db, provider);
  cleanup.push(() => s.stop());
  return { db, knowledge, s, calls, conversationId: imported.conversationIds[0], checklist };
}
const rule = {
  documentKey: 'history',
  title: 'История операций',
  source: 'Учебная фикстура теста',
  version: '1',
  language: 'RU',
  text: 'История операций доступна в разделе «Операции».',
  active: true,
};
it('freezes RAG context at enqueue and invalidates cache when the selected version changes', async () => {
  const { knowledge, s, calls, conversationId, checklist } = setup();
  const first = knowledge.create(rule);
  const [id] = s.enqueue([conversationId], checklist.id);
  expect(s.get(id)).toHaveProperty('knowledge.sources.0.version', '1');
  expect(s.enqueue([conversationId], checklist.id)).toEqual([id]);
  knowledge.setActive(first.id, false);
  knowledge.create({ ...rule, version: '2', text: 'История операций доступна в меню «История».' });
  const [next] = s.enqueue([conversationId], checklist.id);
  expect(next).not.toBe(id);
  s.start();
  for (
    let i = 0;
    (i < 100 && s.get(next)?.status === 'queued') || (i < 100 && s.get(next)?.status === 'running');
    i++
  )
    await new Promise((r) => setTimeout(r, 5));
  expect(s.get(id)?.status).toBe('completed');
  expect(calls[0]).toHaveProperty('knowledge.sources.0.version', '1');
  expect(calls[1]).toHaveProperty('knowledge.sources.0.version', '2');
});
it('rejects fabricated references even in unresolved candidate assessments', async () => {
  const { db, knowledge, conversationId, checklist } = setup();
  knowledge.create(rule);
  const p: EvaluationProvider = {
    id: 'candidate',
    modelId: 'test',
    configurationId: 'test',
    generate: async () => ({
      text: JSON.stringify({
        observations: [],
        assessments: checklist.criteria.map((c) => ({
          status: 'unresolved',
          criterionId: c.id,
          reasonCode: 'unknown',
          explanation: 'Неоднозначно по правилу [K99].',
          checkedSpanMessageIds: ['m0001'],
        })),
      }),
      usage: {},
    }),
  };
  const s = new EvaluationService(db, p, { candidate: true, retryDelayMs: 0 });
  cleanup.push(() => s.stop());
  const [id] = s.enqueue([conversationId], checklist.id);
  s.start();
  for (let i = 0; i < 100 && ['queued', 'running'].includes(s.get(id)!.status); i++)
    await new Promise((r) => setTimeout(r, 5));
  expect(s.get(id)?.error?.code).toBe('INVALID_MODEL_OUTPUT');
  expect(s.get(id)?.attempts.every((a) => a.status === 'failed')).toBe(true);
});

it('retains the saved RAG snapshot and its citations in rubric-v7 evaluations', async () => {
  const { db, knowledge, conversationId, checklist } = setup();
  knowledge.create(rule);
  const version = new ChecklistService(db).save(checklist.checklistId, {
    ...checklist,
    criteria: checklist.criteria.filter((c) => c.id === 'contact'),
  });
  const p: EvaluationProvider = {
    id: 'rubric-test',
    modelId: 'test',
    configurationId: 'v7',
    outputFormat: 'rubric-v7',
    promptVersion: 'cqa-evaluator-v7',
    generate: async (input) => ({
      text: JSON.stringify({
        answers: {
          contact: {
            evidenceMessageIds: ['m0002'],
            checkedSpanMessageIds: ['m0001', 'm0002'],
            facts: { greetedInClientLanguage: true, introducedSelf: true },
            knowledgeReferenceIds: [input.knowledge!.sources[0].reference],
          },
        },
      }),
      usage: {},
    }),
  };
  const s = new EvaluationService(db, p, { retryDelayMs: 0 });
  cleanup.push(() => s.stop());
  const [id] = s.enqueue([conversationId], version.id);
  s.start();
  for (let i = 0; i < 100 && ['queued', 'running'].includes(s.get(id)!.status); i++)
    await new Promise((r) => setTimeout(r, 5));
  expect(s.get(id)?.status).toBe('completed');
  expect(s.get(id)?.originalAnswers[0]).toMatchObject({
    value: true,
    explanation: expect.stringContaining('[K1]'),
  });
  expect(s.get(id)?.knowledge?.sources[0].version).toBe('1');
});
