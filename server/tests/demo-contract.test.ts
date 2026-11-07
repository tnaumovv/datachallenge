import { describe, expect, it } from 'vitest';
import { conversation, evaluation, version } from '../../web/tests/fixtures.js';
import { validateEvidence } from '../src/evaluations/evidence.js';

describe('isolated UI fixtures', () => {
  it('satisfy the real evidence contract without external model calls', () => {
    expect(() =>
      validateEvidence(conversation, evaluation.originalAnswers, version.criteria),
    ).not.toThrow();
  });
});
