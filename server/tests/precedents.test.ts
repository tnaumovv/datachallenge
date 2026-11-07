import { it, expect } from 'vitest';
import { createDatabase } from '../src/db.js';
import { initializePrecedentStorage, PrecedentService } from '../src/precedents/service.js';
it('never approves model-only output or unknown decision IDs', () => {
  const db = createDatabase(':memory:');
  try {
    initializePrecedentStorage(db);
    const service = new PrecedentService(db);
    expect(() =>
      service.approve({
        decisionId: 'unknown',
        criterionId: 'contact',
        example: 'A short sanitized example',
        actor: 'reviewer',
      }),
    ).toThrow();
  } finally {
    db.close();
  }
});
it('selects at most two matches and excludes source, duplicate family and holdout hashes', () => {
  const db = createDatabase(':memory:');
  try {
    initializePrecedentStorage(db);
    for (let i = 0; i < 5; i++)
      db.prepare('INSERT INTO precedents VALUES (?,?,?,?,?,?,?,?)').run(
        'p' + i,
        'd' + i,
        'fingerprint',
        'agent chat',
        'RU',
        'hash' + i,
        'family' + i,
        JSON.stringify({ id: 'p' + i, example: 'example ' + i }),
      );
    const service = new PrecedentService(db);
    service.blockHashes(['hash0', 'hash1']);
    const result = service.select({
      fingerprint: 'fingerprint',
      channel: 'agent chat',
      language: 'RU',
      transcriptHash: 'hash2',
      sourceFamily: 'family3',
    });
    expect(result.examples.map((x) => x.id)).toEqual(['p4']);
    expect(
      service.select({
        fingerprint: 'other',
        channel: 'agent chat',
        language: 'RU',
        transcriptHash: 'none',
        sourceFamily: 'none',
      }).examples,
    ).toEqual([]);
  } finally {
    db.close();
  }
});
