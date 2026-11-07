import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Express } from 'express';
import { z } from 'zod';
import type { ChecklistVersion, Criterion } from '../../../shared/contracts.js';
import type { ChecklistProfile, ChecklistDiff } from '../../../shared/checklist-profiles.js';
import { ChecklistService } from './service.js';
import { HttpError } from '../errors.js';
export function criterionFingerprint(c: Criterion) {
  const { weight, ...semantics } = c;
  return createHash('sha256').update(JSON.stringify(semantics)).digest('hex');
}
export function checklistDiff(left: ChecklistVersion, right: ChecklistVersion): ChecklistDiff {
  const changes: ChecklistDiff['changes'] = [];
  for (const id of new Set([...left.criteria, ...right.criteria].map((c) => c.id))) {
    const a = left.criteria.find((c) => c.id === id),
      b = right.criteria.find((c) => c.id === id);
    for (const field of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
      const before = a?.[field as keyof Criterion] ?? null,
        after = b?.[field as keyof Criterion] ?? null;
      if (JSON.stringify(before) !== JSON.stringify(after))
        changes.push({ criterionId: id, field, before, after });
    }
  }
  const metadataChanged =
    left.title !== right.title || JSON.stringify(left.sections) !== JSON.stringify(right.sections);
  return {
    weightOnly:
      changes.length > 0 && !metadataChanged && changes.every((c) => c.field === 'weight'),
    changedCriterionIds: [...new Set(changes.map((c) => c.criterionId))],
    changes,
    metadataChanged,
  };
}
export function initializeProfileStorage(db: DatabaseSync) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS checklist_profiles(id TEXT PRIMARY KEY,payload TEXT NOT NULL);CREATE TABLE IF NOT EXISTS profile_activations(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES checklist_profiles(id),version_id TEXT NOT NULL REFERENCES checklist_versions(id),created_at TEXT NOT NULL);`,
  );
}
export class ProfileService {
  constructor(private db: DatabaseSync) {}
  list(): ChecklistProfile[] {
    let rows = this.db.prepare('SELECT payload FROM checklist_profiles ORDER BY rowid').all();
    if (!rows.length) {
      const versions = new ChecklistService(this.db)
        .list()
        .filter((v) => v.checklistId === 'default')
        .sort((a, b) => a.version - b.version);
      const v = versions[0];
      if (v) {
        this.create({
          id: 'legacy',
          title: 'Основной',
          checklistId: v.checklistId,
          channels: ['agent chat', 'voice call'],
          activeVersionId: v.id,
        });
        rows = this.db.prepare('SELECT payload FROM checklist_profiles ORDER BY rowid').all();
      }
    }
    return rows.map((r) => JSON.parse(r.payload as string));
  }
  create(input: Omit<ChecklistProfile, 'revision'>): ChecklistProfile {
    const v = new ChecklistService(this.db).get(input.activeVersionId);
    if (!v || v.checklistId !== input.checklistId)
      throw new HttpError(400, 'PROFILE_VERSION_MISMATCH', 'Version belongs to another checklist');
    const result = { ...input, revision: 1 };
    this.db
      .prepare('INSERT INTO checklist_profiles VALUES (?,?)')
      .run(result.id, JSON.stringify(result));
    return result;
  }
  activate(id: string, versionId: string, expectedActiveVersionId: string): ChecklistProfile {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT payload FROM checklist_profiles WHERE id=?').get(id);
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Profile not found');
      const profile: ChecklistProfile = JSON.parse(row.payload as string);
      if (profile.activeVersionId !== expectedActiveVersionId)
        throw new HttpError(409, 'STALE_PROFILE', 'Reload the profile before activation');
      const v = new ChecklistService(this.db).get(versionId);
      if (!v || v.checklistId !== profile.checklistId)
        throw new HttpError(
          400,
          'PROFILE_VERSION_MISMATCH',
          'Version belongs to another checklist',
        );
      profile.activeVersionId = v.id;
      profile.revision++;
      this.db
        .prepare('UPDATE checklist_profiles SET payload=? WHERE id=?')
        .run(JSON.stringify(profile), id);
      this.db
        .prepare('INSERT INTO profile_activations VALUES (?,?,?,?)')
        .run(randomUUID(), id, v.id, new Date().toISOString());
      this.db.exec('COMMIT');
      return profile;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}
export function installProfileRoutes(app: Express, db: DatabaseSync) {
  const service = new ProfileService(db);
  app.get('/api/checklist-profiles', (_req, res) => res.json(service.list()));
  app.post('/api/checklist-profiles', (req, res) => {
    const input = z
      .object({
        title: z.string().trim().min(1).max(120),
        checklistId: z.string().min(1),
        channels: z
          .array(z.enum(['agent chat', 'voice call']))
          .min(1)
          .max(2),
        activeVersionId: z.string().min(1),
      })
      .parse(req.body);
    res.status(201).json(service.create({ ...input, id: randomUUID() }));
  });
  app.post('/api/checklist-profiles/:id/activations', (req, res) => {
    const input = z
      .object({ versionId: z.string().min(1), expectedActiveVersionId: z.string().min(1) })
      .parse(req.body);
    res.json(service.activate(req.params.id, input.versionId, input.expectedActiveVersionId));
  });
  app.get('/api/checklist-diff', (req, res) => {
    const q = z.object({ left: z.string().min(1), right: z.string().min(1) }).parse(req.query);
    const c = new ChecklistService(db),
      a = c.get(q.left),
      b = c.get(q.right);
    if (!a || !b) throw new HttpError(404, 'NOT_FOUND', 'Checklist not found');
    res.json(checklistDiff(a, b));
  });
}
