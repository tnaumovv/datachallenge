import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { ConversationService } from '../src/conversations/service.js';
import { ChecklistService } from '../src/checklists/service.js';
import { defaultChecklist } from '../src/checklists/default.js';
import { scoreEvaluation } from '../src/evaluations/scoring.js';
import type { CriterionAnswer } from '../../shared/contracts.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const record = {
  conversation_id: 'ru-1',
  channel: 'agent chat',
  language: 'RU',
  transcript: [{ timestamp: '00:02', speaker: 'operator', text: 'Здравствуйте! Я Анна.' }],
  audio_url: null,
};
const answers = (): CriterionAnswer[] =>
  defaultChecklist.criteria.map((c) => ({
    criterionId: c.id,
    value:
      c.scoringMode === 'flag' ? false : c.answerType === 'binary' ? true : Math.max(...c.levels),
    explanation: 'Обоснование',
    evidenceMessageIds: ['m0001'],
    checkedSpanMessageIds: [],
    naReason: null,
  }));
const databases: ReturnType<typeof createDatabase>[] = [];
function setup() {
  const db = createDatabase(':memory:');
  databases.push(db);
  return db;
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
describe('score', () => {
  it('all full values give 100; gross flag does not subtract', () => {
    const a = answers();
    a[7].value = true;
    expect(scoreEvaluation(defaultChecklist.criteria, a).total).toBe(100);
    expect(scoreEvaluation(defaultChecklist.criteria, a).grossViolation).toBe(true);
  });
  it('normalizes ordinal scores and redistributes N/A to 85.38', () => {
    const a = answers();
    for (const i of [1, 2]) {
      a[i].value = 'NA';
      a[i].naReason = 'Не требуется';
    }
    a[3].value = 15;
    a[5].value = 7;
    const s = scoreEvaluation(defaultChecklist.criteria, a);
    expect(s.total).toBe(85.38);
    expect(s.contributions.find((c) => c.criterionId === 'dialogue')?.basePoints).toBe(10.5);
  });
  it('all weighted zeros give zero', () => {
    const a = answers();
    a.forEach((x) => (x.value = typeof x.value === 'boolean' ? false : 0));
    expect(scoreEvaluation(defaultChecklist.criteria, a).total).toBe(0);
  });
  it.each([
    ['contact', 'NA'],
    ['consultation', 17],
    ['dialogue', 8],
    ['contact', 1],
  ])('rejects invalid %s=%s', (id, value) => {
    const a = answers();
    Object.assign(
      a.find((x) => x.criterionId === id)!,
      { value, naReason: 'reason' },
    );
    expect(() => scoreEvaluation(defaultChecklist.criteria, a)).toThrow();
  });
  it('rejects missing and duplicate answers', () => {
    expect(() => scoreEvaluation(defaultChecklist.criteria, answers().slice(1))).toThrow();
    expect(() =>
      scoreEvaluation(defaultChecklist.criteria, [...answers(), answers()[0]]),
    ).toThrow();
  });
  it('returns null when all applicable weights are excluded', () => {
    const c = defaultChecklist.criteria.filter((c) => c.id === 'needs');
    const a = answers().filter((a) => a.criterionId === 'needs');
    a[0].value = 'NA';
    a[0].naReason = 'Known request';
    expect(scoreEvaluation(c, a).total).toBeNull();
  });
  it('accepts a new configurable criterion', () => {
    const c = { ...defaultChecklist.criteria[0], id: 'new', weight: 100 };
    const a = { ...answers()[0], criterionId: 'new', value: false };
    expect(scoreEvaluation([c], [a]).total).toBe(0);
  });
  it('marks a section with no applicable weighted criteria as N/A', () => {
    const a = answers();
    a[1].value = 'NA';
    a[1].naReason = 'Known';
    const criteria = defaultChecklist.criteria.map((c) =>
      c.id === 'needs' ? { ...c, sectionId: 'only-na' } : c,
    );
    expect(scoreEvaluation(criteria, a).sections.find((s) => s.sectionId === 'only-na')).toEqual({
      sectionId: 'only-na',
      points: null,
      maxPoints: null,
    });
  });
  it('rejects N/A without a meaningful reason', () => {
    const a = answers();
    a[1].value = 'NA';
    a[1].naReason = '  ';
    expect(() => scoreEvaluation(defaultChecklist.criteria, a)).toThrow();
  });
  it('rounds total after summing, not individual contributions', () => {
    const criteria = [1, 2, 3].map((n) => ({
      ...defaultChecklist.criteria[0],
      id: String(n),
      weight: 1,
      answerType: 'scale',
      levels: [0, 1, 3],
    }));
    const a = criteria.map((c) => ({ ...answers()[0], criterionId: c.id, value: 1 }));
    expect(scoreEvaluation(criteria, a).total).toBe(33.33);
  });
});
describe('import and versions', () => {
  it('deduplicates, isolates groups and preserves changed transcripts', () => {
    const s = new ConversationService(setup());
    expect(s.importRecords('DEV', [record]).imported).toBe(1);
    expect(s.importRecords('DEV', [record]).existing).toBe(1);
    s.importRecords('CONTROL', [record]);
    s.importRecords('DEV', [
      { ...record, transcript: [{ ...record.transcript[0], text: 'Changed' }] },
    ]);
    expect(s.list()).toHaveLength(3);
    const original = s
      .list()
      .find((x) => x.groupId === 'DEV' && x.messages[0].text.startsWith('Здравствуйте'))!;
    expect(s.get(original.id)?.messages[0]).toEqual({ id: 'm0001', ...record.transcript[0] });
  });
  it('validates entire batch before inserting', () => {
    const s = new ConversationService(setup());
    expect(() => s.importRecords('DEV', [record, { ...record, language: 'XX' }])).toThrow();
    expect(s.list()).toHaveLength(0);
  });
  it('preserves ISO timestamps and all four speaker roles', () => {
    const s = new ConversationService(setup());
    const transcript = ['client', 'operator', 'bot', 'system'].map((speaker) => ({
      timestamp: '2026-11-07T12:00:00+05:00',
      speaker,
      text: 'message',
    }));
    s.importRecords('DEV', [
      { ...record, channel: 'voice call', audio_url: 'https://example.com/audio.mp3', transcript },
    ]);
    expect(s.list()[0].messages.map(({ id, ...rest }) => rest)).toEqual(transcript);
  });
  it('persists records and checklist versions across actual reopening', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cqa-test-'));
    try {
      const path = join(directory, 'db.sqlite');
      const first = createDatabase(path);
      new ConversationService(first).importRecords('DEV', [record]);
      const version = new ChecklistService(first).seed();
      first.close();
      const second = createDatabase(path);
      try {
        expect(new ConversationService(second).list()).toHaveLength(1);
        expect(new ChecklistService(second).get(version.id)).toEqual(version);
      } finally {
        second.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('stores immutable checklist versions and rejects invalid configs', () => {
    const s = new ChecklistService(setup());
    const first = s.seed();
    const next = s.save('default', { ...defaultChecklist, title: 'New' });
    expect(next.version).toBe(2);
    expect(s.get(first.id)?.title).toBe(defaultChecklist.title);
    expect(() =>
      s.save('default', {
        ...defaultChecklist,
        criteria: [{ ...defaultChecklist.criteria[0], weight: -1 }],
      }),
    ).toThrow();
  });
  it.each([
    { levels: [], answerType: 'scale' },
    { allowNA: true, naRule: null },
    { levels: [0, 7, 7], answerType: 'scale' },
    { scoringMode: 'flag', weight: 10 },
    { sectionId: 'missing' },
  ])('rejects malformed criterion config %j', (patch) => {
    const s = new ChecklistService(setup());
    expect(() =>
      s.save('default', {
        ...defaultChecklist,
        criteria: [{ ...defaultChecklist.criteria[0], ...patch }],
      }),
    ).toThrow();
    expect(s.list()).toEqual([]);
  });
  it('rejects duplicate criterion IDs', () => {
    expect(() =>
      new ChecklistService(setup()).save('default', {
        ...defaultChecklist,
        criteria: [defaultChecklist.criteria[0], defaultChecklist.criteria[0]],
      }),
    ).toThrow();
  });
});
describe('HTTP boundary', () => {
  it('imports, lists, scores a saved version, and returns 404', async () => {
    const app = createApp(setup());
    const r = await request(app)
      .post('/api/import')
      .send({ source: 'json', groupId: 'DEV', records: [record] });
    expect(r.status).toBe(201);
    const list = await request(app).get('/api/conversations?groupId=DEV');
    expect(list.body).toHaveLength(1);
    const versions = await request(app).get('/api/checklists');
    const score = await request(app)
      .post('/api/score')
      .send({ checklistVersionId: versions.body[0].id, answers: answers() });
    expect(score.status).toBe(200);
    expect(score.body.total).toBe(100);
    expect((await request(app).get('/api/conversations/missing')).status).toBe(404);
  });
  it('returns safe 400 for malformed input and JSON', async () => {
    const app = createApp(setup());
    expect(
      (
        await request(app)
          .post('/api/import')
          .send({ source: 'json', groupId: 'DEV', records: [{}] })
      ).status,
    ).toBe(400);
    expect(
      (await request(app).post('/api/import').set('Content-Type', 'application/json').send('{'))
        .status,
    ).toBe(400);
  });
  it('supports language and channel filters, rejecting invalid filters', async () => {
    const db = setup();
    new ConversationService(db).importRecords('DEV', [
      record,
      { ...record, conversation_id: 'en-2', language: 'EN', channel: 'voice call' },
    ]);
    const app = createApp(db);
    expect(
      (await request(app).get('/api/conversations?language=EN&channel=voice%20call')).body,
    ).toHaveLength(1);
    expect((await request(app).get('/api/conversations?language=XX')).status).toBe(400);
  });
  it.each(['http', 'invalid-json', 'failure', 'count', 'network'])(
    'returns safe 502 for organizer %s failure',
    async (kind) => {
      const fake = async () => {
        if (kind === 'network') throw new Error('secret-url-token');
        if (kind === 'http') return new Response('secret-token', { status: 500 });
        if (kind === 'invalid-json') return new Response('bad');
        return new Response(
          JSON.stringify({
            isSuccess: kind !== 'failure',
            error: '',
            data: { dataset_group_id: 'DEV', total_records: 2, records: [record] },
          }),
        );
      };
      const db = setup();
      const response = await request(
        createApp(db, { organizerUrl: 'https://example.com/?token=secret-token', fetcher: fake }),
      )
        .post('/api/import')
        .send({ source: 'organizer', groupId: 'DEV' });
      expect(response.status).toBe(502);
      expect(JSON.stringify(response.body)).not.toContain('secret');
      expect(new ConversationService(db).list()).toEqual([]);
    },
  );
  it('rejects organizer failure and mismatched groups without importing', async () => {
    const fake = async () =>
      new Response(
        JSON.stringify({
          isSuccess: true,
          error: '',
          data: { dataset_group_id: 'OTHER', total_records: 1, records: [record] },
        }),
      );
    const db = setup();
    const app = createApp(db, {
      organizerUrl: 'https://example.com/dev?token=secret',
      fetcher: fake,
    });
    expect(
      (await request(app).post('/api/import').send({ source: 'organizer', groupId: 'DEV' })).status,
    ).toBe(502);
    expect(new ConversationService(db).list()).toHaveLength(0);
  });
  it('replaces group_id and preserves other organizer query parameters', async () => {
    let requested = '';
    const fake = async (url: URL | string) => {
      requested = String(url);
      return new Response(
        JSON.stringify({
          isSuccess: true,
          error: '',
          data: { dataset_group_id: 'CONTROL', total_records: 1, records: [record] },
        }),
      );
    };
    const app = createApp(setup(), {
      organizerUrl: 'https://example.com/dev?group_id=DEV&token=secret',
      fetcher: fake,
    });
    expect(
      (await request(app).post('/api/import').send({ source: 'organizer', groupId: 'CONTROL' }))
        .status,
    ).toBe(201);
    expect(new URL(requested).searchParams.getAll('group_id')).toEqual(['CONTROL']);
    expect(new URL(requested).searchParams.get('token')).toBe('secret');
  });
});
