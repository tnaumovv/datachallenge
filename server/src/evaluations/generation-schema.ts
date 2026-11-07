import type { z } from 'zod';
import type { ChecklistVersion, Conversation } from '../../../shared/contracts.js';
import { isStandardOperatorCriterion } from './evidence.js';

/** Necessary input constraints, never reference labels or guesses from built-in IDs. */
export function buildModelJsonSchema(
  conversation: Conversation,
  checklist: ChecklistVersion,
): z.core.JSONSchema.JSONSchema {
  const groups = {
    message: conversation.messages.map((m) => m.id),
    operator: conversation.messages.filter((m) => m.speaker === 'operator').map((m) => m.id),
    identity: conversation.messages
      .filter((m) => m.speaker === 'operator' || m.speaker === 'system')
      .map((m) => m.id),
  };
  // Share transcript constraints rather than repeating every enum in each criterion.
  // Very long transcripts use an exact literal pattern to stay below the 1000-enum API limit.
  const enumCount =
    Object.values(groups).reduce((sum, ids) => sum + ids.length, 0) +
    checklist.criteria.reduce((sum, c) => sum + 1 + c.levels.length + Number(c.allowNA), 0);
  const definitions: Record<string, z.core.JSONSchema.JSONSchema> = Object.fromEntries(
    Object.entries(groups)
      .filter(([, ids]) => ids.length)
      .map(([name, ids]) => [
        name,
        enumCount <= 900
          ? { type: 'string', enum: ids }
          : {
              type: 'string',
              pattern:
                '^(?:' +
                ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') +
                ')$',
            },
      ]),
  );
  const ref = (name: keyof typeof groups) => ({ $ref: '#/$defs/' + name });
  return {
    $defs: definitions,
    type: 'object',
    additionalProperties: false,
    required: ['answers'],
    properties: {
      answers: {
        type: 'array',
        minItems: checklist.criteria.length,
        maxItems: checklist.criteria.length,
        items: {
          anyOf: checklist.criteria.map((criterion) => {
            const group = !isStandardOperatorCriterion(criterion)
              ? 'message'
              : criterion.id === 'identity'
                ? 'identity'
                : 'operator';
            return {
              type: 'object',
              additionalProperties: false,
              required: [
                'criterionId',
                'value',
                'explanation',
                'evidenceMessageIds',
                'checkedSpanMessageIds',
                'naReason',
              ],
              properties: {
                criterionId: { type: 'string', enum: [criterion.id] },
                value: {
                  anyOf: [
                    criterion.answerType === 'binary'
                      ? { type: 'boolean' }
                      : { type: 'number', enum: criterion.levels },
                    ...(criterion.allowNA ? [{ type: 'string' as const, enum: ['NA'] }] : []),
                  ],
                },
                explanation: { type: 'string', minLength: 1 },
                evidenceMessageIds: groups[group].length
                  ? { type: 'array', items: ref(group) }
                  : { type: 'array', items: ref('message'), maxItems: 0 },
                checkedSpanMessageIds: { type: 'array', items: ref('message') },
                naReason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              },
            };
          }),
        },
      },
    },
  };
}
