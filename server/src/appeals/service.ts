import { DecisionService } from '../review/service.js';
import { ConversationService } from '../conversations/service.js';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  AppealInputSchema,
  AppealFiltersSchema,
  DecisionInputSchema,
  type Appeal,
  type AppealFilters,
  type Evaluation,
} from '../../../shared/contracts.js';
import { EvaluationService } from '../evaluations/service.js';
import { ChecklistService } from '../checklists/service.js';
import { scoreEvaluation } from '../evaluations/scoring.js';
import { HttpError } from '../errors.js';

export class AppealService {
  constructor(private db: DatabaseSync) {}
  get(id: string): Appeal | undefined {
    const row = this.db.prepare('SELECT payload FROM appeals WHERE id=?').get(id);
    return row ? JSON.parse(row.payload as string) : undefined;
  }
  list(input: AppealFilters = {}): Appeal[] {
    const filters = AppealFiltersSchema.parse(input);
    return this.db
      .prepare('SELECT payload FROM appeals ORDER BY rowid')
      .all()
      .map((r) => JSON.parse(r.payload as string) as Appeal)
      .filter(
        (a) =>
          (!filters.evaluationId || a.evaluationId === filters.evaluationId) &&
          (!filters.status || a.status === filters.status),
      );
  }
  private completed(id: string): Evaluation {
    const evaluation = new EvaluationService(this.db).get(id);
    if (!evaluation) throw new HttpError(404, 'NOT_FOUND', 'Evaluation not found');
    if (evaluation.status !== 'completed')
      throw new HttpError(
        409,
        'EVALUATION_NOT_COMPLETED',
        'Only completed evaluations can be appealed',
      );
    return evaluation;
  }
  submit(input: unknown): Appeal {
    const data = AppealInputSchema.parse(input);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const evaluation = this.completed(data.evaluationId);
      const answer = evaluation.effectiveAnswers.find((a) => a.criterionId === data.criterionId);
      if (!answer) throw new HttpError(404, 'NOT_FOUND', 'Criterion not found in evaluation');
      if (
        this.db
          .prepare(
            "SELECT id FROM appeals WHERE evaluation_id=? AND criterion_id=? AND status='pending'",
          )
          .get(data.evaluationId, data.criterionId)
      )
        throw new HttpError(409, 'APPEAL_PENDING', 'This criterion already has a pending appeal');
      const appeal: Appeal = {
        ...data,
        id: randomUUID(),
        status: 'pending',
        decision: null,
        replacementValue: null,
        reason: null,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        beforeAnswer: structuredClone(answer),
        afterAnswer: null,
        scoreBefore: null,
        scoreAfter: null,
      };
      this.db
        .prepare('INSERT INTO appeals VALUES (?,?,?,?,?)')
        .run(
          appeal.id,
          appeal.evaluationId,
          appeal.criterionId,
          appeal.status,
          JSON.stringify(appeal),
        );
      this.db.exec('COMMIT');
      return appeal;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  resolve(id: string, input: unknown): Evaluation {
    const decision = DecisionInputSchema.parse(input);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const appeal = this.get(id);
      if (!appeal) throw new HttpError(404, 'NOT_FOUND', 'Appeal not found');
      if (appeal.status !== 'pending')
        throw new HttpError(409, 'APPEAL_RESOLVED', 'Appeal is already resolved');
      const evaluation = this.completed(appeal.evaluationId);
      if (evaluation.policyVersion && decision.expectedRevision === undefined)
        throw new HttpError(
          400,
          'REVISION_REQUIRED',
          'Candidate decisions require expectedRevision',
        );
      if (evaluation.policyVersion && decision.decision === 'change' && !decision.replacementAnswer)
        throw new HttpError(
          400,
          'ANSWER_REQUIRED',
          'Candidate corrections require a complete replacementAnswer with evidence',
        );
      if (
        decision.decision === 'change' &&
        decision.replacementAnswer &&
        (decision.replacementAnswer.criterionId !== appeal.criterionId ||
          decision.replacementAnswer.value !== decision.replacementValue)
      )
        throw new HttpError(
          400,
          'ANSWER_MISMATCH',
          'Replacement answer must match criterion and value',
        );
      const index = evaluation.effectiveAnswers.findIndex(
        (a) => a.criterionId === appeal.criterionId,
      );
      if (index < 0)
        throw new HttpError(409, 'CRITERION_MISSING', 'Criterion is missing from evaluation');
      const before = evaluation.effectiveAnswers[index];
      if (JSON.stringify(before) !== JSON.stringify(appeal.beforeAnswer))
        throw new HttpError(409, 'STALE_APPEAL', 'Criterion changed since appeal was submitted');
      const checklist = new ChecklistService(this.db).get(evaluation.checklistVersionId);
      if (!checklist)
        throw new HttpError(409, 'CHECKLIST_MISSING', 'Original checklist version is unavailable');
      appeal.scoreBefore = structuredClone(evaluation.finalScore);
      if (decision.decision === 'change') {
        // AI evidence belongs to the original answer. A human correction carries its own reason.
        evaluation.effectiveAnswers[index] = decision.replacementAnswer ?? {
          ...before,
          value: decision.replacementValue,
          explanation: decision.reason,
          naReason: decision.replacementValue === 'NA' ? decision.reason : null,
          evidenceMessageIds: [],
          checkedSpanMessageIds: [],
        };
        evaluation.finalScore = scoreEvaluation(checklist.criteria, evaluation.effectiveAnswers);
      }
      appeal.status = 'resolved';
      appeal.decision = decision.decision;
      appeal.reason = decision.reason;
      appeal.replacementValue = decision.decision === 'change' ? decision.replacementValue : null;
      appeal.resolvedAt = new Date().toISOString();
      appeal.afterAnswer = structuredClone(evaluation.effectiveAnswers[index]);
      appeal.scoreAfter = structuredClone(evaluation.finalScore);
      const updated = new DecisionService(this.db).apply(
        evaluation.id,
        {
          expectedRevision: decision.expectedRevision ?? evaluation.revision ?? 0,
          idempotencyKey: 'appeal:' + appeal.id,
          action: 'resolve',
          reason: decision.reason,
          answers: evaluation.effectiveAnswers,
        },
        true,
        true,
      );
      this.db
        .prepare('UPDATE appeals SET status=?,payload=? WHERE id=?')
        .run(appeal.status, JSON.stringify(appeal), id);
      this.db.exec('COMMIT');
      return updated;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
