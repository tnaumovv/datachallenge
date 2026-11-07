import { describe, expect, it } from 'vitest';
import { validateEvidence } from '../src/evaluations/evidence.js';
import { OutputValidationError } from '../src/evaluations/validation.js';
import { defaultChecklist } from '../src/checklists/default.js';
import type { Conversation, CriterionAnswer } from '../../shared/contracts.js';

const conversation: Conversation = {
  id: 'quality-dialogue',
  sourceConversationId: 'quality-dialogue',
  groupId: 'TEST',
  transcriptHash: 'test-hash',
  language: 'KZ',
  channel: 'agent chat',
  audioUrl: null,
  importedAt: '2026-11-07T00:00:00Z',
  messages: [
    { id: 'c1', speaker: 'client', timestamp: '00:00', text: 'Маған көмектесіңіз.' },
    { id: 'o1', speaker: 'operator', timestamp: '00:01', text: 'Сәлеметсіз бе! Мен Әліммін.' },
    { id: 's1', speaker: 'system', timestamp: '00:02', text: 'Customer identity verified.' },
    {
      id: 'o2',
      speaker: 'operator',
      timestamp: '00:03',
      text: 'Тексеруге жіберемін. Сау болыңыз!',
    },
  ],
};

function answer(patch: Partial<CriterionAnswer> = {}): CriterionAnswer {
  return {
    criterionId: 'contact',
    value: true,
    explanation: 'Оператор поздоровался и представился.',
    evidenceMessageIds: ['o1'],
    checkedSpanMessageIds: [],
    naReason: null,
    ...patch,
  };
}

function issue(a: CriterionAnswer) {
  try {
    validateEvidence(conversation, [a]);
  } catch (error) {
    if (error instanceof OutputValidationError) return error.issues[0];
    throw error;
  }
  return undefined;
}

describe('model evidence quality', () => {
  it('rejects a positive operator assessment supported only by a client message', () => {
    expect(issue(answer({ evidenceMessageIds: ['c1'] }))).toMatchObject({
      code: 'MISSING_OPERATOR_EVIDENCE',
      path: ['answers', 0, 'evidenceMessageIds'],
    });
  });

  it('accepts a system identity confirmation', () => {
    expect(issue(answer({ criterionId: 'identity', evidenceMessageIds: ['s1'] }))).toBeUndefined();
  });

  it('does not use a generic system turn as proof of an operator greeting', () => {
    expect(issue(answer({ evidenceMessageIds: ['s1'] }))?.code).toBe('MISSING_OPERATOR_EVIDENCE');
  });

  it('requires a checked span for a missing action', () => {
    expect(issue(answer({ value: false }))?.code).toBe('MISSING_CHECKED_SPAN');
  });

  it('requires a checked span for N/A even when another message is cited', () => {
    expect(
      issue(answer({ criterionId: 'needs', value: 'NA', naReason: 'Детали известны.' }))?.code,
    ).toBe('MISSING_CHECKED_SPAN');
  });

  it('requires all operator turns to support absence of gross violations', () => {
    expect(
      issue(answer({ criterionId: 'gross', value: false, checkedSpanMessageIds: ['o1'] }))?.code,
    ).toBe('INCOMPLETE_OPERATOR_SPAN');
    expect(
      issue(
        answer({
          criterionId: 'gross',
          value: false,
          evidenceMessageIds: [],
          checkedSpanMessageIds: ['o1', 'o2'],
        }),
      ),
    ).toBeUndefined();
  });

  it('rejects a reason for non-applicability on an applicable criterion', () => {
    expect(issue(answer({ naReason: 'Не требуется.' }))?.code).toBe('UNEXPECTED_NA_REASON');
  });

  it('rejects an obviously Ukrainian explanation', () => {
    expect(
      issue(
        answer({
          explanation: 'Оператор привітався та представився, встановив контакт із клієнтом.',
        }),
      )?.code,
    ).toBe('EXPLANATION_LANGUAGE');
  });

  it('rejects an English-only explanation', () => {
    expect(
      issue(answer({ explanation: 'The operator greeted the customer and introduced himself.' }))
        ?.code,
    ).toBe('EXPLANATION_LANGUAGE');
  });

  it('allows a Russian explanation quoting exact Kazakh source text', () => {
    expect(
      issue(
        answer({
          explanation: 'Оператор поздоровался и представился: «Сәлеметсіз бе! Мен Әліммін.»',
        }),
      ),
    ).toBeUndefined();
  });

  it('allows source names with Kazakh letters in a Russian explanation', () => {
    expect(
      issue(answer({ explanation: 'Оператор Әлім поздоровался и представился.' })),
    ).toBeUndefined();
  });

  it('does not excuse a foreign explanation by putting invented text in quotes', () => {
    expect(issue(answer({ explanation: '«Оператор привітався та представився.»' }))?.code).toBe(
      'EXPLANATION_LANGUAGE',
    );
  });

  it('keeps custom client-focused criteria usable', () => {
    expect(
      issue(
        answer({
          criterionId: 'client_requested_help',
          evidenceMessageIds: ['c1'],
          explanation: 'Клиент попросил о помощи.',
        }),
      ),
    ).toBeUndefined();
  });

  it('allows replacing an existing contact criterion with a client-focused rule', () => {
    const criteria = defaultChecklist.criteria.map((criterion) =>
      criterion.id === 'contact'
        ? {
            ...criterion,
            title: 'Вопрос клиента',
            instruction:
              'Да, если клиент сформулировал вопрос. Доказательство — сообщение клиента.',
          }
        : criterion,
    );
    expect(() =>
      validateEvidence(
        conversation,
        [answer({ evidenceMessageIds: ['c1'], explanation: 'Клиент попросил о помощи.' })],
        criteria,
      ),
    ).not.toThrow();
  });

  it('retains operator-role checks for the shipped v1 greeting rule', () => {
    const criteria = defaultChecklist.criteria.map((criterion) =>
      criterion.id === 'contact'
        ? {
            ...criterion,
            instruction:
              'Да, если в первом ответе оператор поздоровался на языке клиента И представился.',
          }
        : criterion,
    );
    expect(() =>
      validateEvidence(conversation, [answer({ evidenceMessageIds: ['c1'] })], criteria),
    ).toThrow(/operator evidence/i);
  });

  it('does not impose an operator-wide span on a replaced gross criterion', () => {
    const criteria = defaultChecklist.criteria.map((criterion) =>
      criterion.id === 'gross'
        ? {
            ...criterion,
            title: 'Непонятный запрос клиента',
            instruction: 'Да, если сообщение клиента не содержит понятного запроса.',
          }
        : criterion,
    );
    expect(() =>
      validateEvidence(
        conversation,
        [
          answer({
            criterionId: 'gross',
            value: false,
            evidenceMessageIds: ['c1'],
            checkedSpanMessageIds: ['c1'],
            explanation: 'Клиент понятно попросил помочь.',
          }),
        ],
        criteria,
      ),
    ).not.toThrow();
  });

  it('permits an absence assessment when the conversation has no operator turns', () => {
    const clientOnly = { ...conversation, messages: [conversation.messages[0]] };
    expect(() =>
      validateEvidence(clientOnly, [
        answer({
          criterionId: 'gross',
          value: false,
          evidenceMessageIds: [],
          checkedSpanMessageIds: ['c1'],
          explanation: 'Оператор не участвовал в диалоге.',
        }),
      ]),
    ).not.toThrow();
  });
});
