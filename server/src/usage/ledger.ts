import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Evaluation, EvaluationAttempt } from '../../../shared/contracts.js';
import type { AttemptCost, CostSummary, PriceSnapshot } from '../../../shared/diagnostics.js';

export function initializeUsageStorage(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS generation_receipts (
    id TEXT PRIMARY KEY, evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
    conversation_id TEXT NOT NULL, checklist_version_id TEXT NOT NULL,
    cache_key TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind='cache_hit'), created_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS generation_receipts_evaluation ON generation_receipts(evaluation_id);`);
}
export function recordCacheReceipt(
  db: DatabaseSync,
  input: {
    evaluationId: string;
    conversationId: string;
    checklistVersionId: string;
    cacheKey: string;
  },
) {
  db.prepare('INSERT INTO generation_receipts VALUES (?,?,?,?,?,?,?)').run(
    randomUUID(),
    input.evaluationId,
    input.conversationId,
    input.checklistVersionId,
    input.cacheKey,
    'cache_hit',
    new Date().toISOString(),
  );
}
export function cacheReceipts(db: DatabaseSync, evaluationId: string) {
  // Existing databases remain readable before the additive initializer is installed.
  if (
    !db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='generation_receipts'")
      .get()
  )
    return [];
  return db
    .prepare(
      'SELECT id, created_at AS createdAt, kind FROM generation_receipts WHERE evaluation_id=? ORDER BY rowid',
    )
    .all(evaluationId)
    .map((receipt) => ({
      ...receipt,
      reusedEvaluationId: evaluationId,
      currentReuseCost: 0,
      additionalProviderCalls: 0,
    }));
}
export function attemptCost(attempt: EvaluationAttempt, price?: PriceSnapshot): AttemptCost {
  if (!price) return { amount: null, currency: null, reason: 'missing_price' };
  const rates = [price.inputPerMillion, price.outputPerMillion, price.thinkingPerMillion];
  if (
    !price.currency?.trim() ||
    !price.capturedAt ||
    typeof price.outputIncludesThinking !== 'boolean' ||
    rates.some((n) => !Number.isFinite(n) || n < 0)
  )
    return { amount: null, currency: null, reason: 'invalid_price' };
  const { inputTokens: input, outputTokens: output, thinkingTokens: thinking } = attempt.usage;
  const tokens = price.outputIncludesThinking ? [input, output] : [input, output, thinking];
  if (tokens.some((n) => n === null || !Number.isSafeInteger(n) || n! < 0))
    return { amount: null, currency: price.currency, reason: 'unknown_usage' };
  return {
    amount:
      (input! * price.inputPerMillion +
        output! * price.outputPerMillion +
        (price.outputIncludesThinking ? 0 : thinking! * price.thinkingPerMillion)) /
      1_000_000,
    currency: price.currency,
    reason: null,
  };
}
export function evaluationCost(evaluation: Evaluation): CostSummary {
  const attempts = evaluation.attempts.map((attempt) => ({
    ...attemptCost(
      attempt,
      (attempt as EvaluationAttempt & { priceSnapshot?: PriceSnapshot }).priceSnapshot,
    ),
    number: attempt.number,
    status: attempt.status,
  }));
  const currencies = new Set(attempts.filter((a) => a.amount !== null).map((a) => a.currency));
  const unknownAttempts = attempts.filter((a) => a.amount === null).length;
  const mixed = currencies.size > 1;
  const knownSubtotal = mixed ? null : attempts.reduce((sum, a) => sum + (a.amount ?? 0), 0);
  const complete = unknownAttempts === 0 && !mixed;
  return {
    total: complete ? knownSubtotal : null,
    knownSubtotal,
    currency: currencies.size === 1 ? [...currencies][0] : null,
    complete,
    unknownAttempts,
    attempts,
  };
}
