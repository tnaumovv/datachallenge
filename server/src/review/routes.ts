import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { ChecklistService } from '../checklists/service.js';
import { ConversationService } from '../conversations/service.js';
import { EvaluationService } from '../evaluations/service.js';
import { DecisionService } from './service.js';
export function installReviewRoutes(app: Express, db: DatabaseSync) {
  const service = new DecisionService(db);
  app.get('/api/review-items', (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    res.json(
      service
        .list()
        .filter((i) => !req.query.status || i.status === req.query.status)
        .sort(
          (a, b) =>
            Number(a.status !== 'open') - Number(b.status !== 'open') ||
            Number(!a.reasons.some((r) => r.includes('gross'))) -
              Number(!b.reasons.some((r) => r.includes('gross'))),
        )
        .slice(offset, offset + limit),
    );
  });
  app.get('/api/review-items/:id', (req, res) => {
    const item = service.list().find((i) => i.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Review item not found' } });
      return;
    }
    const evaluation = new EvaluationService(db).get(item.evaluationId)!;
    res.json({
      item,
      evaluation,
      conversation: new ConversationService(db).get(evaluation.conversationId),
      checklist: new ChecklistService(db).get(evaluation.checklistVersionId),
      decisions: db
        .prepare(
          'SELECT id,revision,payload FROM decision_journal WHERE evaluation_id=? ORDER BY revision',
        )
        .all(evaluation.id)
        .map((r) => {
          const d = JSON.parse(r.payload as string);
          return {
            id: r.id,
            revision: r.revision,
            createdAt: d.createdAt,
            action: d.action,
            reason: d.reason,
          };
        }),
      runs: db
        .prepare(
          'SELECT id,stage,payload FROM evaluation_runs WHERE evaluation_id=? ORDER BY rowid',
        )
        .all(evaluation.id)
        .map((r) => ({ id: r.id, stage: r.stage, ...JSON.parse(r.payload as string) })),
    });
  });
  app.post('/api/review-items/:id/decisions', (req, res) =>
    res.json(service.apply(String(req.params.id), req.body)),
  );
}
