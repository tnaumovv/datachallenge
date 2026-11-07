import type {
  Conversation,
  CriterionAnswer,
  CriterionEvidence,
  CriterionConfig,
} from '../../../shared/contracts.js';
import { defaultChecklist } from '../checklists/default.js';
import { OutputValidationError } from './validation.js';
import { hasRussianExplanation } from './language.js';

// Recognize shipped rule versions, not just IDs: the editor may replace any criterion.
const legacyInstructions: Record<string, string> = {
  contact: 'Да, если в первом ответе оператор поздоровался на языке клиента И представился.',
  needs: 'Да, если оператор учёл уже известные детали и уточнил недостающие ДО ответа.',
  identity:
    'Да, если личность проверена ДО раскрытия защищённых данных или защищённого действия. Подтверждение системным сообщением учитывается.',
  consultation: 'Оценить полноту и корректность решения по заданной шкале.',
  empathy:
    'Да, если оператор вежлив и конкретно отреагировал на высказанную проблему или недовольство, если они были.',
  dialogue: 'Оценить ясность, последовательность и предупреждение об ожидании по заданной шкале.',
  closing: 'Да, если (подведён итог ИЛИ предложена дополнительная помощь) И оператор попрощался.',
  gross:
    'Да означает нарушение: оскорбление, предложение платной услуги вне компании или разглашение конфиденциальных данных. Самого предложения платной услуги достаточно. Не обнуляет итоговый балл.',
};
const operatorInstructions = new Map(
  defaultChecklist.criteria.map((criterion) => [
    criterion.id,
    new Set([criterion.instruction, legacyInstructions[criterion.id]]),
  ]),
);

export function isStandardOperatorCriterion(criterion: CriterionConfig): boolean {
  return operatorInstructions.get(criterion.id)?.has(criterion.instruction) === true;
}

export function validateEvidence(
  conversation: Conversation,
  answers: CriterionAnswer[],
  criteria: readonly CriterionConfig[] = defaultChecklist.criteria,
): CriterionEvidence[] {
  const byCriterionId = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const messages = new Map(conversation.messages.map((m) => [m.id, m]));
  const operatorIds = conversation.messages
    .filter((m) => m.speaker === 'operator')
    .map((m) => m.id);
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
    const result = {
      criterionId: answer.criterionId,
      evidence: extract(answer.evidenceMessageIds, 'evidenceMessageIds'),
      checkedSpan: extract(answer.checkedSpanMessageIds, 'checkedSpanMessageIds'),
    };
    if (answer.value !== 'NA' && answer.naReason !== null)
      throw new OutputValidationError(
        'UNEXPECTED_NA_REASON',
        [...path, 'naReason'],
        'Applicable answers must have naReason=null',
      );
    if (
      (answer.value === 'NA' || answer.value === false || answer.value === 0) &&
      !result.checkedSpan.length
    )
      throw new OutputValidationError(
        'MISSING_CHECKED_SPAN',
        [...path, 'checkedSpanMessageIds'],
        'N/A, absent actions and zero scores require a checked span',
      );
    const positive =
      answer.value === true || (typeof answer.value === 'number' && answer.value > 0);
    const criterion = byCriterionId.get(answer.criterionId);
    const standardOperatorRule = !!criterion && isStandardOperatorCriterion(criterion);
    if (
      positive &&
      standardOperatorRule &&
      !result.evidence.some(
        (message) =>
          message.speaker === 'operator' ||
          (answer.criterionId === 'identity' && message.speaker === 'system'),
      )
    )
      throw new OutputValidationError(
        'MISSING_OPERATOR_EVIDENCE',
        [...path, 'evidenceMessageIds'],
        'A positive operator assessment requires operator evidence; identity may use a system confirmation',
      );
    if (
      answer.criterionId === 'gross' &&
      standardOperatorRule &&
      answer.value === false &&
      operatorIds.some((id) => !answer.checkedSpanMessageIds.includes(id))
    )
      throw new OutputValidationError(
        'INCOMPLETE_OPERATOR_SPAN',
        [...path, 'checkedSpanMessageIds'],
        'Absence of gross violations requires checking every operator message',
      );
    if (
      !hasRussianExplanation(
        answer.explanation,
        [...result.evidence, ...result.checkedSpan].map((m) => m.text),
      )
    )
      throw new OutputValidationError(
        'EXPLANATION_LANGUAGE',
        [...path, 'explanation'],
        'Write the explanation in Russian; original quotations and source names may retain their language',
      );
    return result;
  });
}
