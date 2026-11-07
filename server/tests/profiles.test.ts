import { it, expect } from 'vitest';
import { createDatabase } from '../src/db.js';
import { ChecklistService } from '../src/checklists/service.js';
import {
  ProfileService,
  initializeProfileStorage,
  checklistDiff,
  criterionFingerprint,
} from '../src/checklists/profiles.js';
import { defaultChecklist } from '../src/checklists/default.js';
it('saving a version does not activate it; activation validates family and expected active version', () => {
  const db = createDatabase(':memory:');
  try {
    const c = new ChecklistService(db);
    const v1 = c.seed();
    initializeProfileStorage(db);
    const p = new ProfileService(db);
    const legacy = p.list()[0];
    expect(legacy.activeVersionId).toBe(v1.id);
    const v2 = c.save('default', { ...defaultChecklist, title: 'v2' });
    expect(p.list()[0].activeVersionId).toBe(v1.id);
    const wrong = c.save('other', defaultChecklist);
    expect(() => p.activate(legacy.id, wrong.id, v1.id)).toThrow();
    expect(p.activate(legacy.id, v2.id, v1.id).activeVersionId).toBe(v2.id);
    expect(() => p.activate(legacy.id, v1.id, v1.id)).toThrow();
  } finally {
    db.close();
  }
});
it('distinguishes weight-only previews from semantic changes and fingerprints rules', () => {
  const before = {
    ...defaultChecklist,
    id: 'v1',
    checklistId: 'default',
    version: 1,
    createdAt: 'now',
  };
  const after = structuredClone(before);
  after.criteria[0].weight += 1;
  expect(checklistDiff(before, after).weightOnly).toBe(true);
  expect(criterionFingerprint(before.criteria[0])).toBe(criterionFingerprint(after.criteria[0]));
  after.criteria[0].naRule = 'new';
  expect(checklistDiff(before, after).weightOnly).toBe(false);
  expect(criterionFingerprint(before.criteria[0])).not.toBe(
    criterionFingerprint(after.criteria[0]),
  );
});
