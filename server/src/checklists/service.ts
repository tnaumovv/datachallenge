import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ChecklistInputSchema, type ChecklistVersion } from '../../../shared/contracts.js';
import { defaultChecklist } from './default.js';

export class ChecklistService {
  constructor(private db: DatabaseSync) {}
  list(): ChecklistVersion[] {
    return this.db
      .prepare('SELECT payload FROM checklist_versions ORDER BY checklist_id, version DESC')
      .all()
      .map((r) => JSON.parse(r.payload as string));
  }
  get(id: string): ChecklistVersion | undefined {
    const row = this.db.prepare('SELECT payload FROM checklist_versions WHERE id=?').get(id);
    return row ? JSON.parse(row.payload as string) : undefined;
  }
  seed(): ChecklistVersion {
    return (
      this.list().find((c) => c.checklistId === 'default') ?? this.save('default', defaultChecklist)
    );
  }
  save(checklistId: string, input: unknown): ChecklistVersion {
    const config = ChecklistInputSchema.parse(input);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db
        .prepare(
          'SELECT COALESCE(MAX(version),0) AS version FROM checklist_versions WHERE checklist_id=?',
        )
        .get(checklistId)!;
      const result: ChecklistVersion = {
        ...config,
        id: randomUUID(),
        checklistId,
        version: Number(row.version) + 1,
        createdAt: new Date().toISOString(),
      };
      this.db
        .prepare('INSERT INTO checklist_versions VALUES (?,?,?,?)')
        .run(result.id, checklistId, result.version, JSON.stringify(result));
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
