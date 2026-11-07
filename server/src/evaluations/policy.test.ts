import { describe, it, expect } from 'vitest';
import { EvaluationPolicy } from './policy.js';
describe('candidate shared budget', () => {
  it('bounds all stages to four actual calls and one shared retry/repair', () => {
    const p = new EvaluationPolicy();
    expect(p.reserve()).toBe(true);
    expect(p.retry(0)).toBe(true);
    expect(p.retry(0)).toBe(false);
    expect(p.repair()).toBe(true);
    expect(p.repair()).toBe(false);
    expect([p.reserve(), p.reserve(), p.reserve(), p.reserve()]).toEqual([true, true, true, false]);
  });
  it('includes backoff and forbids new calls after deadline', () => {
    let now = 0;
    const p = new EvaluationPolicy(20, () => now);
    expect(p.retry(20)).toBe(false);
    now = 20;
    expect(p.reserve()).toBe(false);
    expect(p.repair()).toBe(false);
  });
});
