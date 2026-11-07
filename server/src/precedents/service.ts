import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Express } from 'express';
import { z } from 'zod';
import type { CriterionAnswer, Evaluation } from '../../../shared/contracts.js';
import { ChecklistService } from '../checklists/service.js';
import { criterionFingerprint } from '../checklists/profiles.js';
import { ConversationService } from '../conversations/service.js';
import { HttpError } from '../errors.js';
export type ApprovedPrecedent = {
  id: string;
  decisionId: string;
  criterionId: string;
  example: string;
  value: CriterionAnswer['value'];
  approvedBy: string;
  approvedAt: string;
};
export const sourceFamily = (sourceId: string) =>
  sourceId.replace(/(^|[-_])(ru|kz|kk|en)(?=[-_]|$)/gi, '$1lang');
export function initializePrecedentStorage(db: DatabaseSync) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS precedents(id TEXT PRIMARY KEY,decision_id TEXT NOT NULL,fingerprint TEXT NOT NULL,channel TEXT NOT NULL,language TEXT NOT NULL,transcript_hash TEXT NOT NULL,source_family TEXT NOT NULL,payload TEXT NOT NULL);CREATE UNIQUE INDEX IF NOT EXISTS precedent_decision_fingerprint ON precedents(decision_id,fingerprint);CREATE TABLE IF NOT EXISTS precedent_exclusions(transcript_hash TEXT PRIMARY KEY);`,
  );
}
export class PrecedentService {
  constructor(private db: DatabaseSync) {}
  blockHashes(hashes: string[]) {
    const statement = this.db.prepare('INSERT OR IGNORE INTO precedent_exclusions VALUES (?)');
    for (const h of hashes) statement.run(h);
  }
  approve(raw: unknown): ApprovedPrecedent {
    const input = z
      .object({
        decisionId: z.string().min(1),
        criterionId: z.string().min(1),
        example: z.string().trim().min(10).max(1000),
        actor: z.string().trim().min(1).max(80),
      })
      .parse(raw);
    const exists = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='decision_journal'")
      .get();
    const row = exists
      ? this.db.prepare('SELECT payload FROM decision_journal WHERE id=?').get(input.decisionId)
      : undefined;
    if (!row)
      throw new HttpError(404, 'DECISION_NOT_FOUND', 'A resolved human decision is required');
    const decision = JSON.parse(row.payload as string) as {
      evaluation: Evaluation;
      answers?: CriterionAnswer[];
      action?: string;
    };
    const e = decision.evaluation;
    if (!e || e.status !== 'completed' || decision.action === 'defer')
      throw new HttpError(
        409,
        'DECISION_NOT_FINAL',
        'Only a completed human decision can be approved',
      );
    const c = new ConversationService(this.db).get(e.conversationId);
    const checklist = new ChecklistService(this.db).get(e.checklistVersionId);
    const criterion = checklist?.criteria.find((c) => c.id === input.criterionId);
    const answer = e.effectiveAnswers.find((a) => a.criterionId === input.criterionId);
    if (!c || !criterion || !answer)
      throw new HttpError(409, 'SOURCE_MISSING', 'Source criterion unavailable');
    if (
      this.db
        .prepare('SELECT transcript_hash FROM precedent_exclusions WHERE transcript_hash=?')
        .get(c.transcriptHash)
    )
      throw new HttpError(409, 'HOLDOUT_EXCLUDED', 'Holdout cannot become a precedent');
    // Store only a deliberately rewritten example, never source transcript or evidence quotes.
    if (/https?:\/\/|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|\d{7,}/.test(input.example))
      throw new HttpError(
        400,
        'EXAMPLE_NEEDS_REDACTION',
        'Remove contacts, links and long identifiers',
      );
    const result: ApprovedPrecedent = {
      id: randomUUID(),
      decisionId: input.decisionId,
      criterionId: input.criterionId,
      example: input.example,
      value: answer.value,
      approvedBy: input.actor,
      approvedAt: new Date().toISOString(),
    };
    const fp = criterionFingerprint(criterion);
    if (
      this.db
        .prepare('SELECT id FROM precedents WHERE decision_id=? AND fingerprint=?')
        .get(input.decisionId, fp)
    )
      throw new HttpError(409, 'PRECEDENT_EXISTS', 'Decision already approved for this criterion');
    this.db
      .prepare('INSERT INTO precedents VALUES (?,?,?,?,?,?,?,?)')
      .run(
        result.id,
        input.decisionId,
        fp,
        c.channel,
        c.language,
        c.transcriptHash,
        sourceFamily(c.sourceConversationId),
        JSON.stringify(result),
      );
    return result;
  }
  select(input: {
    fingerprint: string;
    channel: string;
    language: string;
    transcriptHash: string;
    sourceFamily: string;
  }) {
    const rows = this.db
      .prepare(
        `SELECT p.payload FROM precedents p WHERE fingerprint=? AND channel=? AND language=? AND transcript_hash<>? AND source_family<>? AND NOT EXISTS(SELECT 1 FROM precedent_exclusions x WHERE x.transcript_hash=p.transcript_hash) ORDER BY p.rowid DESC LIMIT 2`,
      )
      .all(
        input.fingerprint,
        input.channel,
        input.language,
        input.transcriptHash,
        input.sourceFamily,
      );
    const examples = rows.map((r) => JSON.parse(r.payload as string) as ApprovedPrecedent);
    return {
      examples,
      snapshot: createHash('sha256').update(JSON.stringify(examples)).digest('hex'),
    };
  }
}
export function installPrecedentRoutes(app: Express, db: DatabaseSync) {
  const service = new PrecedentService(db);
  app.post('/api/precedents', (req, res) => res.status(201).json(service.approve(req.body)));
}
