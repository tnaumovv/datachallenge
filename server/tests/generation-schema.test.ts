import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ChecklistVersion, Conversation } from '../../shared/contracts.js';
import { defaultChecklist } from '../src/checklists/default.js';
import { buildModelJsonSchema } from '../src/evaluations/generation-schema.js';

const conversation: Conversation = {
  id: 'c',
  sourceConversationId: 'source',
  groupId: 'DEV',
  language: 'KZ',
  channel: 'agent chat',
  transcriptHash: 'hash',
  audioUrl: null,
  importedAt: 'now',
  messages: [
    { id: 'm0001', speaker: 'client', timestamp: '00:01', text: 'Сәлем!' },
    { id: 'm0002', speaker: 'operator', timestamp: '00:02', text: 'Сәлеметсіз бе!' },
  ],
};
const checklist: ChecklistVersion = {
  ...defaultChecklist,
  id: 'v',
  checklistId: 'custom',
  version: 1,
  createdAt: 'now',
  criteria: [
    { ...defaultChecklist.criteria[0], id: 'custom-contact' },
    { ...defaultChecklist.criteria[3], id: 'contact', levels: [0, 3, 6], allowNA: true },
  ],
};
const answer = (criterionId: string, value: boolean | number | string) => ({
  criterionId,
  value,
  explanation: 'Подтверждается репликой.',
  evidenceMessageIds: ['m0002'],
  checkedSpanMessageIds: [],
  naReason: null,
});
const validate = (answers: unknown[]) =>
  z.fromJSONSchema(buildModelJsonSchema(conversation, checklist)).safeParse({ answers });

describe('generation constraints from the actual checklist and transcript', () => {
  it.each([100, 1500])(
    'keeps a %i-message transcript within the 1000 enum-value API limit',
    (count) => {
      const long = {
        ...conversation,
        messages: Array.from({ length: count }, (_, i) => ({
          id: 'm' + String(i + 1).padStart(4, '0'),
          speaker: i % 2 ? ('operator' as const) : ('client' as const),
          timestamp: '00:01',
          text: 'Реплика',
        })),
      };
      const schema = buildModelJsonSchema(long, {
        ...checklist,
        criteria: defaultChecklist.criteria,
      });
      const countEnums = (value: unknown): number => {
        if (!value || typeof value !== 'object') return 0;
        if (Array.isArray(value)) return value.reduce((sum, item) => sum + countEnums(item), 0);
        return Object.entries(value).reduce(
          (sum, [key, item]) =>
            sum + (key === 'enum' && Array.isArray(item) ? item.length : countEnums(item)),
          0,
        );
      };
      expect(countEnums(schema)).toBeLessThanOrEqual(1000);
      const answers = defaultChecklist.criteria.map((c, i) =>
        answer(c.id, [true, true, true, 20, true, 10, true, false][i]),
      );
      const validator = z.fromJSONSchema(schema);
      expect(validator.safeParse({ answers }).success).toBe(true);
      answers[0].evidenceMessageIds = ['m9999'];
      expect(validator.safeParse({ answers }).success).toBe(false);
    },
  );

  it('prevents client-only evidence for a recognized operator criterion while retaining context spans', () => {
    const standard = { ...checklist, criteria: [defaultChecklist.criteria[0]] };
    const schema = z.fromJSONSchema(buildModelJsonSchema(conversation, standard));
    expect(
      schema.safeParse({ answers: [{ ...answer('contact', true), evidenceMessageIds: ['m0001'] }] })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        answers: [
          {
            ...answer('contact', false),
            evidenceMessageIds: [],
            checkedSpanMessageIds: ['m0001', 'm0002'],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('preserves client evidence for a custom criterion and system evidence for identification', () => {
    const custom = {
      ...checklist,
      criteria: [{ ...defaultChecklist.criteria[0], instruction: 'Оцени приветствие клиента.' }],
    };
    expect(
      z.fromJSONSchema(buildModelJsonSchema(conversation, custom)).safeParse({
        answers: [{ ...answer('contact', true), evidenceMessageIds: ['m0001'] }],
      }).success,
    ).toBe(true);
    const withSystem = {
      ...conversation,
      messages: [
        ...conversation.messages,
        {
          id: 'm0003',
          speaker: 'system' as const,
          timestamp: '00:03',
          text: 'Личность подтверждена.',
        },
      ],
    };
    const identity = { ...checklist, criteria: [defaultChecklist.criteria[2]] };
    expect(
      z.fromJSONSchema(buildModelJsonSchema(withSystem, identity)).safeParse({
        answers: [{ ...answer('identity', true), evidenceMessageIds: ['m0003'] }],
      }).success,
    ).toBe(true);
  });

  it('accepts a custom scale even when its ID is a built-in binary criterion ID', () => {
    expect(validate([answer('custom-contact', true), answer('contact', 3)]).success).toBe(true);
  });

  it.each([true, 5, 20, 'unknown'])(
    'rejects an invalid scale decision %s before generation',
    (value) => {
      expect(validate([answer('custom-contact', true), answer('contact', value)]).success).toBe(
        false,
      );
    },
  );

  it('allows NA only on criteria that actually permit it', () => {
    expect(validate([answer('custom-contact', true), answer('contact', 'NA')]).success).toBe(true);
    expect(validate([answer('custom-contact', 'NA'), answer('contact', 3)]).success).toBe(false);
  });

  it('constrains both evidence and checked-span IDs to the actual messages', () => {
    for (const field of ['evidenceMessageIds', 'checkedSpanMessageIds']) {
      expect(
        validate([
          { ...answer('custom-contact', true), [field]: ['invented-id'] },
          answer('contact', 3),
        ]).success,
      ).toBe(false);
    }
  });

  it('rejects nonexistent criteria and missing or extra answers', () => {
    expect(validate([answer('not-in-checklist', true), answer('contact', 3)]).success).toBe(false);
    expect(validate([answer('custom-contact', true)]).success).toBe(false);
    expect(
      validate([answer('custom-contact', true), answer('contact', 3), answer('contact', 6)])
        .success,
    ).toBe(false);
  });
});
