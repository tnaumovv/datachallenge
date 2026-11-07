import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  Evaluation,
  EvaluationAttempt,
  EvaluationFailureStage,
  EvaluationConfiguration,
  TokenUsage,
} from '../../../shared/contracts.js';
import { EvaluationRequestSchema } from '../../../shared/contracts.js';
import { ChecklistService } from '../checklists/service.js';
import { ConversationService } from '../conversations/service.js';
import { HttpError } from '../errors.js';
import { validateEvidence } from './evidence.js';
import { ModelOutputSchema, PROMPT_VERSION } from './prompt.js';
import {
  ProviderError,
  type EvaluationProvider,
  type ProviderResult,
  type RepairContext,
} from './provider.js';
import { scoreEvaluation } from './scoring.js';
import { OutputValidationError, validationIssues } from './validation.js';

function readEvaluation(payload: string): Evaluation {
  const evaluation: Evaluation = JSON.parse(payload);
  for (const attempt of evaluation.attempts) {
    // Old records did not store these fields; do not infer lost diagnostics.
    attempt.failureStage ??= null;
    attempt.finishReason ??= null;
    attempt.blockReason ??= null;
    attempt.validationErrors ??= [];
  }
  return evaluation;
}

const unknownUsage = (): TokenUsage => ({
  inputTokens: null,
  outputTokens: null,
  thinkingTokens: null,
  totalTokens: null,
});
const safeUsage = (usage: Partial<TokenUsage>): TokenUsage =>
  Object.fromEntries(
    Object.keys(unknownUsage()).map((key) => {
      const value = usage[key as keyof TokenUsage];
      return [
        key,
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null,
      ];
    }),
  ) as TokenUsage;
function summarize(attempts: EvaluationAttempt[]): Evaluation['usage'] {
  const usage = unknownUsage();
  for (const key of Object.keys(usage) as (keyof TokenUsage)[]) {
    const values = attempts.map((a) => a.usage[key]);
    usage[key] =
      values.length && values.every((n) => n !== null)
        ? values.reduce<number>((sum, n) => sum + (n ?? 0), 0)
        : null;
  }
  return { ...usage, calls: attempts.length };
}
const errorMessage = (code: string) =>
  ({
    INVALID_MODEL_OUTPUT: 'Model output failed answer or evidence validation',
    INTERRUPTED: 'Evaluation was interrupted; retry creates a new attempt history',
    PROVIDER_CHANGED: 'Configured provider differs from this queued evaluation',
    TIMEOUT: 'Model request timed out',
    AUTH_FAILED: 'Model authentication failed',
    RATE_LIMIT: 'Model rate limit exceeded',
    MODEL_UNAVAILABLE: 'Model is unavailable',
    BILLING_REQUIRED: 'Provider requires paid access; choose an available free provider',
    INVALID_PROVIDER_REQUEST: 'Provider rejected the configured model or generation options',
    MODEL_BLOCKED: 'Model request or response was blocked by the provider',
    PROVIDER_FAILED: 'Model request failed',
  })[code] ?? 'Evaluation failed';

