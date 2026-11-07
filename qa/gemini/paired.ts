import type {
  ChecklistVersion,
  Conversation,
  EvaluationConfiguration,
} from '../../shared/contracts.js';
import {
  assertFrozenInputs,
  fingerprint,
  predictionFollowsFreeze,
  summarizeBenchmark,
  type BenchmarkResult,
  type FrozenCase,
} from './benchmark.js';
export type VariantName = 'baseline' | 'candidate';
export type PairedVariant = {
  name: VariantName;
  configuration: EvaluationConfiguration;
  protocolHash: string;
};
export type PairedReference = {
  schemaVersion: 1;
  frozenAt: string;
  labelSource: string;
  humanReviewed: boolean;
  repeats: number;
  maxCalls: number;
  checklist: ChecklistVersion;
  conversations: Conversation[];
  variants: PairedVariant[];
  cases: FrozenCase[];
};
export type PairedResult = BenchmarkResult & { variant: VariantName; repeat: number };
export function assertPairedInputs(
  reference: PairedReference,
  conversations: Conversation[],
  checklist: ChecklistVersion,
  variants: PairedVariant[],
) {
  if (!Number.isFinite(Date.parse(reference.frozenAt))) throw new Error('Invalid freeze timestamp');
  if (!Number.isInteger(reference.repeats) || reference.repeats < 1 || reference.repeats > 5)
    throw new Error('Invalid repeat count');
  if (
    reference.variants.length !== 2 ||
    new Set(reference.variants.map((v) => v.name)).size !== 2 ||
    !reference.variants.every((v) => ['baseline', 'candidate'].includes(v.name))
  )
    throw new Error('Both paired variants are required');
  for (const frozen of reference.variants) {
    const actual = variants.find((v) => v.name === frozen.name);
    if (!actual || actual.protocolHash !== frozen.protocolHash)
      throw new Error('Live protocol differs from freeze');
    const config = frozen.configuration;
    assertFrozenInputs(
      {
        schemaVersion: 1,
        frozenAt: reference.frozenAt,
        labelSource: reference.labelSource,
        humanReviewed: reference.humanReviewed,
        modelId: config.modelId!,
        promptVersion: config.promptVersion,
        configurationId: config.configurationId ?? undefined,
        checklistVersionId: reference.checklist.id,
        checklistHash: fingerprint({
          title: reference.checklist.title,
          sections: reference.checklist.sections,
          criteria: reference.checklist.criteria,
        }),
        previouslyReviewedSources: [],
        criterionIds: reference.checklist.criteria.map((c) => c.id),
        cases: reference.cases,
      },
      conversations,
      checklist,
      actual.configuration,
    );
  }
  if (reference.variants[0].configuration.modelId !== reference.variants[1].configuration.modelId)
    throw new Error('Paired model IDs differ');
}
export { predictionFollowsFreeze };
export function summarizePaired(reference: PairedReference, results: PairedResult[]) {
  for (const row of results)
    if (
      !reference.variants.some((v) => v.name === row.variant) ||
      !Number.isInteger(row.repeat) ||
      row.repeat < 0 ||
      row.repeat >= reference.repeats
    )
      throw new Error('Unknown variant or repeat');
  const variants = Object.fromEntries(
    reference.variants.map((v) => {
      const repeats = Array.from({ length: reference.repeats }, (_, repeat) =>
        summarizeBenchmark(
          reference.cases,
          results.filter((r) => r.variant === v.name && r.repeat === repeat),
        ),
      );
      const cases = Array.from({ length: reference.repeats }, (_, repeat) =>
        reference.cases.map((c) => ({ ...c, sourceId: c.sourceId + '#' + repeat })),
      ).flat();
      const rows = results
        .filter((r) => r.variant === v.name)
        .map((r) => ({ ...r, sourceId: r.sourceId + '#' + r.repeat }));
      const summary = summarizeBenchmark(cases, rows);
      // Repeated observations are correlated: never present this interval as 24 independent dialogues.
      const { dialogueConfidenceInterval95: _interval, ...aggregate } = summary.holdout;
      return [v.name, { repeats, aggregate, byLanguage: summary.holdoutByLanguage }];
    }),
  ) as Record<
    VariantName,
    {
      repeats: ReturnType<typeof summarizeBenchmark>[];
      aggregate: Omit<
        ReturnType<typeof summarizeBenchmark>['holdout'],
        'dialogueConfidenceInterval95'
      >;
      byLanguage: ReturnType<typeof summarizeBenchmark>['holdoutByLanguage'];
    }
  >;
  const b = variants.baseline.aggregate,
    c = variants.candidate.aggregate;
  const reasons: string[] = [];
  if (c.completedDialogs !== c.scheduledDialogs) reasons.push('CANDIDATE_INCOMPLETE');
  if (c.completedDialogs < b.completedDialogs) reasons.push('COMPLETION_REGRESSION');
  if (!b.completedDialogs) reasons.push('NO_COMPLETED_BASELINE');
  if (c.matchedCriteria <= b.matchedCriteria) reasons.push('NO_ANSWER_IMPROVEMENT');
  if (c.matchingDialogs <= b.matchingDialogs) reasons.push('NO_EXACT_DIALOG_IMPROVEMENT');
  if (
    c.gross.falseNegatives > b.gross.falseNegatives ||
    c.gross.falsePositives > b.gross.falsePositives
  )
    reasons.push('GROSS_REGRESSION');
  if (
    variants.candidate.repeats.some(
      (r, i) => r.holdout.matchedCriteria < variants.baseline.repeats[i].holdout.matchedCriteria,
    )
  )
    reasons.push('REPEAT_REGRESSION');
  return {
    variants,
    promotion: { eligible: reasons.length === 0, reasons },
    limitations: [
      'ASSISTANT_LABELS_NOT_ORGANIZER_GROUND_TRUTH',
      'REPEATS_ARE_CORRELATED',
      'SMALL_SYNTHETIC_SAMPLE',
    ],
  };
}
