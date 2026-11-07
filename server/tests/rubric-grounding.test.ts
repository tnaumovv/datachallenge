import { describe, expect, it } from 'vitest';
import type { ChecklistVersion, Conversation } from '../../shared/contracts.js';
import { defaultChecklist } from '../src/checklists/default.js';
import { parseRubricOutput } from '../src/evaluations/rubric.js';

const conversation: Conversation = {
  id: 'grounding',
  sourceConversationId: 'synthetic-grounding',
  groupId: 'TEST',
  transcriptHash: 'grounding',
  language: 'RU',
  channel: 'agent chat',
  audioUrl: null,
  importedAt: 'now',
  messages: [
    { id: 'c1', speaker: 'client', timestamp: '00:00', text: 'Не удаётся сохранить документ.' },
    { id: 'b1', speaker: 'bot', timestamp: '00:01', text: 'Какой браузер вы используете?' },
    { id: 'o1', speaker: 'operator', timestamp: '00:02', text: 'Подскажите название браузера.' },
    { id: 'c2', speaker: 'client', timestamp: '00:03', text: 'Safari.' },
    { id: 'o2', speaker: 'operator', timestamp: '00:04', text: 'Отключите блокировку загрузок.' },
    { id: 'c3', speaker: 'client', timestamp: '00:05', text: 'Получилось.' },
    {
      id: 'o3',
      speaker: 'operator',
      timestamp: '00:06',
      text: 'Документ сохранён. Нужна ещё помощь? Всего доброго!',
    },
  ],
};
const quote = (messageId: string, text: string) => ({ messageId, quote: text });
function parse(id: string, facts: unknown, evidence = ['o1', 'o2', 'o3']) {
  const checklist: ChecklistVersion = {
    ...defaultChecklist,
    id: 'v',
    checklistId: 'default',
    version: 1,
    createdAt: 'now',
    criteria: defaultChecklist.criteria.filter((c) => c.id === id),
  };
  return parseRubricOutput(
    {
      answers: {
        [id]: {
          facts,
          evidenceMessageIds: evidence,
          checkedSpanMessageIds: conversation.messages.map((m) => m.id),
        },
      },
    },
    conversation,
    checklist,
  )[0];
}
const missing = (clarification: unknown, beforeAction = true) => ({
  missingDetailsAtHandoff: [
    { detail: 'Название браузера', clarification, clarifiedBeforeAction: beforeAction },
  ],
});
const closing = (summaryOrOffer: unknown, farewell: unknown = quote('o3', 'Всего доброго!')) => ({
  interruptedBeforeOpportunity: false,
  summaryOrOffer,
  farewell,
});

describe('verifiable needs and closing observations', () => {
  it('derives N/A from an empty list of genuinely missing details', () => {
    expect(parse('needs', { missingDetailsAtHandoff: [] }).value).toBe('NA');
  });
  it('requires an actual clarification of each missing detail before the action', () => {
    expect(parse('needs', missing(quote('o1', 'Подскажите название браузера.'))).value).toBe(true);
    expect(parse('needs', missing(null)).value).toBe(false);
    expect(parse('needs', missing(quote('o1', 'Подскажите название браузера.'), false)).value).toBe(
      false,
    );
  });
  it.each([
    quote('o1', 'Какая у вас операционная система?'),
    quote('b1', 'Какой браузер вы используете?'),
    quote('c2', 'Safari.'),
    quote('invented', 'Подскажите название браузера.'),
  ])('rejects fabricated or non-operator clarification evidence: %j', (claim) => {
    expect(() => parse('needs', missing(claim))).toThrow();
  });
  it('requires the cited clarification to be present in the public evidence', () => {
    expect(() =>
      parse('needs', missing(quote('o1', 'Подскажите название браузера.')), ['o2']),
    ).toThrow();
  });
  it('does not count a farewell alone as both required closing actions', () => {
    expect(parse('closing', closing(null)).value).toBe(false);
    expect(() =>
      parse('closing', closing({ ...quote('o3', 'Всего доброго!'), kind: 'summary' })),
    ).toThrow();
  });
  it('accepts separately quoted summary or help offer and farewell', () => {
    expect(
      parse('closing', closing({ ...quote('o3', 'Документ сохранён.'), kind: 'summary' })).value,
    ).toBe(true);
    expect(
      parse('closing', closing({ ...quote('o3', 'Нужна ещё помощь?'), kind: 'help_offer' })).value,
    ).toBe(true);
    expect(
      parse('closing', closing({ ...quote('o3', 'Документ сохранён.'), kind: 'summary' }, null))
        .value,
    ).toBe(false);
  });
  it('rejects invented summary text even when its message ID exists', () => {
    expect(() =>
      parse(
        'closing',
        closing({ ...quote('o3', 'Я отправил документ вам на почту.'), kind: 'next_step' }),
      ),
    ).toThrow();
  });
  it('keeps an explicit interruption distinct from missing closing actions', () => {
    expect(
      parse('closing', { interruptedBeforeOpportunity: true, summaryOrOffer: null, farewell: null })
        .value,
    ).toBe('NA');
  });
});
