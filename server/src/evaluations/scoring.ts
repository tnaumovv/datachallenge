import { z } from 'zod';
import {
  CriterionSchema,
  CriterionAnswerSchema,
  type CriterionConfig,
  type CriterionAnswer,
  type ScoreSummary,
} from '../../../shared/contracts.js';
import { OutputValidationError } from './validation.js';
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const invalid = (code: string, path: (string | number)[], message: string): never => {
  throw new OutputValidationError(code, path, message);
};

export function validateCriterionAnswer(
  criterion: CriterionConfig,
  answer: CriterionAnswer,
  path: (string | number)[] = [],
): void {
  const c = CriterionSchema.parse(criterion);
  const a = CriterionAnswerSchema.parse(answer);
  if (a.criterionId !== c.id)
    invalid(
      'CRITERION_MISMATCH',
      [...path, 'criterionId'],
      `Answer does not match criterion ${c.id}`,
    );
  if (a.value === 'NA') {
    if (!c.allowNA)
      invalid('NA_NOT_ALLOWED', [...path, 'value'], `N/A is not allowed for criterion ${c.id}`);
    if (!a.naReason?.trim())
      invalid(
        'MISSING_NA_REASON',
        [...path, 'naReason'],
        `N/A requires a reason for criterion ${c.id}`,
      );
    return;
  }
  if (c.answerType === 'binary' ? typeof a.value !== 'boolean' : typeof a.value !== 'number')
    invalid(
      'INVALID_ANSWER_TYPE',
      [...path, 'value'],
      `Expected a ${c.answerType === 'binary' ? 'boolean' : 'number'} value for criterion ${c.id}`,
    );
  if (typeof a.value === 'number' && !c.levels.includes(a.value))
    invalid(
      'INVALID_LEVEL',
      [...path, 'value'],
      `Expected one of ${c.levels.join(', ')} for criterion ${c.id}`,
    );
}

/** Arithmetic only: caller supplies answers. This function does not evaluate transcript content. */
export function scoreEvaluation(criteriaInput: unknown, answersInput: unknown): ScoreSummary {
  const criteria = z.array(CriterionSchema).min(1).parse(criteriaInput);
  const answers = z.array(CriterionAnswerSchema).parse(answersInput);
  const criterionIds = new Set(criteria.map((c) => c.id));
  if (criterionIds.size !== criteria.length)
    invalid('DUPLICATE_CRITERION', ['criteria'], 'Checklist criterion IDs must be unique');
  const byId = new Map<string, { answer: CriterionAnswer; index: number }>();
  answers.forEach((answer, index) => {
    const path = ['answers', index, 'criterionId'];
    if (byId.has(answer.criterionId))
      invalid('DUPLICATE_ANSWER', path, 'Duplicate answer for a criterion');
    if (!criterionIds.has(answer.criterionId))
      invalid('UNKNOWN_CRITERION', path, 'Answer refers to an unknown criterion');
    byId.set(answer.criterionId, { answer, index });
  });
  for (const criterion of criteria) {
    if (!byId.has(criterion.id))
      invalid('MISSING_ANSWER', ['answers'], `Missing answer for criterion ${criterion.id}`);
  }
  let applicableWeight = 0;
  const flags: ScoreSummary['flags'] = [];
  const raw = criteria.map((c) => {
    const { answer, index } = byId.get(c.id)!;
    validateCriterionAnswer(c, answer, ['answers', index]);
    const value = answer.value;
    if (value === 'NA') {
      return { criterionId: c.id, sectionId: c.sectionId, value, basePoints: 0, weight: 0 };
    }
    if (c.scoringMode === 'flag') {
      flags.push({ criterionId: c.id, triggered: value === true });
      return { criterionId: c.id, sectionId: c.sectionId, value, basePoints: 0, weight: 0 };
    }
    applicableWeight += c.weight;
    const ratio = typeof value === 'boolean' ? Number(value) : value / Math.max(...c.levels);
    return {
      criterionId: c.id,
      sectionId: c.sectionId,
      value,
      basePoints: c.weight * ratio,
      weight: c.weight,
    };
  });
  const normalized = (points: number) =>
    applicableWeight ? round((100 * points) / applicableWeight) : null;
  return {
    total: normalized(raw.reduce((sum, c) => sum + c.basePoints, 0)),
    applicableWeight,
    grossViolation: flags.some((f) => f.criterionId === 'gross' && f.triggered),
    flags,
    contributions: raw.map(({ weight, ...c }) => ({
      ...c,
      basePoints: round(c.basePoints),
      points: normalized(c.basePoints),
      maxPoints: normalized(weight),
    })),
    sections: [...new Set(criteria.map((c) => c.sectionId))].map((sectionId) => {
      const rows = raw.filter((c) => c.sectionId === sectionId);
      if (!rows.some((c) => c.weight > 0)) return { sectionId, points: null, maxPoints: null };
      return {
        sectionId,
        points: normalized(rows.reduce((s, c) => s + c.basePoints, 0)),
        maxPoints: normalized(rows.reduce((s, c) => s + c.weight, 0)),
      };
    }),
  };
}
