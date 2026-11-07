import { PrecedentService, sourceFamily, type ApprovedPrecedent } from '../precedents/service.js';
import { criterionFingerprint } from '../checklists/profiles.js';
import { consistencyReasons } from './consistency.js';
import type { PriceSnapshot } from '../../../shared/diagnostics.js';
import { EvaluationPolicy } from './policy.js';
import { validateCandidate } from './candidate.js';
import { POLICY_VERSION, type CandidateOutput } from '../../../shared/evaluation-policy.js';
import { initializeReviewStorage, queueReview } from '../review/service.js';
import { recordCacheReceipt } from '../usage/ledger.js';
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
    REVIEW_REQUIRED: 'Human review is required before this evaluation can be completed',
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
    private candidateOptions: {
      concurrency?: number;
      requestTimeoutMs?: number;
      retryDelayMs?: number;
      candidate?: boolean;
      precedents?: boolean;
      deadlineMs?: number;
      verifier?: EvaluationProvider;
      priceSnapshot?: PriceSnapshot;
    } = {},
  ) {
    this.concurrency = candidateOptions.concurrency ?? 2;
    this.requestTimeoutMs = candidateOptions.requestTimeoutMs ?? 90_000;
    this.retryDelayMs = candidateOptions.retryDelayMs ?? 1_000;
    if (
      !Number.isInteger(this.concurrency) ||
      this.concurrency < 1 ||
      this.concurrency > 10 ||
      this.requestTimeoutMs <= 0 ||
      this.retryDelayMs < 0 ||
      (candidateOptions.deadlineMs !== undefined &&
        (!Number.isFinite(candidateOptions.deadlineMs) || candidateOptions.deadlineMs <= 0))
    )
      throw new Error('Invalid queue configuration');
  }
  private policySnapshot() {
    return JSON.stringify({
      version: POLICY_VERSION,
      deadlineMs: this.candidateOptions.deadlineMs ?? 120000,
      verifier: this.candidateOptions.verifier
        ? [
            this.candidateOptions.verifier.id,
            this.candidateOptions.verifier.modelId,
            this.candidateOptions.verifier.configurationId,
          ]
        : null,
    });
  }
  getConfiguration(): EvaluationConfiguration {
    return {
      configured: !!this.provider,
      providerId: this.provider?.id ?? null,
      modelId: this.provider?.modelId ?? null,
      configurationId: this.provider?.configurationId ?? null,
      promptVersion: this.candidateOptions.candidate ? POLICY_VERSION : PROMPT_VERSION,
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
        const precedentExamples: ApprovedPrecedent[] = [];
        if (this.candidateOptions.candidate && this.candidateOptions.precedents) {
          const service = new PrecedentService(this.db);
          for (const criterion of checklist.criteria) {
            for (const example of service.select({
              fingerprint: criterionFingerprint(criterion),
              channel: c.channel,
              language: c.language,
              transcriptHash: c.transcriptHash,
              sourceFamily: sourceFamily(c.sourceConversationId),
            }).examples) {
              if (
                precedentExamples.length < 2 &&
                !precedentExamples.some((e) => e.id === example.id)
              )
                precedentExamples.push(example);
            }
          }
        }

        const cacheKey = createHash('sha256')
          .update(
            JSON.stringify([
              c.id,
              c.transcriptHash,
              checklist.id,
              p.id,
              p.modelId,
              p.configurationId,
              this.candidateOptions.candidate
                ? [
                    POLICY_VERSION,
                    'facts-v1',
                    'candidate-validator-v1',
                    this.candidateOptions.deadlineMs ?? 120000,
                    this.candidateOptions.verifier?.id,
                    this.candidateOptions.verifier?.modelId,
                    this.candidateOptions.verifier?.configurationId,
                    checklist,
                    precedentExamples,
                  ]
                : PROMPT_VERSION,
            ]),
          )
          .digest('hex');
        if (!force) {
          const previous = this.db
            .prepare(
              "SELECT id FROM evaluations WHERE cache_key=? AND status IN ('completed','queued','running') ORDER BY rowid DESC LIMIT 1",
            )
            .get(cacheKey);
          if (previous) {
            recordCacheReceipt(this.db, {
              evaluationId: previous.id as string,
              conversationId: c.id,
              checklistVersionId: checklist.id,
              cacheKey,
            });
            return previous.id as string;
          }
        }
        const result: Evaluation = {
          ...(this.candidateOptions.priceSnapshot
            ? { priceSnapshot: structuredClone(this.candidateOptions.priceSnapshot) }
            : {}),
          id: randomUUID(),
          conversationId: c.id,
          checklistVersionId: checklist.id,
          providerId: p.id,
          modelId: p.modelId,
          configurationId: p.configurationId,
          promptVersion: this.candidateOptions.candidate ? POLICY_VERSION : PROMPT_VERSION,
          ...(this.candidateOptions.candidate
            ? {
                policyVersion: POLICY_VERSION,
                revision: 0,
                policySnapshot: this.policySnapshot(),
                precedentExamples,
              }
            : {}),
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
        (evaluation.policyVersion !== undefined &&
          evaluation.policySnapshot !== this.policySnapshot()) ||
        evaluation.promptVersion !==
          (this.candidateOptions.candidate ? POLICY_VERSION : PROMPT_VERSION)
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
  private async generate(
    evaluation: Evaluation,
    repair?: RepairContext,
    provider = this.provider!,
    remaining = this.requestTimeoutMs,
    criterionIds?: string[],
  ): Promise<ProviderResult> {
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
      timer = setTimeout(() => abort('TIMEOUT'), Math.min(this.requestTimeoutMs, remaining));
      stop = () => abort('INTERRUPTED');
      if (this.stopController.signal.aborted) stop();
      else this.stopController.signal.addEventListener('abort', stop, { once: true });
    });
    try {
      return await Promise.race([
        provider.generate({
          policyVersion: evaluation.policyVersion,
          precedents: evaluation.precedentExamples,
          conversation,
          checklist: criterionIds
            ? {
                ...checklist,
                criteria: checklist.criteria.filter((c) => criterionIds.includes(c.id)),
              }
            : checklist,
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
  private async runCandidate(evaluation: Evaluation) {
    initializeReviewStorage(this.db);
    const policy = new EvaluationPolicy(this.candidateOptions.deadlineMs);
    const conversation = new ConversationService(this.db).get(evaluation.conversationId)!;
    const checklist = new ChecklistService(this.db).get(evaluation.checklistVersionId)!;
    let primary: CandidateOutput | undefined;
    let primaryReasons: string[] = [];
    let repair: RepairContext | undefined;
    let stage: 'primary' | 'repair' | 'verifier' = 'primary';
    let provider = this.provider!;
    const review = (reasons: string[]) => {
      queueReview(this.db, evaluation, reasons);
      evaluation.originalAnswers = [];
      evaluation.effectiveAnswers = [];
      evaluation.originalScore = null;
      evaluation.finalScore = null;
      this.fail(evaluation, 'REVIEW_REQUIRED');
    };
    for (;;) {
      if (!policy.reserve()) {
        if (primary) review(['budget_exhausted']);
        else this.fail(evaluation, 'TIMEOUT');
        return;
      }
      const attempt: EvaluationAttempt = {
        ...(stage !== 'verifier' && evaluation.priceSnapshot
          ? { priceSnapshot: structuredClone(evaluation.priceSnapshot) }
          : {}),
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
      let response: ProviderResult | undefined;
      let failure: ProviderError | undefined;
      let parsed: CandidateOutput | undefined;
      try {
        response = await this.generate(
          evaluation,
          repair,
          provider,
          policy.remaining(),
          stage === 'verifier'
            ? checklist.criteria
                .filter(
                  (c) =>
                    primaryReasons.length > 0 ||
                    primary!.assessments.some(
                      (a) =>
                        a.status === 'resolved' &&
                        a.answer.criterionId === c.id &&
                        (a.answer.value === 'NA' || c.scoringMode === 'flag'),
                    ),
                )
                .map((c) => c.id)
            : undefined,
        );
        attempt.usage = safeUsage(response.usage);
        attempt.modelVersion = response.modelVersion ?? null;
        attempt.finishReason = response.finishReason ?? null;
        attempt.blockReason = response.blockReason ?? null;
        if (response.blockReason) throw new ProviderError('MODEL_BLOCKED', false);
        try {
          if (response.finishReason && response.finishReason !== 'STOP')
            throw new Error('Incomplete output');
          parsed = validateCandidate(
            JSON.parse(response.text),
            conversation,
            stage === 'verifier'
              ? {
                  ...checklist,
                  criteria: checklist.criteria.filter((c) =>
                    primary!.assessments.some(
                      (a) =>
                        a.status === 'resolved' &&
                        a.answer.criterionId === c.id &&
                        (a.answer.value === 'NA' ||
                          c.scoringMode === 'flag' ||
                          primaryReasons.length > 0),
                    ),
                  ),
                }
              : checklist,
          );
        } catch (error) {
          attempt.failureStage = 'schema';
          attempt.validationErrors = validationIssues(error);
          throw new ProviderError('INVALID_MODEL_OUTPUT', false);
        }
      } catch (error) {
        failure =
          error instanceof ProviderError ? error : new ProviderError('PROVIDER_FAILED', false);
        attempt.failureStage ??= 'provider';
      }
      attempt.status = failure ? 'failed' : 'completed';
      attempt.errorCode = failure?.code ?? null;
      attempt.finishedAt = new Date().toISOString();
      attempt.durationMs = Date.now() - Date.parse(attempt.startedAt);
      this.db.prepare('INSERT INTO evaluation_runs VALUES(?,?,?,?)').run(
        randomUUID(),
        evaluation.id,
        stage,
        JSON.stringify({
          output: parsed ?? null,
          raw: response?.text ?? null,
          attempt: attempt.number,
          preliminaryScore:
            parsed && parsed.assessments.every((a) => a.status === 'resolved')
              ? scoreEvaluation(
                  stage === 'verifier'
                    ? checklist.criteria.filter((c) =>
                        parsed!.assessments.some(
                          (a) => a.status === 'resolved' && a.answer.criterionId === c.id,
                        ),
                      )
                    : checklist.criteria,
                  parsed.assessments.flatMap((a) => (a.status === 'resolved' ? [a.answer] : [])),
                )
              : null,
        }),
      );
      this.save(evaluation);
      if (failure) {
        const delay = failure.retryAfterMs ?? this.retryDelayMs;
        if (failure.retryable && policy.retry(delay)) {
          try {
            await this.pause(delay);
          } catch {
            this.fail(evaluation, 'INTERRUPTED');
            return;
          }
          continue;
        }
        if (stage !== 'verifier' && failure.code === 'INVALID_MODEL_OUTPUT' && policy.repair()) {
          repair = {
            failureStage: attempt.failureStage,
            finishReason: attempt.finishReason,
            validationErrors: attempt.validationErrors,
          };
          stage = 'repair';
          continue;
        }
        if (primary) review(['verifier_unavailable']);
        else this.fail(evaluation, failure.code);
        return;
      }
      if (stage === 'verifier') {
        const disagreement = parsed!.assessments.some(
          (a) =>
            a.status !== 'resolved' ||
            primary!.assessments.some(
              (p) =>
                p.status === 'resolved' &&
                a.status === 'resolved' &&
                p.answer.criterionId === a.answer.criterionId &&
                p.answer.value !== a.answer.value,
            ),
        );
        if (disagreement) {
          review(['verifier_disagreement']);
          return;
        }
        if (primaryReasons.length || consistencyReasons(parsed!, conversation, checklist).length) {
          review([...primaryReasons, ...consistencyReasons(parsed!, conversation, checklist)]);
          return;
        }
      } else {
        primary = parsed!;
        primaryReasons = consistencyReasons(primary, conversation, checklist);
        if (primary.assessments.some((a) => a.status === 'unresolved')) {
          review(['unresolved']);
          return;
        }
        const risky =
          primaryReasons.length > 0 ||
          primary.assessments.some(
            (a) =>
              a.status === 'resolved' &&
              checklist.criteria.some(
                (c) =>
                  c.id === a.answer.criterionId &&
                  c.scoringMode === 'flag' &&
                  a.answer.value === true,
              ),
          );
        if (risky) {
          if (!this.candidateOptions.verifier) {
            review([
              'verification_required',
              ...primaryReasons,
              ...(primary.assessments.some(
                (a) =>
                  a.status === 'resolved' &&
                  a.answer.value === true &&
                  checklist.criteria.some(
                    (c) => c.id === a.answer.criterionId && c.scoringMode === 'flag',
                  ),
              )
                ? ['gross_requires_human']
                : []),
            ]);
            return;
          }
          provider = this.candidateOptions.verifier;
          stage = 'verifier';
          repair = undefined;
          continue;
        }
      }
      const answers = primary!.assessments.flatMap((a) =>
        a.status === 'resolved' ? [a.answer] : [],
      );
      if (
        answers.some(
          (a) =>
            a.value === true &&
            checklist.criteria.some((c) => c.id === a.criterionId && c.scoringMode === 'flag'),
        )
      ) {
        review(['gross_requires_human']);
        return;
      }
      evaluation.originalAnswers = answers;
      evaluation.effectiveAnswers = structuredClone(answers);
      evaluation.evidence = validateEvidence(conversation, answers, checklist.criteria);
      evaluation.originalScore = scoreEvaluation(checklist.criteria, answers);
      evaluation.finalScore = structuredClone(evaluation.originalScore);
      evaluation.status = 'completed';
      evaluation.finishedAt = new Date().toISOString();
      this.save(evaluation);
      return;
    }
  }

  private async run(evaluation: Evaluation) {
    if (evaluation.policyVersion) return this.runCandidate(evaluation);
    let transientRetries = 0;
    let repair: RepairContext | undefined;
    for (;;) {
      if (this.stopController.signal.aborted) {
        this.fail(evaluation, 'INTERRUPTED');
        return;
      }
      const attempt: EvaluationAttempt = {
        ...(evaluation.priceSnapshot
          ? { priceSnapshot: structuredClone(evaluation.priceSnapshot) }
          : {}),
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
