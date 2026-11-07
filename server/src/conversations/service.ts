import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  GroupIdSchema,
  SourceConversationSchema,
  type Conversation,
  type ImportResult,
} from '../../../shared/contracts.js';

export class ConversationService {
  constructor(private db: DatabaseSync) {}
  list(groupId?: string): Conversation[] {
    const rows =
      groupId === undefined
        ? this.db.prepare('SELECT payload FROM conversations ORDER BY rowid').all()
        : this.db
            .prepare('SELECT payload FROM conversations WHERE group_id=? ORDER BY rowid')
            .all(groupId);
    return rows.map((r) => JSON.parse(r.payload as string));
  }
  get(id: string): Conversation | undefined {
    const row = this.db.prepare('SELECT payload FROM conversations WHERE id=?').get(id);
    return row ? JSON.parse(row.payload as string) : undefined;
  }
  importRecords(groupInput: unknown, recordsInput: unknown): ImportResult {
    const groupId = GroupIdSchema.parse(groupInput);
    // Parse the entire batch before opening the transaction. One bad record rejects all.
    const records = z.array(SourceConversationSchema).min(1).parse(recordsInput);
    const result: ImportResult = { groupId, imported: 0, existing: 0, conversationIds: [] };
    const insert = this.db.prepare('INSERT OR IGNORE INTO conversations VALUES (?,?,?,?,?)');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const record of records) {
        const contentHash = createHash('sha256').update(JSON.stringify(record)).digest('hex');
        const id = createHash('sha256')
          .update(JSON.stringify([groupId, record.conversation_id, contentHash]))
          .digest('hex');
        const conversation: Conversation = {
          id,
          sourceConversationId: record.conversation_id,
          groupId,
          transcriptHash: contentHash,
          channel: record.channel,
          language: record.language,
          audioUrl: record.audio_url,
          messages: record.transcript.map((message, i) => ({
            id: `m${String(i + 1).padStart(4, '0')}`,
            ...message,
          })),
          importedAt: new Date().toISOString(),
        };
        const inserted = insert.run(
          id,
          groupId,
          record.conversation_id,
          contentHash,
          JSON.stringify(conversation),
        );
        if (inserted.changes) result.imported++;
        else result.existing++;
        result.conversationIds.push(id);
      }
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
