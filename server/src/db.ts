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
    );`);
  return db;
}
