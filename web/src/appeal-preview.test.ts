import { describe, expect, it } from 'vitest';
import type { Criterion, CriterionAnswer } from '../../shared/contracts.js';
import { buildDecision, buildPreviewRequest } from './appeal-preview';
const criterion: Criterion = {
  id: 'consultation',
  sectionId: 'solution',
  title: 'Консультация',
  instruction: 'Полнота',
  answerType: 'scale',
  scoringMode: 'weighted',
  weight: 20,
  levels: [0, 5, 10, 15, 20],
  levelDescriptions: {},
  allowNA: true,
  naRule: 'Нет запроса',
};
describe('human decision and server score preview', () => {
  it('requires a reason and rejects values outside the versioned scale', () => {
    expect(buildDecision(criterion, 'change', 17, 'Проверено')).toBeNull();
    expect(buildDecision(criterion, 'change', 20, '  ')).toBeNull();
    expect(buildDecision(criterion, 'confirm', undefined, ' Исходный ответ верен ')).toEqual({
      decision: 'confirm',
      reason: 'Исходный ответ верен',
    });
  });
  it('allows N/A only when the original version permits it', () => {
    expect(
      buildDecision({ ...criterion, allowNA: false }, 'change', 'NA', 'Нет запроса'),
    ).toBeNull();
    expect(buildDecision(criterion, 'change', 'NA', 'Нет запроса')).toEqual({
      decision: 'change',
      replacementValue: 'NA',
      reason: 'Нет запроса',
    });
  });
  it('previews one replacement, retains other human corrections and never mutates originals', () => {
    const answers: CriterionAnswer[] = [
      {
        criterionId: 'consultation',
        value: 15,
        explanation: 'AI',
        naReason: null,
        evidenceMessageIds: ['m1'],
        checkedSpanMessageIds: [],
      },
      {
        criterionId: 'closing',
        value: true,
        explanation: 'Предыдущее решение',
        naReason: null,
        evidenceMessageIds: [],
        checkedSpanMessageIds: [],
      },
    ];
    const snapshot = JSON.stringify(answers);
    const request = buildPreviewRequest(
      { checklistVersionId: 'v1', effectiveAnswers: answers },
      'consultation',
      { decision: 'change', replacementValue: 20, reason: 'Есть инструкция' },
    );
    expect(request.checklistVersionId).toBe('v1');
    expect(request.answers[0]).toMatchObject({
      value: 20,
      explanation: 'Есть инструкция',
      evidenceMessageIds: [],
      checkedSpanMessageIds: [],
    });
    expect(request.answers[1]).toEqual(answers[1]);
    expect(JSON.stringify(answers)).toBe(snapshot);
    expect(request).not.toHaveProperty('total');
  });
});
