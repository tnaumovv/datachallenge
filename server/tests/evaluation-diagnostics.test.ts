import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { ChecklistService } from '../src/checklists/service.js';
import { ConversationService } from '../src/conversations/service.js';
import { EvaluationService } from '../src/evaluations/service.js';
import type { EvaluationProvider, ProviderResult } from '../src/evaluations/provider.js';
import { demoImport, scoreExampleAnswers } from '../../shared/fixtures.js';
import type { CriterionAnswer } from '../../shared/contracts.js';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function answers(): CriterionAnswer[] {
  return scoreExampleAnswers.map((a) => ({
    ...a,
    evidenceMessageIds: ['m0002'],
    checkedSpanMessageIds: [],
  }));
}
function response(a = answers()): ProviderResult {
  return {
    text: JSON.stringify({ answers: a }),
    finishReason: 'STOP',
    modelVersion: 'diagnostic-model',
    usage: { inputTokens: 20, outputTokens: 10, thinkingTokens: 5, totalTokens: 35 },
  };
}
function setup(
  generate: EvaluationProvider['generate'],
  path = ':memory:',
  options: { requestTimeoutMs?: number } = {},
) {
  const db = createDatabase(path);
  cleanups.push(() => db.close());
  const conversationId = new ConversationService(db).importRecords(
    'TEST',
    demoImport.source === 'json' ? demoImport.records : [],
  ).conversationIds[0];
  const checklist = new ChecklistService(db).seed();
  const provider = { id: 'test', modelId: 'diagnostic-model', configurationId: 'v1', generate };
  const service = new EvaluationService(db, provider, { retryDelayMs: 1, ...options });
  cleanups.push(() => service.stop());
  const [id] = service.enqueue([conversationId], checklist.id);
  service.start();
  return { db, service, id, checklist };
}
async function settled(service: EvaluationService, id: string) {
  for (let i = 0; i < 300; i++) {
    const evaluation = service.get(id)!;
    if (['completed', 'failed'].includes(evaluation.status)) return evaluation;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Evaluation did not settle');
}

describe('attempt validation diagnostics', () => {
  it('retains the provider finish reason before trying to parse an incomplete response', async () => {
    const { service, id } = setup(async () => ({
      ...response(),
      text: '{',
      finishReason: 'MAX_TOKENS',
    }));
    const result = await settled(service, id);
    expect(result.error?.code).toBe('INVALID_MODEL_OUTPUT');
    expect(result.attempts).toHaveLength(2);
    for (const attempt of result.attempts) {
      expect(attempt).toMatchObject({
        failureStage: 'finish_reason',
        finishReason: 'MAX_TOKENS',
        validationErrors: [{ code: 'INCOMPLETE_GENERATION', path: ['finishReason'] }],
        modelVersion: 'diagnostic-model',
        usage: { totalTokens: 35 },
      });
    }
  });

  it('distinguishes invalid JSON and keeps its parser reason without copying response excerpts', async () => {
    const { service, id } = setup(async () => ({
      ...response(),
      text: 'secret-sensitive-output-that-is-not-json',
    }));
    const result = await settled(service, id);
    expect(result.attempts[0]).toMatchObject({
      failureStage: 'json_parse',
      finishReason: 'STOP',
      validationErrors: [
        { code: 'INVALID_JSON', path: [], message: expect.stringMatching(/token/i) },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('secret-sen');
  });

  it('retains all schema issues with their complete field paths', async () => {
    const a = answers();
    const malformed = { ...a[0], evidenceMessageIds: undefined, naReason: undefined };
    const { service, id } = setup(async () => ({
      ...response(),
      text: JSON.stringify({ answers: [malformed, ...a.slice(1)] }),
    }));
    const result = await settled(service, id);
    expect(result.attempts[0]).toMatchObject({
      failureStage: 'schema',
      finishReason: 'STOP',
      validationErrors: [
        {
          code: 'invalid_type',
          path: ['answers', 0, 'evidenceMessageIds'],
          message: expect.stringContaining('array'),
        },
        {
          code: 'invalid_type',
          path: ['answers', 0, 'naReason'],
          message: expect.stringContaining('string'),
        },
      ],
    });
  });

  it('retains the alternatives behind a union validation failure', async () => {
    const a = answers();
    const { service, id } = setup(async () => ({
      ...response(),
      text: JSON.stringify({ answers: [{ ...a[0], value: 'yes' }, ...a.slice(1)] }),
    }));
    const result = await settled(service, id);
    expect(result.attempts[0]).toMatchObject({
      failureStage: 'schema',
      validationErrors: [
        {
          code: 'invalid_union',
          path: ['answers', 0, 'value'],
          message: expect.stringMatching(/boolean.*number.*NA/),
        },
      ],
    });
  });

  it.each([
    {
      name: 'missing answer',
      mutate: (a: CriterionAnswer[]) => {
        a.pop();
      },
      code: 'MISSING_ANSWER',
      path: ['answers'],
      reason: /gross/,
    },
    {
      name: 'duplicate answer',
      mutate: (a: CriterionAnswer[]) => {
        a.push(a[0]);
      },
      code: 'DUPLICATE_ANSWER',
      path: ['answers', 8, 'criterionId'],
      reason: /duplicate/i,
    },
    {
      name: 'unknown criterion',
      mutate: (a: CriterionAnswer[]) => {
        a[0].criterionId = 'unknown';
      },
      code: 'UNKNOWN_CRITERION',
      path: ['answers', 0, 'criterionId'],
      reason: /unknown/i,
    },
    {
      name: 'forbidden N/A',
      mutate: (a: CriterionAnswer[]) => {
        a[0].value = 'NA';
      },
      code: 'NA_NOT_ALLOWED',
      path: ['answers', 0, 'value'],
      reason: /not allowed/i,
    },
    {
      name: 'missing N/A reason',
      mutate: (a: CriterionAnswer[]) => {
        a[1].naReason = ' ';
      },
      code: 'MISSING_NA_REASON',
      path: ['answers', 1, 'naReason'],
      reason: /reason/i,
    },
    {
      name: 'binary number',
      mutate: (a: CriterionAnswer[]) => {
        a[0].value = 1;
      },
      code: 'INVALID_ANSWER_TYPE',
      path: ['answers', 0, 'value'],
      reason: /boolean/i,
    },
    {
      name: 'invalid scale level after reordering',
      mutate: (a: CriterionAnswer[]) => {
        a[3].value = 17;
        a.unshift(a.splice(3, 1)[0]);
      },
      code: 'INVALID_LEVEL',
      path: ['answers', 0, 'value'],
      reason: /0, 5, 10, 15, 20/,
    },
  ])('pinpoints $name in the actual answer array', async ({ mutate, code, path, reason }) => {
    const a = answers();
    mutate(a);
    const { service, id } = setup(async () => response(a));
    const result = await settled(service, id);
    expect(result.finalScore).toBeNull();
    expect(result.attempts[0]).toMatchObject({
      failureStage: 'answers',
      finishReason: 'STOP',
      validationErrors: [{ code, path, message: expect.stringMatching(reason) }],
    });
  });

  it.each(['evidenceMessageIds', 'checkedSpanMessageIds'] as const)(
    'pinpoints unknown and duplicate entries in %s',
    async (field) => {
      for (const [ids, code] of [
        [['m0002', 'invented'], 'UNKNOWN_MESSAGE'],
        [['m0002', 'm0002'], 'DUPLICATE_MESSAGE'],
      ] as const) {
        const a = answers();
        a[2][field] = [...ids];
        const { service, id } = setup(async () => response(a));
        const result = await settled(service, id);
        expect(result.attempts[0]).toMatchObject({
          failureStage: 'evidence',
          validationErrors: [{ code, path: ['answers', 2, field, 1], message: expect.any(String) }],
        });
      }
    },
  );

  it('identifies the answer that has neither evidence nor a checked span', async () => {
    const a = answers();
    a[0].evidenceMessageIds = [];
    const { service, id } = setup(async () => response(a));
    const result = await settled(service, id);
    expect(result.attempts[0]).toMatchObject({
      failureStage: 'evidence',
      validationErrors: [{ code: 'MISSING_EVIDENCE', path: ['answers', 0] }],
    });
  });

  it('preserves the invalid attempt when repair succeeds without leaking its errors into success', async () => {
    let calls = 0;
    const { service, id } = setup(async () => {
      if (++calls === 1) return { ...response(), text: '{' };
      return response();
    });
    const result = await settled(service, id);
    expect(result.status).toBe('completed');
    expect(result.finalScore?.total).toBe(85.38);
    expect(result.attempts[0]).toMatchObject({ failureStage: 'json_parse', finishReason: 'STOP' });
    expect(result.attempts[1]).toMatchObject({
      failureStage: null,
      finishReason: 'STOP',
      validationErrors: [],
    });
    expect(result.usage).toMatchObject({ calls: 2, totalTokens: 70 });
  });

  it('keeps the invalid response diagnostics after subsequent repair timeouts', async () => {
    let calls = 0;
    const { service, id } = setup(
      async () => {
        if (++calls === 2) {
          const a = answers();
          a[3].value = 17;
          return response(a);
        }
        return new Promise(() => {});
      },
      ':memory:',
      { requestTimeoutMs: 10 },
    );
    const result = await settled(service, id);
    expect(result.error?.code).toBe('TIMEOUT');
    expect(result.attempts.map((a) => a.errorCode)).toEqual([
      'TIMEOUT',
      'INVALID_MODEL_OUTPUT',
      'TIMEOUT',
      'TIMEOUT',
    ]);
    expect(result.attempts[1]).toMatchObject({
      failureStage: 'answers',
      finishReason: 'STOP',
      validationErrors: [{ code: 'INVALID_LEVEL', path: ['answers', 3, 'value'] }],
      usage: { totalTokens: 35 },
    });
    for (const index of [0, 2, 3]) {
      expect(result.attempts[index]).toMatchObject({
        failureStage: 'provider',
        finishReason: null,
        validationErrors: [],
      });
    }
    expect(result.usage).toMatchObject({ calls: 4, totalTokens: null });
  });

  it('does not expose arbitrary provider exceptions as validator diagnostics', async () => {
    const { service, id } = setup(async () => {
      throw new Error('secret-sdk-error');
    });
    const result = await settled(service, id);
    expect(result.attempts[0]).toMatchObject({
      errorCode: 'PROVIDER_FAILED',
      failureStage: 'provider',
      finishReason: null,
      validationErrors: [],
    });
    expect(JSON.stringify(result)).not.toContain('secret-sdk-error');
  });

  it('retains parser positions for JSON errors that have no response excerpt', async () => {
    const { service, id } = setup(async () => ({ ...response(), text: '{invalid' }));
    const result = await settled(service, id);
    expect(result.attempts[0]).toMatchObject({
      failureStage: 'json_parse',
      validationErrors: [
        {
          code: 'INVALID_JSON',
          path: [],
          message: expect.stringMatching(/property name.*position 1/),
        },
      ],
    });
  });

  it('keeps HTTP 400/INVALID_ANSWERS when the same validator rejects manual scoring', async () => {
    const { db, service, id, checklist } = setup(async () => response());
    await settled(service, id);
    const a = answers();
    a[3].value = 17;
    const result = await request(createApp(db, { evaluations: service }))
      .post('/api/score')
      .send({ checklistVersionId: checklist.id, answers: a });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatchObject({
      code: 'INVALID_ANSWERS',
      message: expect.stringContaining('consultation'),
    });
  });

  it('returns neutral diagnostic defaults for old records without rewriting their history', async () => {
    const { service, db, id } = setup(async () => ({ ...response(), text: '{' }));
    await settled(service, id);
    const legacy = JSON.parse(
      db.prepare('SELECT payload FROM evaluations WHERE id=?').get(id)!.payload as string,
    );
    for (const attempt of legacy.attempts) {
      delete attempt.failureStage;
      delete attempt.finishReason;
      delete attempt.validationErrors;
    }
    const originalPayload = JSON.stringify(legacy);
    db.prepare('UPDATE evaluations SET payload=? WHERE id=?').run(originalPayload, id);
    for (const result of [service.get(id)!, service.list()[0]]) {
      expect(result.attempts[0]).toMatchObject({
        failureStage: null,
        finishReason: null,
        validationErrors: [],
      });
    }
    expect(db.prepare('SELECT payload FROM evaluations WHERE id=?').get(id)!.payload).toBe(
      originalPayload,
    );
  });

  it('preserves diagnostics across reopening SQLite and exposes them through GET and list', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cqa-diagnostics-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'test.sqlite');
    const a = answers();
    a[0].evidenceMessageIds = ['missing'];
    const { db, service, id } = setup(async () => response(a), path);
    const original = await settled(service, id);
    await service.stop();
    // Remove only the setup cleanups for the resources being explicitly closed here.
    cleanups.pop();
    cleanups.pop();
    db.close();
    const reopened = createDatabase(path);
    cleanups.push(() => reopened.close());
    const resumed = new EvaluationService(reopened);
    cleanups.push(() => resumed.stop());
    resumed.start();
    const app = createApp(reopened, { evaluations: resumed });
    const detail = await request(app).get(`/api/evaluations/${id}`);
    const list = await request(app).get('/api/evaluations');
    expect(detail.status).toBe(200);
    expect(detail.body.attempts).toEqual(original.attempts);
    expect(list.body[0].attempts).toEqual(original.attempts);
    expect(detail.body.attempts[0]).toMatchObject({
      failureStage: 'evidence',
      finishReason: 'STOP',
      validationErrors: [
        { code: 'UNKNOWN_MESSAGE', path: ['answers', 0, 'evidenceMessageIds', 0] },
      ],
    });
  });
});
