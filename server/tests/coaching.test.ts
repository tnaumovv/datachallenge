import { afterEach, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { ConversationService } from '../src/conversations/service.js';
import { ChecklistService } from '../src/checklists/service.js';
import { demoImport, scoreExampleAnswers } from '../../shared/fixtures.js';
import type { Evaluation } from '../../shared/contracts.js';
const dbs: ReturnType<typeof createDatabase>[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));
function setup() {
  const db = createDatabase(':memory:');
  dbs.push(db);
  const app = createApp(db);
  const cs = new ConversationService(db);
  const [conversationId] = cs.importRecords(
    'TEST',
    demoImport.source === 'json' ? demoImport.records : [],
  ).conversationIds;
  const checklist = new ChecklistService(db).list()[0];
  const evaluation = {
    id: 'coaching-test',
    conversationId,
    checklistVersionId: checklist.id,
    status: 'completed',
    effectiveAnswers: scoreExampleAnswers.map((a) => ({
      ...a,
      explanation: 'Оператор не представился в первом ответе.',
      checkedSpanMessageIds: ['m0002'],
    })),
    attempts: [],
  } as unknown as Evaluation;
  evaluation.effectiveAnswers[0].value = false;
  const save = () =>
    db
      .prepare('INSERT OR REPLACE INTO evaluations VALUES (?,?,?,?,?,?)')
      .run(
        evaluation.id,
        conversationId,
        checklist.id,
        'test',
        evaluation.status,
        JSON.stringify(evaluation),
      );
  save();
  return { db, app, evaluation, save, checklist };
}
it('offers evidence-linked steps only for deficiencies and reflects an appealed answer', async () => {
  const { app, evaluation, save } = setup();
  const result = await request(app).get('/api/evaluations/coaching-test/coaching').expect(200);
  const contact = result.body.items.find(
    (i: { criterionId: string }) => i.criterionId === 'contact',
  );
  expect(contact.action).toContain('представьтесь');
  expect(contact.evidence[0].text).toContain('Меня зовут Анна');
  expect(contact.example).toContain('[имя]');
  expect(
    result.body.items.some((i: { criterionId: string }) =>
      ['needs', 'identity', 'gross', 'closing'].includes(i.criterionId),
    ),
  ).toBe(false);
  evaluation.effectiveAnswers[0].value = true;
  save();
  expect(
    (await request(app).get('/api/evaluations/coaching-test/coaching')).body.items.some(
      (i: { criterionId: string }) => i.criterionId === 'contact',
    ),
  ).toBe(false);
  evaluation.status = 'failed';
  save();
  expect((await request(app).get('/api/evaluations/coaching-test/coaching')).body.items).toEqual(
    [],
  );
});
it('honors custom instructions instead of assuming standard meaning from the criterion ID', async () => {
  const { app, db, checklist } = setup();
  checklist.criteria[0].instruction = 'Проверить название отдела в ответе.';
  db.prepare('UPDATE checklist_versions SET payload=? WHERE id=?').run(
    JSON.stringify(checklist),
    checklist.id,
  );
  const result = await request(app).get('/api/evaluations/coaching-test/coaching').expect(200);
  const contact = result.body.items.find(
    (i: { criterionId: string }) => i.criterionId === 'contact',
  );
  expect(contact.action).toContain('название отдела');
  expect(contact.example).toBeNull();
});
