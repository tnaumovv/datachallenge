import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  KnowledgeInputSchema,
  KnowledgeSearchSchema,
  type KnowledgeDocument,
  type KnowledgeSnapshot,
} from '../../../shared/knowledge.js';
import type { Conversation } from '../../../shared/contracts.js';
import { HttpError } from '../errors.js';

export function initializeKnowledgeStorage(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS knowledge_documents (
    id TEXT PRIMARY KEY, document_key TEXT NOT NULL, version TEXT NOT NULL, payload TEXT NOT NULL,
    UNIQUE(document_key, version));
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks USING fts5(
      document_id UNINDEXED, chunk_index UNINDEXED, title, keywords, body,
      tokenize='unicode61 remove_diacritics 0');`);
}
function chunks(text: string): string[] {
  const result: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 1200, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf('\n', end);
      const space = text.lastIndexOf(' ', end);
      if (boundary > start + 600) end = boundary;
      else if (space > start + 600) end = space;
    }
    result.push(text.slice(start, end));
    start = end;
  }
  return result;
}
const stop = new Set(
  'здравствуйте спасибо пожалуйста меня здравствуйте добрый день вечер hello thanks thank you the and what this that with как что это для или мне вас вам ваш мой где есть можно здравствуйте сәлеметсіз рақмет'.split(
    ' ',
  ),
);
function queryExpressions(query: string) {
  const tokens = [
    ...new Set(
      query
        .toLowerCase()
        .normalize('NFKC')
        .match(/[\p{L}\p{N}]{3,}/gu) ?? [],
    ),
  ].filter((t) => !stop.has(t));
  const expressions: string[] = [];
  for (let i = 0; i < tokens.length; i += 64)
    expressions.push(
      tokens
        .slice(i, i + 64)
        .map((t) => '"' + t + '"*')
        .join(' OR '),
    );
  return expressions;
}
export class KnowledgeService {
  constructor(private db: DatabaseSync) {
    initializeKnowledgeStorage(db);
  }
  list(): KnowledgeDocument[] {
    return this.db
      .prepare('SELECT payload FROM knowledge_documents ORDER BY rowid DESC')
      .all()
      .map((r) => JSON.parse(r.payload as string));
  }
  private checkOverlap(
    doc: KnowledgeDocument | ReturnType<typeof KnowledgeInputSchema.parse>,
    ignoreId?: string,
  ) {
    if (
      doc.active &&
      this.list().some(
        (other) =>
          other.id !== ignoreId &&
          other.active &&
          other.documentKey === doc.documentKey &&
          (doc.effectiveFrom ?? '0000') <= (other.effectiveTo ?? '9999') &&
          (other.effectiveFrom ?? '0000') <= (doc.effectiveTo ?? '9999'),
      )
    )
      throw new HttpError(
        409,
        'KNOWLEDGE_OVERLAP',
        'Active versions have overlapping effective dates',
      );
  }
  create(input: unknown): KnowledgeDocument {
    const parsed = KnowledgeInputSchema.parse(input);
    if (
      this.list().some((d) => d.documentKey === parsed.documentKey && d.version === parsed.version)
    )
      throw new HttpError(409, 'KNOWLEDGE_VERSION_EXISTS', 'This version already exists');
    this.checkOverlap(parsed);
    const doc: KnowledgeDocument = {
      ...parsed,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      contentHash: createHash('sha256').update(parsed.text).digest('hex'),
    };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('INSERT INTO knowledge_documents VALUES (?,?,?,?)')
        .run(doc.id, doc.documentKey, doc.version, JSON.stringify(doc));
      const insert = this.db.prepare(
        'INSERT INTO knowledge_chunks(document_id,chunk_index,title,keywords,body) VALUES (?,?,?,?,?)',
      );
      chunks(doc.text).forEach((body, index) =>
        insert.run(doc.id, index, doc.title, doc.keywords, body),
      );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return doc;
  }
  setActive(id: string, active: boolean) {
    const doc = this.list().find((d) => d.id === id);
    if (!doc) throw new HttpError(404, 'NOT_FOUND', 'Document not found');
    KnowledgeInputSchema.parse({
      ...Object.fromEntries(
        Object.entries(doc).filter(([key]) => !['id', 'createdAt', 'contentHash'].includes(key)),
      ),
      active,
    });
    this.checkOverlap({ ...doc, active }, id);
    doc.active = active;
    this.db
      .prepare('UPDATE knowledge_documents SET payload=? WHERE id=?')
      .run(JSON.stringify(doc), id);
    return doc;
  }
  search(input: unknown): KnowledgeSnapshot {
    const { query, date } = KnowledgeSearchSchema.parse(input);
    return this.retrieve(query, date);
  }
  private retrieve(query: string, date?: string): KnowledgeSnapshot {
    const all = this.list().filter((d) => d.active && !d.demo);
    const eligible = all.filter((d) =>
      date
        ? (!d.effectiveFrom || d.effectiveFrom <= date) && (!d.effectiveTo || date <= d.effectiveTo)
        : !d.effectiveFrom && !d.effectiveTo,
    );
    const snapshot: KnowledgeSnapshot = {
      retrievalVersion: 'fts-v1',
      status: all.length ? 'no_match' : 'empty',
      date: date ?? null,
      sources: [],
      datedRulesSkipped: !date && all.some((d) => !!d.effectiveFrom || !!d.effectiveTo),
    };
    if (snapshot.datedRulesSkipped) snapshot.status = 'date_unknown';
    if (!eligible.length) return snapshot;
    const expressions = queryExpressions(query);
    if (!expressions.length) return snapshot;
    const byId = new Map(eligible.map((d) => [d.id, d]));
    // Filter eligibility before ranking/limit so inactive history cannot crowd out live rules.
    const statement = this.db.prepare(`SELECT document_id,chunk_index,body,
      bm25(knowledge_chunks,0,0,4,3,1) AS rank FROM knowledge_chunks
      WHERE knowledge_chunks MATCH ? AND document_id IN (SELECT value FROM json_each(?))
      ORDER BY rank, document_id, CAST(chunk_index AS INTEGER)`);
    const ids = JSON.stringify([...byId.keys()]);
    const matches = new Map<
      string,
      { document_id: string; chunk_index: number; body: string; rank: number }
    >();
    for (const expression of expressions) {
      for (const row of statement.all(expression, ids)) {
        const item = row as unknown as {
          document_id: string;
          chunk_index: number;
          body: string;
          rank: number;
        };
        const key = item.document_id + ':' + item.chunk_index;
        const previous = matches.get(key);
        matches.set(key, { ...item, rank: (previous?.rank ?? 0) + item.rank });
      }
    }
    const rows = [...matches.values()]
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          a.document_id.localeCompare(b.document_id) ||
          a.chunk_index - b.chunk_index,
      )
      .slice(0, 4);
    snapshot.sources = rows.map((row, i) => {
      const d = byId.get(row.document_id as string)!;
      return {
        reference: 'K' + (i + 1),
        id: d.id,
        documentKey: d.documentKey,
        title: d.title,
        source: d.source,
        version: d.version,
        language: d.language,
        effectiveFrom: d.effectiveFrom,
        effectiveTo: d.effectiveTo,
        contentHash: d.contentHash,
        chunkIndex: Number(row.chunk_index),
        text: row.body as string,
      };
    });
    if (snapshot.sources.length) snapshot.status = 'matched';
    return snapshot;
  }
  forConversation(conversation: Conversation) {
    // Relative timestamps do not establish a date. Never substitute import/server time.
    const stamp = conversation.messages[0]?.timestamp ?? '';
    const date =
      /^\d{4}-\d{2}-\d{2}T/.test(stamp) &&
      Number.isFinite(Date.parse(stamp)) &&
      z.iso.date().safeParse(stamp.slice(0, 10)).success
        ? stamp.slice(0, 10)
        : undefined;
    const query = conversation.messages
      .map((m) => m.text)
      .join('\n')
      .trim();
    return this.retrieve(query, date);
  }
}