export class EvaluationService {
  private running = false;
  private started = false;
  private tasks = new Set<Promise<void>>();
  private stopController = new AbortController();
  private concurrency: number;
  private requestTimeoutMs: number;
  private retryDelayMs: number;
  constructor(
    private db: DatabaseSync,
    private provider?: EvaluationProvider,
    options: { concurrency?: number; requestTimeoutMs?: number; retryDelayMs?: number } = {},
  ) {
    this.concurrency = options.concurrency ?? 2;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 90_000;
    this.retryDelayMs = options.retryDelayMs ?? 1_000;
    if (
      !Number.isInteger(this.concurrency) ||
      this.concurrency < 1 ||
      this.concurrency > 10 ||
      this.requestTimeoutMs <= 0 ||
      this.retryDelayMs < 0
    )
      throw new Error('Invalid queue configuration');
  }
  getConfiguration(): EvaluationConfiguration {
    return {
      configured: !!this.provider,
      providerId: this.provider?.id ?? null,
      modelId: this.provider?.modelId ?? null,
      configurationId: this.provider?.configurationId ?? null,
      promptVersion: PROMPT_VERSION,
    };
  }
  get(id: string): Evaluation | undefined {
    const row = this.db.prepare('SELECT payload FROM evaluations WHERE id=?').get(id);
    return row ? readEvaluation(row.payload as string) : undefined;
  }
  list(conversationId?: string): Evaluation[] {
    const rows = conversationId
      ? this.db
          .prepare('SELECT payload FROM evaluations WHERE conversation_id=? ORDER BY rowid DESC')
          .all(conversationId)
      : this.db.prepare('SELECT payload FROM evaluations ORDER BY rowid DESC').all();
    return rows.map((row) => readEvaluation(row.payload as string));
  }
  private save(evaluation: Evaluation) {
    evaluation.usage = summarize(evaluation.attempts);
    this.db
      .prepare('UPDATE evaluations SET status=?,payload=? WHERE id=?')
      .run(evaluation.status, JSON.stringify(evaluation), evaluation.id);
  }
  enqueue(
    conversationIds: string[],
    checklistVersionId: string,
    force = false,
    retryOfId: string | null = null,
  ): string[] {
    const input = EvaluationRequestSchema.parse({ conversationIds, checklistVersionId, force });
    const p = this.provider;
    if (!p)
      throw new HttpError(
        503,
        'AI_NOT_CONFIGURED',
        'Configure an AI provider and model on the server',
      );
    const checklist = new ChecklistService(this.db).get(input.checklistVersionId);
    if (!checklist) throw new HttpError(404, 'NOT_FOUND', 'Checklist version not found');
    const conversations = new ConversationService(this.db);
    const records = [...new Set(input.conversationIds)].map((id) => {
      const c = conversations.get(id);
      if (!c) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found');
      return c;
    });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const ids = records.map((c) => {
        const cacheKey = createHash('sha256')
          .update(
            JSON.stringify([
              c.id,
              c.transcriptHash,
              checklist.id,
              p.id,
              p.modelId,
              p.configurationId,
              PROMPT_VERSION,
            ]),
          )
          .digest('hex');
        if (!force) {
          const previous = this.db
            .prepare(
              "SELECT id FROM evaluations WHERE cache_key=? AND status IN ('completed','queued','running') ORDER BY rowid DESC LIMIT 1",
            )
            .get(cacheKey);
          if (previous) return previous.id as string;
        }
        const result: Evaluation = {
          id: randomUUID(),
          conversationId: c.id,
          checklistVersionId: checklist.id,
          providerId: p.id,
          modelId: p.modelId,
          configurationId: p.configurationId,
          promptVersion: PROMPT_VERSION,
          status: 'queued',
          retryOfId,
          createdAt: new Date().toISOString(),
          startedAt: null,
          finishedAt: null,
          originalAnswers: [],
          effectiveAnswers: [],
          evidence: [],
          originalScore: null,
          finalScore: null,
          attempts: [],
          usage: { ...unknownUsage(), calls: 0 },
          error: null,
        };
        this.db
          .prepare('INSERT INTO evaluations VALUES (?,?,?,?,?,?)')
          .run(result.id, c.id, checklist.id, cacheKey, result.status, JSON.stringify(result));
        return result.id;
      });
      this.db.exec('COMMIT');
      this.pump();
      return ids;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  retry(id: string): string {
    const previous = this.get(id);
    if (!previous) throw new HttpError(404, 'NOT_FOUND', 'Evaluation not found');
    if (previous.status !== 'failed')
      throw new HttpError(409, 'NOT_FAILED', 'Only failed evaluations can be retried');
    return this.enqueue([previous.conversationId], previous.checklistVersionId, true, id)[0];
  }
  start() {
    if (this.started) return;
    this.started = true;
    this.running = true;
    for (const evaluation of this.list().filter((e) => e.status === 'running')) {
      for (const attempt of evaluation.attempts.filter((a) => a.status === 'running')) {
        attempt.status = 'failed';
        attempt.errorCode = 'INTERRUPTED';
        attempt.failureStage = 'interrupted';
        attempt.finishedAt = new Date().toISOString();
        attempt.durationMs = Date.now() - Date.parse(attempt.startedAt);
      }
      this.fail(evaluation, 'INTERRUPTED');
    }
    this.pump();
  }
  async stop() {
    this.running = false;
    this.stopController.abort();
    await Promise.allSettled([...this.tasks]);
  }
  private fail(evaluation: Evaluation, code: string) {
    evaluation.status = 'failed';
    evaluation.finishedAt = new Date().toISOString();
    evaluation.error = { code, message: errorMessage(code) };
    this.save(evaluation);
  }
  private pump() {
    if (!this.running || !this.provider) return;
    while (this.tasks.size < this.concurrency) {
      const row = this.db
        .prepare("SELECT id FROM evaluations WHERE status='queued' ORDER BY rowid LIMIT 1")
        .get();
      if (!row) break;
      const evaluation = this.get(row.id as string)!;
      const p = this.provider;
      if (
        evaluation.providerId !== p.id ||
        evaluation.modelId !== p.modelId ||
        evaluation.configurationId !== p.configurationId ||
        evaluation.promptVersion !== PROMPT_VERSION
      ) {
        this.fail(evaluation, 'PROVIDER_CHANGED');
        continue;
      }
      evaluation.status = 'running';
      evaluation.startedAt = new Date().toISOString();
      this.save(evaluation);
      const task = this.run(evaluation)
        .catch(() => this.fail(evaluation, 'PROVIDER_FAILED'))
        .finally(() => {
          this.tasks.delete(task);
          this.pump();
        });
      this.tasks.add(task);
    }
  }
  private async pause(ms: number) {
    await new Promise<void>((resolve, reject) => {
      const signal = this.stopController.signal;
      const abort = () => {
        clearTimeout(timer);
        reject(new ProviderError('INTERRUPTED', false));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, ms);
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  }
  private async generate(evaluation: Evaluation, repair?: RepairContext): Promise<ProviderResult> {
    const conversation = new ConversationService(this.db).get(evaluation.conversationId)!;
    const checklist = new ChecklistService(this.db).get(evaluation.checklistVersionId)!;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let stop: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const abort = (code: string) => {
        controller.abort();
        reject(new ProviderError(code, code === 'TIMEOUT'));
      };
      timer = setTimeout(() => abort('TIMEOUT'), this.requestTimeoutMs);
      stop = () => abort('INTERRUPTED');
      if (this.stopController.signal.aborted) stop();
      else this.stopController.signal.addEventListener('abort', stop, { once: true });
    });
    try {
      return await Promise.race([
        this.provider!.generate({
          conversation,
          checklist,
          signal: controller.signal,
          repair,
        }),
        aborted,
      ]);
    } finally {
      clearTimeout(timer!);
      this.stopController.signal.removeEventListener('abort', stop);
    }
  }
  private async run(evaluation: Evaluation) {
    let transientRetries = 0;
    let repair: RepairContext | undefined;
    for (;;) {
      if (this.stopController.signal.aborted) {
        this.fail(evaluation, 'INTERRUPTED');
        return;
      }
      const attempt: EvaluationAttempt = {
        number: evaluation.attempts.length + 1,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        durationMs: null,
        status: 'running',
        errorCode: null,
        failureStage: null,
        finishReason: null,
        blockReason: null,
        validationErrors: [],
        usage: unknownUsage(),
        modelVersion: null,
      };
      evaluation.attempts.push(attempt);
      this.save(evaluation);
      let failure: ProviderError | undefined;
      try {
        const response = await this.generate(evaluation, repair);
        attempt.usage = safeUsage(response.usage);
        attempt.modelVersion = response.modelVersion ?? null;
        attempt.finishReason = response.finishReason ?? null;
        attempt.blockReason = response.blockReason ?? null;
        if (attempt.blockReason) throw new ProviderError('MODEL_BLOCKED', false);
        let stage: EvaluationFailureStage = 'finish_reason';
        try {
          if (response.finishReason && response.finishReason !== 'STOP')
            throw new OutputValidationError(
              'INCOMPLETE_GENERATION',
              ['finishReason'],
              `Generation ended with ${response.finishReason}; expected STOP`,
            );
          stage = 'json_parse';
          const parsed: unknown = JSON.parse(response.text);
          stage = 'schema';
          const { answers } = ModelOutputSchema.parse(parsed);
          stage = 'answers';
          const criteria = new ChecklistService(this.db).get(
            evaluation.checklistVersionId,
          )!.criteria;
          const score = scoreEvaluation(criteria, answers);
          stage = 'evidence';
          const evidence = validateEvidence(
            new ConversationService(this.db).get(evaluation.conversationId)!,
            answers,
            criteria,
          );
          evaluation.originalAnswers = answers;
          evaluation.effectiveAnswers = structuredClone(answers);
          evaluation.evidence = evidence;
          evaluation.originalScore = score;
          evaluation.finalScore = structuredClone(score);
          evaluation.status = 'completed';
          evaluation.finishedAt = new Date().toISOString();
          attempt.status = 'completed';
        } catch (error) {
          attempt.failureStage = stage;
          attempt.validationErrors = validationIssues(error);
          failure = new ProviderError('INVALID_MODEL_OUTPUT', false);
        }
      } catch (error) {
        attempt.failureStage = 'provider';
        failure =
          error instanceof ProviderError ? error : new ProviderError('PROVIDER_FAILED', false);
      }
      attempt.finishedAt = new Date().toISOString();
      attempt.durationMs = Date.now() - Date.parse(attempt.startedAt);
      if (!failure) {
        this.save(evaluation);
        return;
      }
      attempt.status = 'failed';
      attempt.errorCode = failure.code;
      this.save(evaluation);
      if (failure.code === 'INVALID_MODEL_OUTPUT' && !repair) {
        repair = structuredClone({
          failureStage: attempt.failureStage,
          finishReason: attempt.finishReason,
          validationErrors: attempt.validationErrors,
        });
        continue;
      }
      if (failure.retryable && transientRetries < 2) {
        const delay = failure.retryAfterMs ?? this.retryDelayMs * 2 ** transientRetries;
        // A long Retry-After must not be silently shortened and violate provider quotas.
        if (!Number.isFinite(delay) || delay < 0 || delay > 60_000) {
          this.fail(evaluation, failure.code);
          return;
        }
        transientRetries++;
        try {
          await this.pause(delay);
        } catch {
          this.fail(evaluation, 'INTERRUPTED');
          return;
        }
        continue;
      }
      this.fail(evaluation, failure.code);
      return;
    }
  }
}
