import type { CriterionAnswer, ImportRequest } from './contracts.js';

/** Entirely fictional input for frontend development. Never represents an AI result. */
export const demoImport: ImportRequest = {
  source: 'json',
  groupId: 'DEMO',
  records: [
    {
      conversation_id: 'demo-ru-001',
      channel: 'agent chat',
      language: 'RU',
      audio_url: null,
      transcript: [
        {
          timestamp: '00:00',
          speaker: 'client',
          text: 'Здравствуйте! Где посмотреть историю моих операций?',
        },
        {
          timestamp: '00:04',
          speaker: 'operator',
          text: 'Здравствуйте! Меня зовут Анна. Историю можно открыть в разделе «Операции».',
        },
        { timestamp: '00:12', speaker: 'client', text: 'Спасибо, нашёл.' },
        {
          timestamp: '00:15',
          speaker: 'operator',
          text: 'Могу ли я ещё чем-нибудь помочь? До свидания!',
        },
      ],
    },
  ],
};

/** Manual arithmetic fixture: 85.38, not a quality label for demoImport. */
const scoreExampleValues: [string, CriterionAnswer['value'], string | null][] = [
  ['contact', true, null],
  ['needs', 'NA', 'Данных достаточно с самого начала.'],
  ['identity', 'NA', 'Запрос не требует идентификации.'],
  ['consultation', 15, null],
  ['empathy', true, null],
  ['dialogue', 7, null],
  ['closing', true, null],
  ['gross', false, null],
];
export const scoreExampleAnswers: CriterionAnswer[] = scoreExampleValues.map(
  ([criterionId, value, naReason]) => ({
    criterionId,
    value,
    naReason,
    explanation: 'Учебный пример расчёта, не AI-оценка.',
    evidenceMessageIds: [],
    checkedSpanMessageIds: [],
  }),
);
