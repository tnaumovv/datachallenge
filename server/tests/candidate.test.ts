import { ProviderError } from '../src/evaluations/provider.js';
import { it, expect, vi } from 'vitest';
import { createDatabase } from '../src/db.js';
import { ConversationService } from '../src/conversations/service.js';
import { ChecklistService } from '../src/checklists/service.js';
import { EvaluationService } from '../src/evaluations/service.js';
import { DecisionService } from '../src/review/service.js';
import { demoImport, scoreExampleAnswers } from '../../shared/fixtures.js';
import { validateCandidate } from '../src/evaluations/candidate.js';
function setup() {
  const db = createDatabase(':memory:');
  const conversations = new ConversationService(db);
  const id = conversations.importRecords(
    'TEST',
    demoImport.source === 'json' ? demoImport.records : [],
  ).conversationIds[0];
  return {
    db,
    id,
    conversation: conversations.get(id)!,
    checklist: new ChecklistService(db).seed(),
  };
}
const answers = () =>
  scoreExampleAnswers.map((a) => ({
    ...a,
    explanation: 'Обосновано репликой оператора.',
    evidenceMessageIds: a.value === 'NA' ? [] : ['m0002'],
    checkedSpanMessageIds:
      a.value === 'NA' ? ['m0001'] : a.value === false ? ['m0002', 'm0004'] : [],
  }));
