import express, { type ErrorRequestHandler } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  ConversationFiltersSchema,
  ImportRequestSchema,
  ScoreRequestSchema,
  EvaluationRequestSchema,
  AppealFiltersSchema,
} from '../../shared/contracts.js';
import { ChecklistService } from './checklists/service.js';
import { ConversationService } from './conversations/service.js';
import { fetchOrganizerRecords, type Fetcher } from './conversations/organizer.js';
import { scoreEvaluation } from './evaluations/scoring.js';
import { HttpError } from './errors.js';
import { EvaluationService } from './evaluations/service.js';
import { AppealService } from './appeals/service.js';

export function createApp(
  db: DatabaseSync,
  options: { organizerUrl?: string; fetcher?: Fetcher; evaluations?: EvaluationService } = {},
) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));
  const conversations = new ConversationService(db);
  const checklists = new ChecklistService(db);
  checklists.seed();
  const evaluations = options.evaluations ?? new EvaluationService(db);
  const appeals = new AppealService(db);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.post('/api/import', async (req, res) => {
    const input = ImportRequestSchema.parse(req.body);
    const records =
      input.source === 'json'
        ? input.records
        : await fetchOrganizerRecords(options.organizerUrl, input.groupId, options.fetcher);
    const result = conversations.importRecords(input.groupId, records);
    res.status(result.imported ? 201 : 200).json(result);
  });
  app.get('/api/conversations', (req, res) => {
    const filters = ConversationFiltersSchema.parse(req.query);
    res.json(
      conversations
        .list(filters.groupId)
        .filter(
          (c) =>
            (!filters.language || c.language === filters.language) &&
            (!filters.channel || c.channel === filters.channel),
        ),
    );
  });
  app.get('/api/conversations/:id', (req, res) => {
    const item = conversations.get(req.params.id);
    if (!item) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found');
    res.json(item);
  });
  app.get('/api/checklists', (_req, res) => res.json(checklists.list()));
  app.get('/api/checklists/:id', (req, res) => {
    const item = checklists.get(req.params.id);
    if (!item) throw new HttpError(404, 'NOT_FOUND', 'Checklist version not found');
    res.json(item);
  });
  app.post('/api/checklists/:checklistId/versions', (req, res) =>
    res.status(201).json(checklists.save(req.params.checklistId, req.body)),
  );
  app.post('/api/score', (req, res) => {
    const input = ScoreRequestSchema.parse(req.body);
    const config = checklists.get(input.checklistVersionId);
    if (!config) throw new HttpError(404, 'NOT_FOUND', 'Checklist version not found');
    res.json({ checklistVersionId: config.id, ...scoreEvaluation(config.criteria, input.answers) });
  });
  app.post('/api/evaluations', (req, res) => {
    const input = EvaluationRequestSchema.parse(req.body);
    res.status(202).json({
      evaluationIds: evaluations.enqueue(
        input.conversationIds,
        input.checklistVersionId,
        input.force,
      ),
    });
  });
  app.get('/api/evaluations', (req, res) => {
    const conversationId = z.string().min(1).optional().parse(req.query.conversationId);
    res.json(evaluations.list(conversationId));
  });
  app.get('/api/evaluations/:id', (req, res) => {
    const evaluation = evaluations.get(req.params.id);
    if (!evaluation) throw new HttpError(404, 'NOT_FOUND', 'Evaluation not found');
    res.json(evaluation);
  });
  app.post('/api/evaluations/:id/retry', (req, res) =>
    res.status(202).json({ evaluationIds: [evaluations.retry(req.params.id)] }),
  );
  app.post('/api/appeals', (req, res) => res.status(201).json(appeals.submit(req.body)));
  app.get('/api/appeals', (req, res) =>
    res.json(appeals.list(AppealFiltersSchema.parse(req.query))),
  );
  app.get('/api/appeals/:id', (req, res) => {
    const appeal = appeals.get(req.params.id);
    if (!appeal) throw new HttpError(404, 'NOT_FOUND', 'Appeal not found');
    res.json(appeal);
  });
  app.post('/api/appeals/:id/decision', (req, res) =>
    res.json(appeals.resolve(req.params.id, req.body)),
  );
  app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Route not found')));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof z.ZodError || error?.type === 'entity.parse.failed') {
      res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'Request does not match the API schema' },
      });
      return;
    }
    if (error?.type === 'entity.too.large') {
      res
        .status(413)
        .json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Maximum JSON body size is 10 MB' } });
      return;
    }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  };
  app.use(errors);
  return app;
}
