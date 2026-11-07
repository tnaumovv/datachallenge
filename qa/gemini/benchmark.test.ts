import { describe, expect, it } from 'vitest';
import type { ChecklistVersion, Conversation } from '../../shared/contracts.js';
import { defaultChecklist } from '../../server/src/checklists/default.js';
import {
  assertFrozenInputs,
  fingerprint,
  summarizeBenchmark,
  assessQualityTarget,
  type FrozenBenchmark,
  type BenchmarkResult,
} from './benchmark.js';

const conversation: Conversation = {
  id: 'new-conversation',
  sourceConversationId: 'new-source',
  groupId: 'DEV',
  language: 'RU',
  channel: 'agent chat',
  transcriptHash: 'stored',
  audioUrl: null,
  importedAt: 'now',
  messages: [{ id: 'm1', speaker: 'operator', timestamp: '00:00', text: 'Здравствуйте!' }],
};
const checklist: ChecklistVersion = {
  ...defaultChecklist,
  id: 'checklist-v2',
  checklistId: 'default',
  version: 2,
  createdAt: 'now',
};
function reference(): FrozenBenchmark {
  return {
    schemaVersion: 1,
    frozenAt: '2026-11-07T00:00:00Z',
    labelSource: 'assistant_draft',
    humanReviewed: false,
    modelId: 'test-model',
    promptVersion: 'test-prompt',
    checklistVersionId: checklist.id,
    checklistHash: fingerprint({
      title: checklist.title,
      sections: checklist.sections,
      criteria: checklist.criteria,
    }),
    previouslyReviewedSources: ['old-source'],
    cases: [
      {
        sourceId: conversation.sourceConversationId,
        language: 'RU',
        role: 'holdout',
        split: 'holdout',
        transcriptHash: fingerprint({
          language: conversation.language,
          channel: conversation.channel,
          messages: conversation.messages,
        }),
        expectedValues: { contact: true, needs: 'NA', gross: false },
        expectedTotal: 90,
        notes: 'Frozen test fixture.',
      },
    ],
  };
}

function result(patch: Partial<BenchmarkResult> = {}): BenchmarkResult {
  return {
    sourceId: 'new-source',
    status: 'completed',
    technicalErrors: [],
    values: { contact: true, needs: 'NA', gross: false },
    total: 80,
    ...patch,
  };
}

describe('frozen benchmark inputs', () => {
  it('refuses a different live model before any prediction is submitted', () => {
    expect(() =>
      assertFrozenInputs(reference(), [conversation], checklist, {
        configured: true,
        providerId: 'gemini',
        modelId: 'other-model',
        configurationId: 'other-config',
        promptVersion: 'test-prompt',
      }),
    ).toThrow(/provider configuration/i);
  });

  it('refuses an unconfigured live provider', () => {
    expect(() =>
      assertFrozenInputs(reference(), [conversation], checklist, {
        configured: false,
        providerId: null,
        modelId: null,
        configurationId: null,
        promptVersion: 'test-prompt',
      }),
    ).toThrow(/not configured/i);
  });

  it('rejects a changed transcript before any prediction can be submitted', () => {
    const frozen = reference();
    const changed = structuredClone(conversation);
    changed.messages[0].text = 'Changed after reference freeze';
    expect(() => assertFrozenInputs(frozen, [changed], checklist)).toThrow(/transcript changed/i);
  });

  it('rejects a changed checklist, including changed instructions', () => {
    const frozen = reference();
    const changed = structuredClone(checklist);
    changed.criteria[0].instruction = 'Changed after reference freeze';
    expect(() => assertFrozenInputs(frozen, [conversation], changed)).toThrow(/checklist changed/i);
  });

  it('refuses to count an old calibration source as a new holdout', () => {
    const frozen = reference();
    frozen.previouslyReviewedSources.push('new-source');
    expect(() => assertFrozenInputs(frozen, [conversation], checklist)).toThrow(
      /previously reviewed/i,
    );
  });

  it('accepts unchanged sources without depending on portable database IDs', () => {
    expect(() => assertFrozenInputs(reference(), [conversation], checklist)).not.toThrow();
  });
});