async function settle(s: EvaluationService, id: string) {
  for (let i = 0; i < 200; i++) {
    const e = s.get(id)!;
    if (e.status === 'failed' || e.status === 'completed') return e;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw Error('not settled');
}
it('requires exact coverage and does not turn unknown into NA', () => {
  const c = setup();
  try {
    expect(() =>
      validateCandidate({ observations: [], assessments: [] }, c.conversation, c.checklist),
    ).toThrow();
    const assessments = c.checklist.criteria.map((x) => ({
      status: 'unresolved',
      criterionId: x.id,
      reasonCode: 'unknown',
      explanation: 'Недостаточно данных',
      checkedSpanMessageIds: ['m0001'],
    }));
    expect(
      validateCandidate({ observations: [], assessments }, c.conversation, c.checklist).assessments,
    ).toHaveLength(c.checklist.criteria.length);
  } finally {
    c.db.close();
  }
});
it('stores unresolved separately, blocks export completion and journals defer/idempotency/conflicts', async () => {
  const c = setup();
  const p = {
    id: 'test',
    modelId: 'test',
    configurationId: 'test',
    generate: async () => ({
      usage: {},
      text: JSON.stringify({
        observations: [],
        assessments: c.checklist.criteria.map((x) => ({
          status: 'unresolved',
          criterionId: x.id,
          reasonCode: 'unknown',
          explanation: 'Недостаточно данных',
          checkedSpanMessageIds: ['m0001'],
        })),
      }),
    }),
  };
  const s = new EvaluationService(c.db, p, { candidate: true });
  try {
    s.start();
    const id = s.enqueue([c.id], c.checklist.id)[0];
    const e = await settle(s, id);
    expect(e.status).toBe('failed');
    expect(e.error?.code).toBe('REVIEW_REQUIRED');
    expect(e.finalScore).toBeNull();
    expect(e.originalAnswers).toEqual([]);
    expect(c.db.prepare('SELECT * FROM evaluation_runs').all()).toHaveLength(1);
    const d = new DecisionService(c.db);
    const input = {
      expectedRevision: 0,
      idempotencyKey: 'one',
      action: 'defer',
      reason: 'Нужны данные',
    };
    const result = d.apply(id, input);
    expect(result.revision).toBe(1);
    expect(d.apply(id, input)).toEqual(result);
    expect(() => d.apply(id, { ...input, idempotencyKey: 'two' })).toThrow('reload');
    expect(d.list()[0].status).toBe('open');
  } finally {
    await s.stop();
    c.db.close();
  }
});
it('uses an independent targeted verifier, preserves original and requires human for gross', async () => {
  const c = setup();
  const original = answers();
  original.find((a) => a.criterionId === 'gross')!.value = true;
  const output = {
    observations: [],
    assessments: original.map((answer) => ({ status: 'resolved', answer })),
  };
  let verifierIds: string[] = [];
  const p = {
    id: 'test',
    modelId: 'test',
    configurationId: 'test',
    generate: async () => ({ usage: {}, text: JSON.stringify(output) }),
  };
  const verifier = {
    ...p,
    id: 'independent',
    generate: async (input: any) => {
      verifierIds = input.checklist.criteria.map((x: any) => x.id);
      expect(JSON.stringify(input)).not.toContain('originalAnswers');
      return {
        usage: {},
        text: JSON.stringify({
          ...output,
          assessments: output.assessments.filter((a) => verifierIds.includes(a.answer.criterionId)),
        }),
      };
    },
  };
  const s = new EvaluationService(c.db, p, { candidate: true, verifier });
  try {
    s.start();
    const id = s.enqueue([c.id], c.checklist.id)[0];
    const e = await settle(s, id);
    expect(e.error?.code).toBe('REVIEW_REQUIRED');
    expect(e.attempts).toHaveLength(2);
    expect(verifierIds.length).toBeLessThan(c.checklist.criteria.length);
    expect(e.finalScore).toBeNull();
  } finally {
    await s.stop();
    c.db.close();
  }
});

it('bounds retry + repair + verifier to four calls and disagreements stay failed', async () => {
  const c = setup();
  let calls = 0;
  const output = {
    observations: [],
    assessments: answers().map((answer) => ({ status: 'resolved', answer })),
  };
  output.assessments.find((a) => a.answer.criterionId === 'gross')!.answer.value = true;
  const p = {
    id: 'test',
    modelId: 'test',
    configurationId: 'test',
    generate: async () => {
      calls++;
      if (calls === 1) throw new ProviderError('RATE_LIMIT', true, 0);
      return { usage: {}, text: calls === 2 ? '{}' : JSON.stringify(output) };
    },
  };
  const verifier = {
    ...p,
    id: 'independent',
    generate: async (input: any) => {
      calls++;
      return {
        usage: {},
        text: JSON.stringify({
          observations: [],
          assessments: output.assessments
            .filter((a) => input.checklist.criteria.some((c: any) => c.id === a.answer.criterionId))
            .map((a) => ({
              ...a,
              answer: {
                ...a.answer,
                value: a.answer.value === 'NA' ? true : a.answer.value,
                naReason: null,
                evidenceMessageIds: ['m0002'],
              },
            })),
        }),
      };
    },
  };
  const s = new EvaluationService(c.db, p, { candidate: true, verifier, retryDelayMs: 0 });
  try {
    s.start();
    const e = await settle(s, s.enqueue([c.id], c.checklist.id)[0]);
    expect(calls).toBe(4);
    expect(e.error?.code).toBe('REVIEW_REQUIRED');
    expect(e.reviewReasons).toContain('verifier_disagreement');
    expect(e.finalScore).toBeNull();
  } finally {
    await s.stop();
    c.db.close();
  }
});

it('does not publish even matching verdicts when observed chronology contradicts standard identity rule', async () => {
  const c = setup();
  const original = answers();
  original.find((a) => a.criterionId === 'identity')!.value = true;
  original.find((a) => a.criterionId === 'identity')!.naReason = null;
  original.find((a) => a.criterionId === 'identity')!.evidenceMessageIds = ['m0002'];
  const output = {
    observations: [
      { name: 'identity_verified', status: 'observed', messageIds: ['m0004'], source: 'model' },
      { name: 'protected_disclosure', status: 'observed', messageIds: ['m0002'], source: 'model' },
    ],
    assessments: original.map((answer) => ({ status: 'resolved', answer })),
  };
  const p = {
    id: 'test',
    modelId: 'test',
    configurationId: 'test',
    generate: async () => ({ usage: {}, text: JSON.stringify(output) }),
  };
  const s = new EvaluationService(c.db, p, {
    candidate: true,
    verifier: { ...p, id: 'independent' },
  });
  try {
    s.start();
    const e = await settle(s, s.enqueue([c.id], c.checklist.id)[0]);
    expect(e.error?.code).toBe('REVIEW_REQUIRED');
    expect(e.reviewReasons).toContain('disclosure_before_identity');
  } finally {
    await s.stop();
    c.db.close();
  }
});

it('publishes a complete human revision without overwriting unresolved AI original', async () => {
  const c = setup();
  const p = {
    id: 'test',
    modelId: 'test',
    configurationId: 'test',
    generate: async () => ({
      usage: {},
      text: JSON.stringify({
        observations: [],
        assessments: c.checklist.criteria.map((x) => ({
          status: 'unresolved',
          criterionId: x.id,
          reasonCode: 'unknown',
          explanation: 'Недостаточно данных',
          checkedSpanMessageIds: ['m0001'],
        })),
      }),
    }),
  };
  const s = new EvaluationService(c.db, p, { candidate: true });
  try {
    s.start();
    const id = s.enqueue([c.id], c.checklist.id)[0];
    await settle(s, id);
    const d = new DecisionService(c.db);
    const input = {
      expectedRevision: 0,
      idempotencyKey: 'publish',
      action: 'resolve',
      reason: 'Проверено человеком',
      answers: answers(),
    };
    const e = d.apply(id, input);
    expect(e.status).toBe('completed');
    expect(e.finalScore?.total).toBeTypeOf('number');
    expect(e.originalAnswers).toEqual([]);
    expect(e.originalScore).toBeNull();
    expect(e.evaluationSource).toBe('human_review');
    expect(d.list()[0].status).toBe('resolved');
    expect(() => d.apply(id, { ...input, idempotencyKey: 'concurrent' })).toThrow('reload');
  } finally {
    await s.stop();
    c.db.close();
  }
});

it('deduplicates queued requests but refuses changed verifier configuration after restart', async () => {
  const c = setup();
  let calls = 0;
  const p = {
    id: 'test',
    modelId: 'test',
    configurationId: 'test',
    generate: async () => {
      calls++;
      return { usage: {}, text: '{}' };
    },
  };
  const first = new EvaluationService(c.db, p, {
    candidate: true,
    verifier: { ...p, id: 'verifier', configurationId: 'one' },
  });
  const id = first.enqueue([c.id], c.checklist.id)[0];
  expect(first.enqueue([c.id], c.checklist.id)[0]).toBe(id);
  const restarted = new EvaluationService(c.db, p, {
    candidate: true,
    verifier: { ...p, id: 'verifier', configurationId: 'two' },
  });
  try {
    restarted.start();
    const e = await settle(restarted, id);
    expect(e.error?.code).toBe('PROVIDER_CHANGED');
    expect(calls).toBe(0);
  } finally {
    await first.stop();
    await restarted.stop();
    c.db.close();
  }
});

it('expires bounded deadline even when provider ignores abort and never resolves', async () => {
  vi.useFakeTimers();
  const c = setup();
  let calls = 0;
  const s = new EvaluationService(
    c.db,
    {
      id: 'test',
      modelId: 'test',
      configurationId: 'test',
      generate: async () => {
        calls++;
        return new Promise(() => {});
      },
    },
    { candidate: true, deadlineMs: 1000, retryDelayMs: 0 },
  );
  try {
    s.start();
    const id = s.enqueue([c.id], c.checklist.id)[0];
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1001);
    const e = s.get(id)!;
    expect(e.error?.code).toBe('TIMEOUT');
    expect(calls).toBe(1);
    expect(e.finalScore).toBeNull();
  } finally {
    await s.stop();
    c.db.close();
    vi.useRealTimers();
  }
});

it('completes ordinary valid NA without unnecessary verifier and caches the result', async () => {
  const c = setup();
  let calls = 0;
  const s = new EvaluationService(
    c.db,
    {
      id: 'test',
      modelId: 'test',
      configurationId: 'test',
      generate: async () => {
        calls++;
        return {
          usage: {},
          text: JSON.stringify({
            observations: [],
            assessments: answers().map((answer) => ({ status: 'resolved', answer })),
          }),
        };
      },
    },
    { candidate: true },
  );
  try {
    s.start();
    const id = s.enqueue([c.id], c.checklist.id)[0];
    const e = await settle(s, id);
    expect(e.status).toBe('completed');
    expect(e.finalScore?.total).toBeTypeOf('number');
    expect(calls).toBe(1);
    expect(s.enqueue([c.id], c.checklist.id)[0]).toBe(id);
  } finally {
    await s.stop();
    c.db.close();
  }
});
