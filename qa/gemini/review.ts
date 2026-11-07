import { isDeepStrictEqual } from 'node:util';
import type {
  ChecklistVersion,
  Conversation,
  CriterionAnswer,
  Evaluation,
} from '../../shared/contracts.js';
import { ModelOutputSchema } from '../../server/src/evaluations/prompt.js';
import { scoreEvaluation } from '../../server/src/evaluations/scoring.js';
import { validateEvidence } from '../../server/src/evaluations/evidence.js';

export type ReferenceCase = {
  sourceId: string;
  language: 'RU' | 'KZ' | 'EN';
  role: string;
  expectedValues: Record<string, CriterionAnswer['value']>;
  expectedTotal?: number;
  requiredEvidence?: Record<string, string[]>;
  notes: string;
};

/** These are manual smoke expectations, not the organizers' hidden Ground Truth. */
export function reviewEvaluation(
  evaluation: Evaluation,
  conversation: Conversation,
  checklist: ChecklistVersion,
  reference: ReferenceCase,
) {
  const technicalErrors: string[] = [];
  const semanticMismatches: Record<string, unknown>[] = [];
  if (evaluation.status !== 'completed') {
    return { technicalErrors, semanticMismatches, reviewStatus: 'not_evaluated' as const };
  }
  try {
    if (
      evaluation.conversationId !== conversation.id ||
      evaluation.checklistVersionId !== checklist.id
    ) {
      throw new Error('Evaluation does not match the selected conversation/checklist');
    }
    if (
      reference.sourceId !== conversation.sourceConversationId ||
      reference.language !== conversation.language
    ) {
      throw new Error('Reference does not match the selected conversation');
    }
    const { answers } = ModelOutputSchema.parse({ answers: evaluation.originalAnswers });
    const score = scoreEvaluation(checklist.criteria, answers);
    const evidence = validateEvidence(conversation, answers, checklist.criteria);
    if (!isDeepStrictEqual(score, evaluation.originalScore))
      technicalErrors.push('Persisted original score differs from recomputation');
    if (!isDeepStrictEqual(evidence, evaluation.evidence))
      technicalErrors.push('Evidence differs from original transcript messages');
    const byId = new Map(answers.map((a) => [a.criterionId, a]));
    for (const answer of answers) {
      if (answer.value !== 'NA' && answer.naReason !== null)
        technicalErrors.push(`${answer.criterionId}: naReason on an applicable criterion`);
      if (answer.value === 'NA' && !answer.checkedSpanMessageIds.length)
        technicalErrors.push(`${answer.criterionId}: N/A without checked span`);
    }
    for (const [criterionId, expected] of Object.entries(reference.expectedValues)) {
      const actual = byId.get(criterionId)?.value;
      if (actual !== expected) semanticMismatches.push({ criterionId, expected, actual });
    }
    for (const [criterionId, expectedIds] of Object.entries(reference.requiredEvidence ?? {})) {
      const answer = byId.get(criterionId);
      const actual = new Set([
        ...(answer?.evidenceMessageIds ?? []),
        ...(answer?.checkedSpanMessageIds ?? []),
      ]);
      const missingEvidence = expectedIds.filter((id) => !actual.has(id));
      if (missingEvidence.length) semanticMismatches.push({ criterionId, missingEvidence });
    }
    if (reference.expectedTotal !== undefined && score.total !== reference.expectedTotal)
      semanticMismatches.push({ expectedTotal: reference.expectedTotal, actualTotal: score.total });
  } catch (error) {
    technicalErrors.push(error instanceof Error ? error.message : 'Review failed');
  }
  return {
    technicalErrors,
    semanticMismatches,
    reviewStatus:
      technicalErrors.length || semanticMismatches.length
        ? ('mismatch' as const)
        : ('passed' as const),
  };
}
