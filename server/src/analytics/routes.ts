import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { CriterionAnswer, Evaluation, ScoreSummary } from '../../../shared/contracts.js';
import { ConversationFiltersSchema } from '../../../shared/contracts.js';
import type { ComparisonSide, EvaluationComparison } from '../../../shared/diagnostics.js';
import { ConversationService } from '../conversations/service.js';
import type { EvaluationService } from '../evaluations/service.js';
import { cacheReceipts, evaluationCost } from '../usage/ledger.js';

function reviewRequired(evaluation: Evaluation) {
  return (
    (evaluation as Evaluation & { reviewState?: string }).reviewState === 'required' ||
    evaluation.error?.code === 'REVIEW_REQUIRED'
  );
}
function differences(
  left: CriterionAnswer[],
  right: CriterionAnswer[],
  leftScore: ScoreSummary | null,
  rightScore: ScoreSummary | null,
): ComparisonSide {
  return {
    answers: [...new Set([...left, ...right].map((a) => a.criterionId))].map((criterionId) => {
      const l = left.find((a) => a.criterionId === criterionId) ?? null;
      const r = right.find((a) => a.criterionId === criterionId) ?? null;
      return { criterionId, left: l, right: r, changed: JSON.stringify(l) !== JSON.stringify(r) };
    }),
    leftScore,
    rightScore,
    totalDelta:
      leftScore?.total != null && rightScore?.total != null
        ? rightScore.total - leftScore.total
        : null,
  };
}
export function installDiagnosticsRoutes(
  app: Express,
  db: DatabaseSync,
  evaluations: Pick<EvaluationService, 'get' | 'list'>,
) {
  app.get('/api/evaluations/:id/diagnostics', (req, res) => {
    const evaluation = evaluations.get(req.params.id);
    if (!evaluation) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Evaluation not found' } });
      return;
    }
    res.json({
      schemaVersion: 1,
      evaluationId: evaluation.id,
      status: evaluation.status,
      provenance: {
        providerId: evaluation.providerId,
        modelId: evaluation.modelId,
        configurationId: evaluation.configurationId,
        promptVersion: evaluation.promptVersion,
        checklistVersionId: evaluation.checklistVersionId,
      },
      attempts: evaluation.attempts,
      usage: evaluation.usage,
      cost: evaluationCost(evaluation),
      reviewRequired: reviewRequired(evaluation),
      error: evaluation.error,
      cacheReceipts: cacheReceipts(db, evaluation.id),
    });
  });
  app.get('/api/evaluation-comparisons', (req, res) => {
    const query = z
      .object({ left: z.string().min(1), right: z.string().min(1) })
      .safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Select two evaluations' } });
      return;
    }
    const left = evaluations.get(query.data.left),
      right = evaluations.get(query.data.right);
    if (!left || !right) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Evaluation not found' } });
      return;
    }
    const hash = (evaluation: Evaluation) =>
      db.prepare('SELECT content_hash FROM conversations WHERE id=?').get(evaluation.conversationId)
        ?.content_hash;
    const leftHash = hash(left),
      rightHash = hash(right);
    if (!leftHash || leftHash !== rightHash) {
      res.status(409).json({
        error: {
          code: 'TRANSCRIPT_MISMATCH',
          message: 'Comparison requires identical transcript hashes',
        },
      });
      return;
    }
    const result: EvaluationComparison = {
      leftId: left.id,
      rightId: right.id,
      transcriptHash: String(leftHash),
      sameChecklistVersion: left.checklistVersionId === right.checklistVersionId,
      original: differences(
        left.originalAnswers,
        right.originalAnswers,
        left.originalScore,
        right.originalScore,
      ),
      effective: differences(
        left.effectiveAnswers,
        right.effectiveAnswers,
        left.finalScore,
        right.finalScore,
      ),
    };
    res.json(result);
  });
  app.get('/api/overview', (req, res) => {
    const filters = ConversationFiltersSchema.extend({
      checklistVersionId: z.string().min(1).optional(),
    }).safeParse(req.query);
    if (!filters.success) {
      res
        .status(400)
        .json({ error: { code: 'INVALID_INPUT', message: 'Invalid overview filters' } });
      return;
    }
    const f = filters.data;
    const conversations = new ConversationService(db)
      .list(f.groupId)
      .filter(
        (c) =>
          (!f.language || c.language === f.language) && (!f.channel || c.channel === f.channel),
      );
    const ids = new Set(conversations.map((c) => c.id));
    // EvaluationService.list is persisted rowid DESC: deterministic insertion order, including ties in timestamps.
    const selected = new Map<string, Evaluation>();
    for (const e of evaluations.list()) {
      if (
        !ids.has(e.conversationId) ||
        (f.checklistVersionId && e.checklistVersionId !== f.checklistVersionId)
      )
        continue;
      const key = JSON.stringify([e.conversationId, e.checklistVersionId]);
      if (!selected.has(key)) selected.set(key, e);
    }
    const rows = [...selected.values()];
    const completed = rows.filter((e) => e.status === 'completed' && !reviewRequired(e));
    const aggregate = (field: 'originalScore' | 'finalScore') => {
      const scored = completed.filter((e) => e[field]?.total != null);
      return {
        average: scored.length
          ? scored.reduce((n, e) => n + e[field]!.total!, 0) / scored.length
          : null,
        denominator: scored.length,
        incomplete:
          scored.length < rows.length ||
          new Set(rows.map((e) => e.conversationId)).size < conversations.length,
      };
    };
    res.json({
      schemaVersion: 1,
      filters: f,
      selection: {
        policy: 'latest_per_conversation_and_checklist_version',
        order: 'insertion_desc',
        evaluationIds: rows.map((e) => e.id),
      },
      coverage: {
        conversations: conversations.length,
        selected: rows.length,
        evaluatedConversations: new Set(rows.map((e) => e.conversationId)).size,
        unassessedConversations:
          conversations.length - new Set(rows.map((e) => e.conversationId)).size,
        completed: completed.length,
        failed: rows.filter((e) => e.status === 'failed').length,
        queued: rows.filter((e) => e.status === 'queued').length,
        running: rows.filter((e) => e.status === 'running').length,
        reviewRequired: rows.filter(reviewRequired).length,
      },
      grossViolations: completed.filter((e) => e.finalScore?.grossViolation).length,
      losses: Object.values(
        completed.reduce<Record<string, { criterionId: string; points: number; count: number }>>(
          (acc, e) => {
            for (const c of e.finalScore?.contributions ?? []) {
              if (c.points === null || c.maxPoints === null) continue;
              const loss = c.maxPoints - c.points;
              if (loss <= 0) continue;
              acc[c.criterionId] ??= { criterionId: c.criterionId, points: 0, count: 0 };
              acc[c.criterionId].points += loss;
              acc[c.criterionId].count++;
            }
            return acc;
          },
          {},
        ),
      ).sort((a, b) => b.points - a.points),
      original: aggregate('originalScore'),
      effective: aggregate('finalScore'),
    });
  });
}
