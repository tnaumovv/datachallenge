import { it, expect } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../src/db.js';
it('backs up an existing database before additive migrations and records them once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cqa-migration-'));
  try {
    const path = join(dir, 'db.sqlite');
    let db = new DatabaseSync(path);
    db.exec("CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES ('keep')");
    db.close();
    db = createDatabase(path);
    expect(db.prepare('SELECT value FROM sentinel').get()?.value).toBe('keep');
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()?.n).toBeGreaterThan(0);
    db.close();
    const backups = readdirSync(dir).filter((p) => p.includes('backup'));
    expect(backups).toHaveLength(1);
    const backup = new DatabaseSync(join(dir, backups[0]), { readOnly: true });
    expect(backup.prepare('SELECT value FROM sentinel').get()?.value).toBe('keep');
    backup.close();
    createDatabase(path).close();
    expect(readdirSync(dir).filter((p) => p.includes('backup'))).toHaveLength(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
