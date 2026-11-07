import type {
  Conversation,
  CriterionAnswer,
  CriterionEvidence,
} from '../../../shared/contracts.js';
import { OutputValidationError } from './validation.js';

export function validateEvidence(
  conversation: Conversation,
  answers: CriterionAnswer[],
): CriterionEvidence[] {
  const messages = new Map(conversation.messages.map((m) => [m.id, m]));
  return answers.map((answer, answerIndex) => {
    const path = ['answers', answerIndex];
    if (!answer.explanation.trim())
      throw new OutputValidationError(
        'MISSING_EXPLANATION',
        [...path, 'explanation'],
        'Every answer requires an explanation',
      );
    if (answer.evidenceMessageIds.length + answer.checkedSpanMessageIds.length === 0)
      throw new OutputValidationError(
        'MISSING_EVIDENCE',
        path,
        'Every answer requires evidence or a checked span',
      );
    const extract = (ids: string[], field: string) => {
      const seen = new Set<string>();
      return ids.map((id, index) => {
        const fieldPath = [...path, field, index];
        if (seen.has(id))
          throw new OutputValidationError('DUPLICATE_MESSAGE', fieldPath, 'Duplicate evidence IDs');
        seen.add(id);
        const message = messages.get(id);
        if (!message)
          throw new OutputValidationError(
            'UNKNOWN_MESSAGE',
            fieldPath,
            'Evidence refers to an unknown message',
          );
        return { ...message };
      });
    };
    return {
      criterionId: answer.criterionId,
      evidence: extract(answer.evidenceMessageIds, 'evidenceMessageIds'),
      checkedSpan: extract(answer.checkedSpanMessageIds, 'checkedSpanMessageIds'),
    };
  });
}
