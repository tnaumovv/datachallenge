import { describe, expect, it } from 'vitest';
import { version } from '../tests/fixtures';
import { answerTone } from './review-format';

describe('criterion result meaning', () => {
  const contact = version.criteria.find((item) => item.id === 'contact')!;
  const consultation = version.criteria.find((item) => item.id === 'consultation')!;
  const violation = version.criteria.find((item) => item.scoringMode === 'flag')!;

  it('distinguishes a missed action from a gross violation', () => {
    expect(answerTone(contact, false)).toBe('attention');
    expect(answerTone(contact, true)).toBe('positive');
    expect(answerTone(violation, true)).toBe('violation');
    expect(answerTone(violation, false)).toBe('positive');
  });

  it('does not mark zero or a partial scale answer as completed', () => {
    expect(answerTone(consultation, 0)).toBe('attention');
    expect(answerTone(consultation, 1)).toBe('attention');
    expect(answerTone(consultation, Math.max(...consultation.levels))).toBe('positive');
  });

  it('keeps N/A and unanswered criteria distinct from success', () => {
    expect(answerTone(contact, 'NA')).toBe('neutral');
    expect(answerTone(violation, 'NA')).toBe('neutral');
    expect(answerTone(contact)).toBe('pending');
  });
});
