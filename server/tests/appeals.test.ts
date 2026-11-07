import { afterEach, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase } from '../src/db.js';
import { ConversationService } from '../src/conversations/service.js';
import { ChecklistService } from '../src/checklists/service.js';
import { EvaluationService } from '../src/evaluations/service.js';
import { AppealService } from '../src/appeals/service.js';
import { createApp } from '../src/app.js';
import { demoImport, scoreExampleAnswers } from '../../shared/fixtures.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanups.splice(0).reverse()) await f();
});
it('rolls back evaluation update if saving the decision fails', async () => {
  const c = await setup();
  const before = c.evaluations.get(c.id);
  const a = c.appeals.submit({
    evaluationId: c.id,
    criterionId: 'consultation',
    comment: 'Проверить',
  });
  c.db.exec(
    "CREATE TRIGGER simulate_disk_failure BEFORE UPDATE ON appeals BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;",
  );
  expect(() =>
    c.appeals.resolve(a.id, { decision: 'change', replacementValue: 20, reason: 'Полный ответ' }),
  ).toThrow();
  expect(c.evaluations.get(c.id)).toEqual(before);
  expect(c.appeals.get(a.id)?.status).toBe('pending');
});
it('uses the original checklist version even after its weights are edited', async () => {
  const c = await setup();
  const e = c.evaluations.get(c.id)!;
  const config = new ChecklistService(c.db).get(e.checklistVersionId)!;
  new ChecklistService(c.db).save('default', {
    ...config,
    criteria: config.criteria.map((x) => ({
      ...x,
      weight: x.id === 'consultation' ? 100 : x.weight,
    })),
  });
  const a = c.appeals.submit({
    evaluationId: c.id,
    criterionId: 'consultation',
    comment: 'Проверить',
  });
  expect(
    c.appeals.resolve(a.id, { decision: 'change', replacementValue: 20, reason: 'Полный ответ' })
      .finalScore?.total,
  ).toBe(93.08);
});
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'appeals-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'db.sqlite');
  const db = createDatabase(path);
  cleanups.push(() => db.close());
  const conversationId = new ConversationService(db).importRecords(
    'TEST',
    demoImport.source === 'json' ? demoImport.records : [],
  ).conversationIds[0];
  const checklist = new ChecklistService(db).seed();
  let calls = 0;
  const evaluations = new EvaluationService(db, {
    id: 'test',
    modelId: 'test',
    configurationId: 'v1',
    generate: async () => {
      calls++;
      return {
        text: JSON.stringify({
          answers: scoreExampleAnswers.map((a) => ({
            ...a,
            evidenceMessageIds: ['m0002'],
            checkedSpanMessageIds:
              a.value === 'NA' ? ['m0001'] : a.value === false ? ['m0002', 'm0004'] : [],
          })),
        }),
        usage: {},
      };
    },
  });
  cleanups.push(() => evaluations.stop());
  const [id] = evaluations.enqueue([conversationId], checklist.id);
  evaluations.start();
  for (let i = 0; i < 100 && evaluations.get(id)?.status !== 'completed'; i++)
    await new Promise((r) => setTimeout(r, 5));
  expect(evaluations.get(id)?.status).toBe('completed');
  return { db, path, id, evaluations, appeals: new AppealService(db), calls: () => calls };
}
it('changes one criterion, preserves original AI data, and persists history across connections', async () => {
  const c = await setup();
  const before = c.evaluations.get(c.id)!;
  const appeal = c.appeals.submit({
    evaluationId: c.id,
    criterionId: 'consultation',
    comment: 'Решены все вопросы',
  });
  const result = c.appeals.resolve(appeal.id, {
    decision: 'change',
    replacementValue: 20,
    reason: 'Все вопросы закрыты',
  });
  expect(result.finalScore?.total).toBe(93.08);
  expect(result.originalAnswers).toEqual(before.originalAnswers);
  expect(result.originalScore).toEqual(before.originalScore);
  expect(result.evidence).toEqual(before.evidence);
  expect(c.calls()).toBe(1);
  const reopened = createDatabase(c.path);
  try {
    const saved = new AppealService(reopened).get(appeal.id)!;
    expect(saved.status).toBe('resolved');
    expect(saved.beforeAnswer.value).toBe(15);
    expect(saved.afterAnswer?.value).toBe(20);
    expect(new EvaluationService(reopened).get(c.id)?.finalScore?.total).toBe(93.08);
  } finally {
    reopened.close();
  }
});
it('confirms without changing the effective answer', async () => {
  const c = await setup();
  const before = c.evaluations.get(c.id);
  const a = c.appeals.submit({ evaluationId: c.id, criterionId: 'dialogue', comment: 'Проверить' });
  expect(c.appeals.resolve(a.id, { decision: 'confirm', reason: 'Исходная оценка верна' })).toEqual(
    { ...before, revision: 1 },
  );
  expect(c.appeals.get(a.id)?.decision).toBe('confirm');
});
it.each([
  { decision: 'change', replacementValue: 17, reason: 'Причина' },
  { decision: 'change', replacementValue: 20, reason: ' ' },
  { decision: 'confirm', reason: 'Да', replacementValue: 20 },
])('rejects invalid decisions atomically %j', async (input) => {
  const c = await setup();
  const before = c.evaluations.get(c.id);
  const a = c.appeals.submit({
    evaluationId: c.id,
    criterionId: 'consultation',
    comment: 'Проверить',
  });
  expect(() => c.appeals.resolve(a.id, input)).toThrow();
  expect(c.appeals.get(a.id)?.status).toBe('pending');
  expect(c.evaluations.get(c.id)).toEqual(before);
});
it('uses review reason for permitted N/A and rejects forbidden N/A', async () => {
  const c = await setup();
  const a = c.appeals.submit({ evaluationId: c.id, criterionId: 'closing', comment: 'Обрыв' });
  const r = c.appeals.resolve(a.id, {
    decision: 'change',
    replacementValue: 'NA',
    reason: 'Связь оборвалась до прощания',
  });
  expect(r.effectiveAnswers.find((a) => a.criterionId === 'closing')?.naReason).toBe(
    'Связь оборвалась до прощания',
  );
  expect(r.finalScore?.total).toBe(84.17);
  const b = c.appeals.submit({ evaluationId: c.id, criterionId: 'contact', comment: 'Проверить' });
  expect(() =>
    c.appeals.resolve(b.id, { decision: 'change', replacementValue: 'NA', reason: 'Не было' }),
  ).toThrow();
});
it('keeps changes on other criteria and gross does not zero score', async () => {
  const c = await setup();
  const a = c.appeals.submit({
    evaluationId: c.id,
    criterionId: 'consultation',
    comment: 'Проверить',
  });
  const b = c.appeals.submit({ evaluationId: c.id, criterionId: 'gross', comment: 'Нарушение' });
  c.appeals.resolve(a.id, { decision: 'change', replacementValue: 20, reason: 'Полный ответ' });
  const r = c.appeals.resolve(b.id, {
    decision: 'change',
    replacementValue: true,
    reason: 'Предложена платная услуга',
  });
  expect(r.finalScore?.total).toBe(93.08);
  expect(r.finalScore?.grossViolation).toBe(true);
  expect(r.effectiveAnswers.find((a) => a.criterionId === 'gross')?.evidenceMessageIds).toEqual([]);
});
it('rejects duplicate pending and repeated resolutions; permits a new appeal after resolution', async () => {
  const c = await setup();
  const input = { evaluationId: c.id, criterionId: 'contact', comment: 'Проверить' };
  const a = c.appeals.submit(input);
  expect(() => c.appeals.submit(input)).toThrow();
  c.appeals.resolve(a.id, {
    decision: 'change',
    replacementValue: false,
    reason: 'Нет представления',
  });
  expect(() => c.appeals.resolve(a.id, { decision: 'confirm', reason: 'Повтор' })).toThrow();
  const b = c.appeals.submit(input);
  expect(b.beforeAnswer.value).toBe(false);
  expect(c.appeals.list({ evaluationId: c.id })).toHaveLength(2);
});
it('rejects unknown criteria and incomplete evaluations', async () => {
  const c = await setup();
  expect(() =>
    c.appeals.submit({ evaluationId: c.id, criterionId: 'missing', comment: 'Нет' }),
  ).toThrow();
  const e = c.evaluations.get(c.id)!;
  e.status = 'failed';
  c.db
    .prepare('UPDATE evaluations SET status=?,payload=? WHERE id=?')
    .run('failed', JSON.stringify(e), c.id);
  expect(() =>
    c.appeals.submit({ evaluationId: c.id, criterionId: 'contact', comment: 'Нет' }),
  ).toThrow();
});
it('serves create, filter, decision and conflict through HTTP', async () => {
  const c = await setup();
  const app = createApp(c.db);
  const input = { evaluationId: c.id, criterionId: 'contact', comment: 'Проверить' };
  const created = await request(app).post('/api/appeals').send(input);
  expect(created.status).toBe(201);
  expect((await request(app).post('/api/appeals').send(input)).status).toBe(409);
  expect((await request(app).get('/api/appeals?status=pending')).body).toHaveLength(1);
  expect(
    (
      await request(app)
        .post(`/api/appeals/${created.body.id}/decision`)
        .send({ decision: 'confirm', reason: 'Верно' })
    ).status,
  ).toBe(200);
  expect(
    (
      await request(app)
        .post(`/api/appeals/${created.body.id}/decision`)
        .send({ decision: 'confirm', reason: 'Ещё' })
    ).status,
  ).toBe(409);
  expect((await request(app).get('/api/appeals/missing')).status).toBe(404);
  expect((await request(app).get('/api/appeals?status=invalid')).status).toBe(400);
});