describe('benchmark metrics', () => {
  it('shows per-criterion agreement and an exact-dialog confidence interval', () => {
    const summary = summarizeBenchmark(reference().cases, [result()]).holdout;
    expect(summary.byCriterion).toMatchObject({
      contact: { scheduled: 1, compared: 1, matched: 1, agreementPercent: 100 },
      needs: { scheduled: 1, compared: 1, matched: 1, agreementPercent: 100 },
    });
    expect(summary.exactDialogAgreementPercent).toBe(100);
    expect(summary.dialogueConfidenceInterval95?.lowerPercent).toBeCloseTo(20.65, 2);
  });

  it('refuses a 95% claim from a perfect but partial assistant reference', () => {
    const gate = assessQualityTarget(reference(), [result()]);
    expect(gate.claimSupported).toBe(false);
    expect(gate.reasons).toEqual(
      expect.arrayContaining([
        'LABELS_NOT_HUMAN_REVIEWED',
        'INDEPENDENT_DIALOGUES_NOT_CONFIRMED',
        'CHECKLIST_COVERAGE_UNKNOWN',
        'INSUFFICIENT_STATISTICAL_EVIDENCE',
      ]),
    );
  });

  it('never lets regression-only or incomplete runs pass the quality gate', () => {
    const frozen = reference();
    frozen.cases[0].split = 'regression';
    expect(assessQualityTarget(frozen, [result()]).reasons).toContain('NO_HOLDOUT');
    expect(assessQualityTarget(reference(), []).reasons).toContain('INCOMPLETE_HOLDOUT');
  });

  it('requires coverage of every checklist criterion even with expert-reviewed labels', () => {
    const frozen = {
      ...reference(),
      humanReviewed: true,
      independentDialogs: true,
      criterionIds: ['contact', 'needs', 'gross', 'closing'],
    };
    expect(assessQualityTarget(frozen, [result()]).reasons).toContain('PARTIAL_REFERENCE_LABELS');
  });

  it('supports a claim only with sufficient independent fully labelled holdout evidence', () => {
    const frozen = {
      ...reference(),
      humanReviewed: true,
      independentDialogs: true,
      criterionIds: ['contact', 'needs', 'gross'],
      cases: Array.from({ length: 100 }, (_, i) => ({
        ...reference().cases[0],
        sourceId: 'source-' + i,
        language: (['RU', 'KZ', 'EN'] as const)[i % 3],
        expectedValues: { contact: true, needs: 'NA' as const, gross: i === 0 },
      })),
    };
    const results = frozen.cases.map((c) =>
      result({ sourceId: c.sourceId, values: c.expectedValues }),
    );
    expect(assessQualityTarget(frozen, results).claimSupported).toBe(true);
    results[0].values = { ...results[0].values, gross: false };
    const failedGate = assessQualityTarget(frozen, results);
    expect(failedGate.claimSupported).toBe(false);
    expect(failedGate.reasons).toContain('GROSS_VIOLATION_ERRORS');
  });

  it('counts exact criterion decisions, N/A mistakes, gross misses and score error separately', () => {
    const report = summarizeBenchmark(reference().cases, [
      result({ values: { contact: true, needs: false, gross: true } }),
    ]);
    expect(report.holdout).toMatchObject({
      scheduledDialogs: 1,
      completedDialogs: 1,
      comparedCriteria: 3,
      matchedCriteria: 1,
      criterionAgreementPercent: 33.33,
      meanAbsoluteScoreError: 10,
      na: { missed: 1, spurious: 0 },
      gross: { falsePositives: 1, falseNegatives: 0 },
    });
  });

  it('does not hide failed or unrun cases behind a perfect completed-only percentage', () => {
    const base = reference().cases[0];
    const cases = [
      base,
      { ...base, sourceId: 'failed-source' },
      { ...base, sourceId: 'unrun-source' },
    ];
    const report = summarizeBenchmark(cases, [
      result(),
      result({ sourceId: 'failed-source', status: 'failed', values: {}, total: null }),
    ]);
    expect(report.holdout).toMatchObject({
      scheduledDialogs: 3,
      completedDialogs: 1,
      failedDialogs: 1,
      notRunDialogs: 1,
      scheduledCriteria: 9,
      comparedCriteria: 3,
      matchedCriteria: 3,
      criterionAgreementPercent: 100,
      matchedOverScheduledPercent: 33.33,
    });
  });

  it('excludes technically invalid results and separates regression from holdout', () => {
    const base = reference().cases[0];
    const cases = [base, { ...base, sourceId: 'regression-source', split: 'regression' as const }];
    const report = summarizeBenchmark(cases, [
      result({ technicalErrors: ['Evidence invalid'] }),
      result({ sourceId: 'regression-source' }),
    ]);
    expect(report.holdout.completedDialogs).toBe(0);
    expect(report.holdout.invalidDialogs).toBe(1);
    expect(report.holdout.criterionAgreementPercent).toBeNull();
    expect(report.regression).toMatchObject({ completedDialogs: 1, matchedCriteria: 3 });
  });

  it('counts missing criterion answers as mismatches and rejects duplicate result IDs', () => {
    const cases = reference().cases;
    expect(
      summarizeBenchmark(cases, [result({ values: { contact: true } })]).holdout.matchedCriteria,
    ).toBe(1);
    expect(() => summarizeBenchmark(cases, [result(), result()])).toThrow(/duplicate/i);
  });
});
