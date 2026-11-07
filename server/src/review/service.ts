import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Evaluation } from '../../../shared/contracts.js';
import { ReviewDecisionSchema, type ReviewItem } from '../../../shared/evaluation-policy.js';
import { ChecklistService } from '../checklists/service.js';
import { ConversationService } from '../conversations/service.js';
import { validateEvidence } from '../evaluations/evidence.js';
import { scoreEvaluation } from '../evaluations/scoring.js';
import { HttpError } from '../errors.js';
export function initializeReviewStorage(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS evaluation_runs(id TEXT PRIMARY KEY,evaluation_id TEXT NOT NULL,stage TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS review_items(id TEXT PRIMARY KEY,evaluation_id TEXT NOT NULL UNIQUE,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS decision_journal(id TEXT PRIMARY KEY,evaluation_id TEXT NOT NULL,revision INTEGER NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,UNIQUE(evaluation_id,revision));`);
}
export function queueReview(db: DatabaseSync, evaluation: Evaluation, reasons: string[]) {
  initializeReviewStorage(db);
  const item: ReviewItem = {
    id: evaluation.id,
    evaluationId: evaluation.id,
    status: 'open',
    revision: evaluation.revision ?? 0,
    reasons,
    createdAt: new Date().toISOString(),
  };
  db.prepare('INSERT OR IGNORE INTO review_items VALUES(?,?,?)').run(
    item.id,
    item.evaluationId,
    JSON.stringify(item),
  );
  evaluation.reviewState = 'required';
  evaluation.reviewReasons = reasons;
}
export class DecisionService {
  constructor(private db: DatabaseSync) {
    initializeReviewStorage(db);
  }
  list(): ReviewItem[] {
    return this.db
      .prepare('SELECT payload FROM review_items ORDER BY rowid')
      .all()
      .map((r) => JSON.parse(r.payload as string));
  }
  /** Caller may share this transaction with an appeal update. */
  apply(
    evaluationId: string,
    input: unknown,
    inTransaction = false,
    legacyAppeal = false,
  ): Evaluation {
    const data = ReviewDecisionSchema.parse(input),
      serialized = JSON.stringify({ evaluationId, ...data });
    if (!inTransaction) this.db.exec('BEGIN IMMEDIATE');
    try {
      const replay = this.db
        .prepare('SELECT payload FROM decision_journal WHERE idempotency_key=?')
        .get(data.idempotencyKey);
      if (replay) {
        const record = JSON.parse(replay.payload as string);
        if (record.request !== serialized)
          throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Key already used for another decision');
        if (!inTransaction) this.db.exec('COMMIT');
        return record.evaluation;
      }
      const row = this.db.prepare('SELECT payload FROM evaluations WHERE id=?').get(evaluationId);
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Evaluation not found');
      const evaluation: Evaluation = JSON.parse(row.payload as string);
      const beforeEvaluation = structuredClone(evaluation);
      if ((evaluation.revision ?? 0) !== data.expectedRevision)
        throw new HttpError(409, 'REVISION_CONFLICT', 'Evaluation changed; reload before deciding');
      if (evaluation.status !== 'completed' && evaluation.error?.code !== 'REVIEW_REQUIRED')
        throw new HttpError(409, 'NOT_REVIEWABLE', 'Evaluation has no valid review candidate');
      if (data.action === 'resolve') {
        if (!data.answers)
          throw new HttpError(400, 'ANSWERS_REQUIRED', 'A complete answer set is required');
        const checklist = new ChecklistService(this.db).get(evaluation.checklistVersionId)!;
        const conversation = new ConversationService(this.db).get(evaluation.conversationId)!;
        const score = scoreEvaluation(checklist.criteria, data.answers);
        const evidence =
          legacyAppeal && !evaluation.policyVersion
            ? evaluation.evidence
            : validateEvidence(conversation, data.answers, checklist.criteria);
        if (evaluation.originalAnswers.length === 0) evaluation.evaluationSource = 'human_review';
        evaluation.effectiveAnswers = structuredClone(data.answers);
        evaluation.finalScore = score;
        evaluation.evidence = evidence;
        evaluation.status = 'completed';
        evaluation.error = null;
        if (!legacyAppeal) evaluation.reviewState = 'resolved';
      }
      evaluation.revision = (evaluation.revision ?? 0) + 1;
      this.db
        .prepare('UPDATE evaluations SET status=?,payload=? WHERE id=?')
        .run(evaluation.status, JSON.stringify(evaluation), evaluation.id);
      const item = this.list().find((i) => i.evaluationId === evaluationId);
      if (item) {
        item.revision = evaluation.revision;
        if (data.action === 'resolve') item.status = 'resolved';
        this.db
          .prepare('UPDATE review_items SET payload=? WHERE id=?')
          .run(JSON.stringify(item), item.id);
      }
      this.db.prepare('INSERT INTO decision_journal VALUES(?,?,?,?,?)').run(
        randomUUID(),
        evaluationId,
        evaluation.revision,
        data.idempotencyKey,
        JSON.stringify({
          request: serialized,
          actor: 'demo-reviewer',
          before: beforeEvaluation,
          after: evaluation,
          source: legacyAppeal ? 'appeal' : 'review',
          reason: data.reason,
          action: data.action,
          answers: data.answers ?? null,
          evaluation,
          createdAt: new Date().toISOString(),
        }),
      );
      if (!inTransaction) this.db.exec('COMMIT');
      return evaluation;
    } catch (error) {
      if (!inTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
