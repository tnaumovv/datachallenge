import { z } from 'zod';
import {
  CriterionSchema,
  CriterionAnswerSchema,
  type CriterionConfig,
  type CriterionAnswer,
  type ScoreSummary,
} from '../../../shared/contracts.js';
import { HttpError } from '../errors.js';
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const invalid = (message: string): never => {
  throw new HttpError(400, 'INVALID_ANSWERS', message);
};

export function validateCriterionAnswer(criterion: CriterionConfig, answer: CriterionAnswer): void {
  const c = CriterionSchema.parse(criterion);
  const a = CriterionAnswerSchema.parse(answer);
  if (a.criterionId !== c.id) invalid(`Answer does not match criterion ${c.id}`);
  if (a.value === 'NA') {
    if (!c.allowNA || !a.naReason?.trim()) invalid(`N/A is not allowed or lacks a reason: ${c.id}`);
    return;
  }
  if (
    c.answerType === 'binary'
      ? typeof a.value !== 'boolean'
      : typeof a.value !== 'number' || !c.levels.includes(a.value)
  )
    invalid(`Invalid value for ${c.id}`);
}

/** Arithmetic only: caller supplies answers. This function does not evaluate transcript content. */
export function scoreEvaluation(criteriaInput: unknown, answersInput: unknown): ScoreSummary {
  const criteria = z.array(CriterionSchema).min(1).parse(criteriaInput);
  const answers = z.array(CriterionAnswerSchema).parse(answersInput);
  const byId = new Map(answers.map((a) => [a.criterionId, a]));
  if (
    new Set(criteria.map((c) => c.id)).size !== criteria.length ||
    byId.size !== answers.length ||
    answers.length !== criteria.length ||
    criteria.some((c) => !byId.has(c.id))
  )
    invalid('Provide exactly one answer per criterion');
  let applicableWeight = 0;
  const flags: ScoreSummary['flags'] = [];
  const raw = criteria.map((c) => {
    const answer = byId.get(c.id)!;
    validateCriterionAnswer(c, answer);
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
