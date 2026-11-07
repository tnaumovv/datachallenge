import { afterEach, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
const databases: ReturnType<typeof createDatabase>[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
});
const rule = {
  documentKey: 'transfers',
  title: 'Переводы',
  source: 'Внутренний справочник',
  version: '1',
  language: 'RU',
  text: 'Комиссия за перевод составляет 1%.',
  keywords: 'перевод transfer аударым',
  effectiveFrom: null,
  effectiveTo: null,
  active: true,
  demo: false,
};
function setup() {
  const db = createDatabase(':memory:');
  databases.push(db);
  return createApp(db);
}
it('stores versioned documents and finds exact excerpts; demo and inactive rules never match', async () => {
  const app = setup();
  const created = await request(app).post('/api/knowledge').send(rule).expect(201);
  expect(created.body.id).toBeTruthy();
  const match = await request(app)
    .post('/api/knowledge/search')
    .send({ query: 'перевод' })
    .expect(200);
  expect(match.body.sources[0].text).toContain('1%');
  expect(match.body.sources[0].version).toBe('1');
  await request(app)
    .patch('/api/knowledge/' + created.body.id)
    .send({ active: false })
    .expect(200);
  expect(
    (await request(app).post('/api/knowledge/search').send({ query: 'перевод' })).body.sources,
  ).toEqual([]);
  await request(app)
    .post('/api/knowledge')
    .send({ ...rule, documentKey: 'example', demo: true, active: true })
    .expect(400);
});
it('rejects duplicate versions and overlapping active rules, allows nonoverlapping dates', async () => {
  const app = setup();
  await request(app)
    .post('/api/knowledge')
    .send({ ...rule, effectiveTo: '2026-05-31' })
    .expect(201);
  await request(app).post('/api/knowledge').send(rule).expect(409);
  await request(app)
    .post('/api/knowledge')
    .send({ ...rule, version: '2', effectiveFrom: '2026-05-01' })
    .expect(409);
  await request(app)
    .post('/api/knowledge')
    .send({
      ...rule,
      version: '2',
      effectiveFrom: '2026-06-01',
      text: 'Комиссия за перевод составляет 2%.',
    })
    .expect(201);
  const old = await request(app)
    .post('/api/knowledge/search')
    .send({ query: 'перевод', date: '2026-05-31' })
    .expect(200);
  expect(old.body.sources[0].version).toBe('1');
  const unknown = await request(app)
    .post('/api/knowledge/search')
    .send({ query: 'перевод' })
    .expect(200);
  expect(unknown.body.status).toBe('date_unknown');
  expect(unknown.body.sources).toEqual([]);
});
it('handles search operators as text and rejects invalid date ranges', async () => {
  const app = setup();
  await request(app).post('/api/knowledge').send(rule).expect(201);
  await request(app)
    .post('/api/knowledge/search')
    .send({ query: '" OR * NOT (перевод)' })
    .expect(200);
  await request(app)
    .post('/api/knowledge')
    .send({ ...rule, version: '2', effectiveFrom: '2026-08-01', effectiveTo: '2026-01-01' })
    .expect(400);
  const none = await request(app)
    .post('/api/knowledge/search')
    .send({ query: 'абракадабра' })
    .expect(200);
  expect(none.body.status).toBe('no_match');
});
it('retrieves a topic after a long preamble and tolerates invalid calendar timestamps', async () => {
  const { KnowledgeService } = await import('../src/knowledge/service.js');
  const db = createDatabase(':memory:');
  databases.push(db);
  const service = new KnowledgeService(db);
  service.create(rule);
  const query =
    Array.from({ length: 70 }, (_, i) => 'служебное' + i).join(' ') + ' Какая комиссия за перевод?';
  expect(service.search({ query }).sources).toHaveLength(1);
  const conversation = {
    messages: [
      {
        speaker: 'client',
        timestamp: '2026-02-30T10:00:00Z',
        text: 'комиссия за перевод',
        id: 'm1',
      },
    ],
  } as import('../../shared/contracts.js').Conversation;
  expect(() => service.forConversation(conversation)).not.toThrow();
  expect(service.forConversation(conversation).date).toBeNull();
});
it('ranks a rule matching terms across batches above single-batch distractors', async () => {
  const { KnowledgeService } = await import('../src/knowledge/service.js');
  const db = createDatabase(':memory:');
  databases.push(db);
  const service = new KnowledgeService(db);
  const terms = Array.from({ length: 72 }, (_, i) => 'term' + String(i).padStart(3, '0'));
  const body = (words: string[]) =>
    [...words, ...Array(100 - words.length).fill('padding')].join(' ');
  service.create({
    ...rule,
    documentKey: 'target',
    title: 'Rules',
    keywords: '',
    text: body([...terms.slice(0, 6), ...terms.slice(64, 70)]),
  });
  for (let i = 0; i < 4; i++)
    service.create({
      ...rule,
      documentKey: 'decoy' + i,
      title: 'Rules',
      keywords: '',
      text: body(terms.slice(6 + i * 7, 13 + i * 7)),
    });
  expect(service.search({ query: terms.join(' ') }).sources[0].documentKey).toBe('target');
});
