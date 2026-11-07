import type { ChecklistVersion, Conversation, Evaluation } from '../../../shared/contracts.js';
import type { CoachingResult } from '../../../shared/coaching.js';
import { defaultChecklist } from '../checklists/default.js';
const actions: Record<string, string> = {
  contact:
    'В первом ответе поздоровайтесь на языке клиента и представьтесь. Эти действия должен выполнить сам оператор, даже если клиенту уже ответил бот.',
  needs:
    'До ответа или фактической передачи обращения уточните недостающие детали запроса. Используйте уже полученную от клиента информацию; не задавайте повторных вопросов.',
  identity:
    'До раскрытия защищённых данных или выполнения защищённого действия пройдите предусмотренную проверку личности и убедитесь, что подтверждение зафиксировано.',
  consultation:
    'Сопоставьте каждый вопрос клиента с данным ответом. Для пропущенного вопроса предложите конкретный следующий шаг; условия продукта сверяйте с применимым регламентом.',
  empathy:
    'Отреагируйте на конкретную трудность клиента, затем объясните, чем можете помочь. Избегайте общих фраз без связи с его запросом.',
  dialogue:
    'Разделите ответ на последовательные шаги. Перед паузой предупредите, что проверяете, и после неё сообщите результат или следующий шаг.',
  closing:
    'В конце кратко подведите итог или предложите дополнительную помощь, затем попрощайтесь. Одного пожелания хорошего дня недостаточно.',
  gross:
    'Передайте отмеченную реплику руководителю для проверки. Следуйте официальному каналу обслуживания; исключите оскорбления, предложения частных платных услуг и раскрытие конфиденциальных данных.',
};
const examples: Record<string, Record<Conversation['language'], string>> = {
  contact: {
    RU: 'Здравствуйте! Меня зовут [имя]. Чем могу помочь?',
    KZ: 'Сәлеметсіз бе! Менің атым [аты]. Сізге қалай көмектесе аламын?',
    EN: 'Hello! My name is [name]. How can I help you?',
  },
  closing: {
    RU: 'Могу ли я ещё чем-нибудь помочь? До свидания!',
    KZ: 'Тағы қандай көмегім керек? Сау болыңыз!',
    EN: 'Is there anything else I can help you with? Goodbye!',
  },
};
export function buildCoaching(
  evaluation: Evaluation,
  conversation: Conversation,
  checklist: ChecklistVersion,
): CoachingResult {
  if (evaluation.status !== 'completed') return { items: [], basedOn: 'effective_answers' };
  const items: CoachingResult['items'] = [];
  for (const c of checklist.criteria) {
    const a = evaluation.effectiveAnswers.find((a) => a.criterionId === c.id);
    if (!a || a.value === 'NA') continue;
    const deficient =
      c.scoringMode === 'flag'
        ? a.value === true
        : typeof a.value === 'boolean'
          ? !a.value
          : a.value < Math.max(...c.levels);
    if (!deficient) continue;
    const original = defaultChecklist.criteria.find((d) => d.id === c.id);
    const standard =
      original &&
      [
        'instruction',
        'answerType',
        'scoringMode',
        'naRule',
        'allowNA',
        'levels',
        'levelDescriptions',
      ].every(
        (key) =>
          JSON.stringify(c[key as keyof typeof c]) ===
          JSON.stringify(original[key as keyof typeof c]),
      );
    const ids = new Set([...a.evidenceMessageIds, ...a.checkedSpanMessageIds]);
    const refs = new Set(evaluation.knowledge?.sources.map((s) => s.reference) ?? []);
    items.push({
      criterionId: c.id,
      title: c.title,
      priority: c.scoringMode === 'flag' ? 'high' : 'normal',
      basis: a.explanation,
      action: standard
        ? actions[c.id]
        : `Проверьте отмеченный участок по правилу чек-листа: ${c.instruction}`,
      example: standard ? (examples[c.id]?.[conversation.language] ?? null) : null,
      evidence: conversation.messages.filter((m) => ids.has(m.id)).slice(0, 3),
      knowledgeReferences: [
        ...new Set([...a.explanation.matchAll(/\[(K\d+)\]/g)].map((m) => m[1])),
      ].filter((r) => refs.has(r)),
    });
  }
  return {
    items: items.sort((a, b) => Number(b.priority === 'high') - Number(a.priority === 'high')),
    basedOn: 'effective_answers',
  };
}
