import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { KnowledgeService } from './service.js';
export function installKnowledgeRoutes(app: Express, db: DatabaseSync) {
  const service = new KnowledgeService(db);
  app.get('/api/knowledge', (_req, res) => res.json(service.list()));
  app.post('/api/knowledge', (req, res) => res.status(201).json(service.create(req.body)));
  app.patch('/api/knowledge/:id', (req, res) => {
    const { active } = z.object({ active: z.boolean() }).strict().parse(req.body);
    res.json(service.setActive(req.params.id as string, active));
  });
  app.post('/api/knowledge/search', (req, res) => res.json(service.search(req.body)));
}
