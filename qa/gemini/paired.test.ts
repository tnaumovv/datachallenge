import { expect, it } from 'vitest';
import { defaultChecklist } from '../../server/src/checklists/default.js';
import { fingerprint } from './benchmark.js';
import { assertPairedInputs, predictionFollowsFreeze, summarizePaired } from './paired.js';
import type {
  ChecklistVersion,
  Conversation,
  EvaluationConfiguration,
} from '../../shared/contracts.js';
const checklist: ChecklistVersion = {
  ...defaultChecklist,
  id: 'v',
  checklistId: 'default',
  version: 2,
  createdAt: '2026-11-08T00:00:00Z',
};
const conversation: Conversation = {
  id: 'c',
  sourceConversationId: 'new',
  groupId: 'TEST',
  transcriptHash: 'x',
  channel: 'agent chat',
  language: 'RU',
  audioUrl: null,
  importedAt: 'now',
  messages: [{ id: 'm1', speaker: 'client', timestamp: '00:00', text: 'Вопрос?' }],
};
const config = (promptVersion: string): EvaluationConfiguration => ({
  configured: true,
  providerId: 'gemini',
  modelId: 'same',
  configurationId: promptVersion,
  promptVersion,
});
const variants = [
  { name: 'baseline' as const, configuration: config('v4'), protocolHash: 'old' },
  { name: 'candidate' as const, configuration: config('v7'), protocolHash: 'new' },
];
const reference = {
  schemaVersion: 1 as const,
  frozenAt: '2026-11-08T00:00:00Z',
  labelSource: 'assistant synthetic expectations, not organizer ground truth',
  humanReviewed: false,
  repeats: 2,
  maxCalls: 20,
  checklist,
  conversations: [conversation],
  variants,
  cases: [
    {
      sourceId: 'new',
      language: 'RU' as const,
      role: 'test',
      notes: 'frozen',
      split: 'holdout' as const,
      transcriptHash: fingerprint({
        language: conversation.language,
        channel: conversation.channel,
        messages: conversation.messages,
      }),
      expectedValues: { contact: true },
    },
  ],
};
it('keeps failed and unrun predictions in every scheduled repeat denominator', () => {
  const report = summarizePaired(reference, [
    {
      variant: 'baseline',
      repeat: 0,
      sourceId: 'new',
      status: 'failed',
      technicalErrors: [],
      values: {},
      total: null,
    },
    {
      variant: 'candidate',
      repeat: 0,
      sourceId: 'new',
      status: 'completed',
      technicalErrors: [],
      values: { contact: true },
      total: null,
    },
  ]);
  expect(report.variants.baseline.aggregate.scheduledCriteria).toBe(2);
  expect(report.variants.baseline.aggregate.matchedOverScheduledPercent).toBe(0);
  expect(report.variants.candidate.aggregate.matchedOverScheduledPercent).toBe(50);
  expect(report.variants.candidate.aggregate.notRunDialogs).toBe(1);
  expect(report.promotion.eligible).toBe(false);
});
it('rejects changed inputs, configurations and protocol contents after freeze', () => {
  expect(() => assertPairedInputs(reference, [conversation], checklist, variants)).not.toThrow();
  expect(() =>
    assertPairedInputs(
      reference,
      [{ ...conversation, messages: [{ ...conversation.messages[0], text: 'Другой вопрос' }] }],
      checklist,
      variants,
    ),
  ).toThrow(/Transcript changed/);
  expect(() =>
    assertPairedInputs(reference, [conversation], { ...checklist, title: 'changed' }, variants),
  ).toThrow(/Checklist changed/);
  expect(() =>
    assertPairedInputs(reference, [conversation], checklist, [
      variants[0],
      { ...variants[1], configuration: config('changed') },
    ]),
  ).toThrow(/configuration/i);
  expect(() =>
    assertPairedInputs(reference, [conversation], checklist, [
      variants[0],
      { ...variants[1], protocolHash: 'changed' },
    ]),
  ).toThrow(/protocol/i);
});
it('rejects duplicate predictions and out-of-plan repeat numbers', () => {
  const row = {
    variant: 'candidate' as const,
    repeat: 0,
    sourceId: 'new',
    status: 'completed' as const,
    technicalErrors: [],
    values: { contact: true },
    total: null,
  };
  expect(() => summarizePaired(reference, [row, row])).toThrow(/Duplicate/);
  expect(() => summarizePaired(reference, [{ ...row, repeat: 2 }])).toThrow(/repeat/i);
});
it('rejects predictions that started before the frozen references', () => {
  expect(
    predictionFollowsFreeze(reference, { startedAt: '2026-11-07T23:59:59Z', attempts: [] }),
  ).toBe(false);
  expect(
    predictionFollowsFreeze(reference, { startedAt: '2026-11-08T00:00:01Z', attempts: [] }),
  ).toBe(true);
  expect(() =>
    assertPairedInputs({ ...reference, frozenAt: 'invalid' }, [conversation], checklist, variants),
  ).toThrow(/freeze/i);
});

it('allows improved completion when a baseline prediction failed, without hiding that failure', () => {
  const row = { sourceId: 'new', technicalErrors: [], total: null };
  const report = summarizePaired(reference, [
    { ...row, variant: 'baseline', repeat: 0, status: 'failed', values: {} },
    { ...row, variant: 'baseline', repeat: 1, status: 'completed', values: { contact: false } },
    { ...row, variant: 'candidate', repeat: 0, status: 'completed', values: { contact: true } },
    { ...row, variant: 'candidate', repeat: 1, status: 'completed', values: { contact: true } },
  ]);
  expect(report.variants.baseline.aggregate.failedDialogs).toBe(1);
  expect(report.promotion.eligible).toBe(true);
});

it('requires a strict increase in full-dialog matches, even when answer matches improve', () => {
  const ref = {
    ...reference,
    repeats: 1,
    cases: [
      {
        ...reference.cases[0],
        expectedValues: { contact: true, needs: 'NA' as const, closing: true },
      },
    ],
  };
  const row = {
    sourceId: 'new',
    repeat: 0,
    status: 'completed' as const,
    technicalErrors: [],
    total: null,
  };
  const report = summarizePaired(ref, [
    { ...row, variant: 'baseline', values: { contact: false, needs: false, closing: true } },
    { ...row, variant: 'candidate', values: { contact: true, needs: 'NA', closing: false } },
  ]);
  expect(report.variants.candidate.aggregate.matchedCriteria).toBeGreaterThan(
    report.variants.baseline.aggregate.matchedCriteria,
  );
  expect(report.variants.candidate.aggregate.matchingDialogs).toBe(0);
  expect(report.promotion.eligible).toBe(false);
});
