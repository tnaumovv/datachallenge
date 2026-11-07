import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db.js';
import { EvaluationService } from '../src/evaluations/service.js';
import { installDiagnosticsRoutes } from '../src/analytics/routes.js';
import { attemptCost, initializeUsageStorage, recordCacheReceipt } from '../src/usage/ledger.js';
import { fixtureEvaluation, insertEvaluation, seedResults } from './fixtures/results.js';

describe('diagnostics API', () => {
  it('counts failures and review requirements, selecting one latest run per conversation/version', async () => {
    const db = createDatabase(':memory:');
    const seed = seedResults(db);
    const failed = fixtureEvaluation(seed.conversations[0].id, seed.checklist, {
      status: 'failed',
      originalScore: null,
      finalScore: null,
      error: { code: 'REVIEW_REQUIRED', message: 'Needs review' },
    });
    insertEvaluation(db, failed);
    const app = express();
    installDiagnosticsRoutes(app, db, new EvaluationService(db));
    const result = await request(app).get('/api/overview').expect(200);
    expect(result.body.coverage).toMatchObject({
      conversations: 10,
      selected: 10,
      completed: 9,
      failed: 1,
      reviewRequired: 1,
    });
    expect(result.body.original.denominator).toBe(9);
    expect(result.body.selection.evaluationIds).toContain(failed.id);
    db.close();
  });
  it('separates original/effective diffs and rejects different transcript hashes', async () => {
    const db = createDatabase(':memory:');
    const seed = seedResults(db);
    const left = seed.evaluations[0];
    const right = fixtureEvaluation(left.conversationId, seed.checklist);
    right.effectiveAnswers[0].value = false;
    insertEvaluation(db, right);
    const app = express();
    installDiagnosticsRoutes(app, db, new EvaluationService(db));
    const diff = await request(app)
      .get(`/api/evaluation-comparisons?left=${left.id}&right=${right.id}`)
      .expect(200);
    expect(diff.body.original.answers[0].changed).toBe(false);
    expect(diff.body.effective.answers[0].changed).toBe(true);
    const other = seed.conversations[1];
    db.prepare('UPDATE conversations SET content_hash=? WHERE id=?').run('different', other.id);
    await request(app)
      .get(`/api/evaluation-comparisons?left=${left.id}&right=${seed.evaluations[1].id}`)
      .expect(409);
    db.close();
  });
  it('preserves failed-attempt unknown costs and persists cache hits without new charges', async () => {
    const db = createDatabase(':memory:');
    const seed = seedResults(db);
    initializeUsageStorage(db);
    const failedAttempt = structuredClone(seed.evaluations[0].attempts[0]);
    failedAttempt.number = 2;
    failedAttempt.status = 'failed';
    failedAttempt.errorCode = 'TIMEOUT';
    failedAttempt.usage = {
      inputTokens: null,
      outputTokens: null,
      thinkingTokens: null,
      totalTokens: null,
    };
    seed.evaluations[0].attempts.push(failedAttempt);
    db.prepare('UPDATE evaluations SET payload=? WHERE id=?').run(
      JSON.stringify(seed.evaluations[0]),
      seed.evaluations[0].id,
    );
    recordCacheReceipt(db, {
      evaluationId: seed.evaluations[0].id,
      conversationId: seed.conversations[0].id,
      checklistVersionId: seed.checklist.id,
      cacheKey: 'test',
    });
    const app = express();
    installDiagnosticsRoutes(app, db, new EvaluationService(db));
    const result = await request(app)
      .get(`/api/evaluations/${seed.evaluations[0].id}/diagnostics`)
      .expect(200);
    expect(result.body.cost).toMatchObject({ complete: false, total: null, unknownAttempts: 2 });
    expect(result.body.cacheReceipts).toHaveLength(1);
    expect(result.body.cacheReceipts[0]).toMatchObject({
      reusedEvaluationId: seed.evaluations[0].id,
      currentReuseCost: 0,
      additionalProviderCalls: 0,
    });
    expect(result.body.attempts[1]).toMatchObject({ status: 'failed', errorCode: 'TIMEOUT' });
    const attempt = seed.evaluations[0].attempts[0];
    expect(attemptCost({ ...attempt, status: 'failed' }, undefined).amount).toBeNull();
    expect(
      attemptCost(failedAttempt, {
        currency: 'USD',
        inputPerMillion: 1,
        outputPerMillion: 2,
        thinkingPerMillion: 3,
        outputIncludesThinking: true,
        capturedAt: '2026-11-07',
      }),
    ).toMatchObject({ amount: null, reason: 'unknown_usage' });
    expect(
      attemptCost(attempt, {
        currency: 'USD',
        inputPerMillion: 1,
        outputPerMillion: 2,
        thinkingPerMillion: 3,
        outputIncludesThinking: true,
        capturedAt: '2026-11-07',
      }).amount,
    ).toBeCloseTo(0.00003);
    db.close();
  });
});
