import {
  DecisionInputSchema,
  type Criterion,
  type CriterionAnswer,
  type DecisionInput,
  type Evaluation,
  type ScoreRequest,
} from '../../shared/contracts.js';

export function buildDecision(
  criterion: Criterion,
  decision: DecisionInput['decision'],
  replacement: CriterionAnswer['value'] | undefined,
  reason: string,
): DecisionInput | null {
  if (decision === 'change') {
    const valid =
      replacement === 'NA'
        ? criterion.allowNA
        : criterion.answerType === 'binary'
          ? typeof replacement === 'boolean'
          : typeof replacement === 'number' && criterion.levels.includes(replacement);
    if (!valid) return null;
  }
  const parsed = DecisionInputSchema.safeParse(
    decision === 'confirm'
      ? { decision, reason: reason.trim() }
      : { decision, replacementValue: replacement, reason: reason.trim() },
  );
  return parsed.success ? parsed.data : null;
}

export function buildPreviewRequest(
  evaluation: Pick<Evaluation, 'checklistVersionId' | 'effectiveAnswers'>,
  criterionId: string,
  decision: DecisionInput,
): ScoreRequest {
  return {
    checklistVersionId: evaluation.checklistVersionId,
    answers: evaluation.effectiveAnswers.map((answer) =>
      decision.decision === 'change' && answer.criterionId === criterionId
        ? {
            ...answer,
            value: decision.replacementValue,
            explanation: decision.reason,
            naReason: decision.replacementValue === 'NA' ? decision.reason : null,
            evidenceMessageIds: [],
            checkedSpanMessageIds: [],
          }
        : answer,
    ),
  };
}
