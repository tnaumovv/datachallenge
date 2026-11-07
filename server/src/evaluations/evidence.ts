import type {
  Conversation,
  CriterionAnswer,
  CriterionEvidence,
} from '../../../shared/contracts.js';

export function validateEvidence(
  conversation: Conversation,
  answers: CriterionAnswer[],
): CriterionEvidence[] {
  const messages = new Map(conversation.messages.map((m) => [m.id, m]));
  return answers.map((answer) => {
    if (!answer.explanation.trim()) throw new Error('Every answer requires an explanation');
    if (answer.evidenceMessageIds.length + answer.checkedSpanMessageIds.length === 0)
      throw new Error('Every answer requires evidence or a checked span');
    const extract = (ids: string[]) => {
      if (new Set(ids).size !== ids.length) throw new Error('Duplicate evidence IDs');
      return ids.map((id) => {
        const message = messages.get(id);
        if (!message) throw new Error('Evidence refers to an unknown message');
        return { ...message };
      });
    };
    return {
      criterionId: answer.criterionId,
      evidence: extract(answer.evidenceMessageIds),
      checkedSpan: extract(answer.checkedSpanMessageIds),
    };
  });
}
