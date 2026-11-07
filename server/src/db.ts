import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, source_id TEXT NOT NULL,
      content_hash TEXT NOT NULL, payload TEXT NOT NULL,
      UNIQUE(group_id, source_id, content_hash)
    );
    CREATE INDEX IF NOT EXISTS conversations_group ON conversations(group_id);
    CREATE TABLE IF NOT EXISTS checklist_versions (
      id TEXT PRIMARY KEY, checklist_id TEXT NOT NULL, version INTEGER NOT NULL,
      payload TEXT NOT NULL, UNIQUE(checklist_id, version)
    );
    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      checklist_version_id TEXT NOT NULL REFERENCES checklist_versions(id),
      cache_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed')),
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS evaluations_cache ON evaluations(cache_key, status);
    CREATE INDEX IF NOT EXISTS evaluations_conversation ON evaluations(conversation_id);
    CREATE INDEX IF NOT EXISTS evaluations_status ON evaluations(status);
    CREATE TABLE IF NOT EXISTS appeals (
      id TEXT PRIMARY KEY,
      evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
      criterion_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','resolved')),
      payload TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS appeals_pending ON appeals(evaluation_id,criterion_id) WHERE status='pending';
    CREATE INDEX IF NOT EXISTS appeals_evaluation ON appeals(evaluation_id);
    `);
  return db;
}
