import { createHash } from 'node:crypto';
import type {
  ChecklistVersion,
  Conversation,
  CriterionAnswer,
  EvaluationConfiguration,
} from '../../shared/contracts.js';
import type { ReferenceCase } from './review.js';

export type FrozenCase = ReferenceCase & {
  split: 'holdout' | 'regression';
  transcriptHash: string;
};
export type FrozenBenchmark = {
  schemaVersion: 1;
  frozenAt: string;
  labelSource: string;
  humanReviewed: boolean;
  independentDialogs?: boolean;
  criterionIds?: string[];
  modelId: string;
  promptVersion: string;
  configurationId?: string;
  checklistVersionId: string;
  checklistHash: string;
  previouslyReviewedSources: string[];
  cases: FrozenCase[];
};
export type BenchmarkResult = {
  sourceId: string;
  status: 'completed' | 'failed';
  technicalErrors: string[];
  values: Record<string, CriterionAnswer['value']>;
  total: number | null;
};

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function assertFrozenInputs(
  reference: FrozenBenchmark,
  conversations: Conversation[],
  checklist: ChecklistVersion,
  configuration?: EvaluationConfiguration,
) {
  if (configuration) {
    if (!configuration.configured) throw new Error('AI provider is not configured');
    if (!reference.configurationId?.trim())
      throw new Error('Frozen configuration ID is required for a live comparison');
    if (
      configuration.modelId !== reference.modelId ||
      configuration.promptVersion !== reference.promptVersion ||
      configuration.configurationId !== reference.configurationId
    )
      throw new Error('Live provider configuration differs from the frozen reference');
  }
  const checklistHash = fingerprint({
    title: checklist.title,
    sections: checklist.sections,
    criteria: checklist.criteria,
  });
  if (checklistHash !== reference.checklistHash) throw new Error('Checklist changed after freeze');
  const actualIds = checklist.criteria.map((c) => c.id);
  if (
    reference.criterionIds &&
    (new Set(reference.criterionIds).size !== actualIds.length ||
      reference.criterionIds.length !== actualIds.length ||
      actualIds.some((id) => !reference.criterionIds!.includes(id)))
  )
    throw new Error('Frozen criterion IDs differ from the actual checklist');
  const ids = new Set<string>();
  for (const item of reference.cases) {
    if (ids.has(item.sourceId)) throw new Error('Duplicate reference source ID');
    ids.add(item.sourceId);
    if (item.split === 'holdout' && reference.previouslyReviewedSources.includes(item.sourceId))
      throw new Error('Holdout source was previously reviewed: ' + item.sourceId);
    const matches = conversations.filter((c) => c.sourceConversationId === item.sourceId);
    if (matches.length !== 1) throw new Error('Source missing or ambiguous: ' + item.sourceId);
    const conversation = matches[0];
    const hash = fingerprint({
      language: conversation.language,
      channel: conversation.channel,
      messages: conversation.messages,
    });
    if (hash !== item.transcriptHash || conversation.language !== item.language)
      throw new Error('Transcript changed after freeze: ' + item.sourceId);
  }
}

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const percent = (n: number, denominator: number) =>
  denominator ? round((100 * n) / denominator) : null;

function summarize(cases: FrozenCase[], byId: Map<string, BenchmarkResult>) {
  const byCriterion: Record<
    string,
    { scheduled: number; compared: number; matched: number; agreementPercent: number | null }
  > = {};
  for (const item of cases)
    for (const id of Object.keys(item.expectedValues)) {
      byCriterion[id] ??= { scheduled: 0, compared: 0, matched: 0, agreementPercent: null };
      byCriterion[id].scheduled++;
    }
  let completedDialogs = 0,
    failedDialogs = 0,
    invalidDialogs = 0,
    notRunDialogs = 0;
  let comparedCriteria = 0,
    matchedCriteria = 0,
    matchingDialogs = 0;
  let absoluteScoreError = 0,
    comparedScores = 0;
  const na = { missed: 0, spurious: 0 };
  const gross = { truePositives: 0, trueNegatives: 0, falsePositives: 0, falseNegatives: 0 };
  const mismatches: {
    sourceId: string;
    criterionId: string;
    expected: CriterionAnswer['value'];
    actual: CriterionAnswer['value'] | null;
  }[] = [];
  for (const item of cases) {
    const result = byId.get(item.sourceId);
    if (!result) {
      notRunDialogs++;
      continue;
    }
    if (result.status === 'failed') {
      failedDialogs++;
      continue;
    }
    if (result.technicalErrors.length) {
      invalidDialogs++;
      continue;
    }
    completedDialogs++;
    let matching = true;
    for (const [criterionId, expected] of Object.entries(item.expectedValues)) {
      const actual = result.values[criterionId];
      comparedCriteria++;
      byCriterion[criterionId].compared++;
      if (actual === expected) {
        matchedCriteria++;
        byCriterion[criterionId].matched++;
      } else {
        matching = false;
        mismatches.push({ sourceId: item.sourceId, criterionId, expected, actual: actual ?? null });
      }
      if (expected === 'NA' && actual !== 'NA') na.missed++;
      if (expected !== 'NA' && actual === 'NA') na.spurious++;
      if (criterionId === 'gross' && typeof expected === 'boolean') {
        if (expected && actual === true) gross.truePositives++;
        else if (expected) gross.falseNegatives++;
        else if (actual === true) gross.falsePositives++;
        else if (actual === false) gross.trueNegatives++;
      }
    }
    if (matching) matchingDialogs++;
    if (item.expectedTotal !== undefined && result.total !== null) {
      absoluteScoreError += Math.abs(result.total - item.expectedTotal);
      comparedScores++;
    }
  }
  const scheduledCriteria = cases.reduce(
    (sum, item) => sum + Object.keys(item.expectedValues).length,
    0,
  );
  for (const metric of Object.values(byCriterion))
    metric.agreementPercent = percent(metric.matched, metric.compared);
  return {
    scheduledDialogs: cases.length,
    completedDialogs,
    failedDialogs,
    invalidDialogs,
    notRunDialogs,
    scheduledCriteria,
    comparedCriteria,
    matchedCriteria,
    matchingDialogs,
    exactDialogAgreementPercent: percent(matchingDialogs, completedDialogs),
    exactDialogsOverScheduledPercent: percent(matchingDialogs, cases.length),
    // Dialogue-level successes avoid pretending eight correlated decisions are eight independent samples.
    dialogueConfidenceInterval95: wilsonInterval(matchingDialogs, cases.length),
    byCriterion,
    criterionAgreementPercent: percent(matchedCriteria, comparedCriteria),
    matchedOverScheduledPercent: percent(matchedCriteria, scheduledCriteria),
    comparedScores,
    meanAbsoluteScoreError: comparedScores ? round(absoluteScoreError / comparedScores) : null,
    na,
    gross,
    mismatches,
  };
}

function wilsonInterval(successes: number, count: number) {
  if (!count) return null;
  const z = 1.959963984540054;
  const p = successes / count;
  const denominator = 1 + (z * z) / count;
  const centre = (p + (z * z) / (2 * count)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * count)) / count)) / denominator;
  return {
    lowerPercent: 100 * Math.max(0, centre - margin),
    upperPercent: 100 * Math.min(1, centre + margin),
  };
}

export function summarizeBenchmark(cases: FrozenCase[], results: BenchmarkResult[]) {
  const byId = new Map<string, BenchmarkResult>();
  for (const result of results) {
    if (byId.has(result.sourceId)) throw new Error('Duplicate result source ID');
    if (!cases.some((item) => item.sourceId === result.sourceId))
      throw new Error('Unknown result source ID');
    byId.set(result.sourceId, result);
  }
  const holdout = cases.filter((item) => item.split === 'holdout');
  return {
    holdout: summarize(holdout, byId),
    regression: summarize(
      cases.filter((item) => item.split === 'regression'),
      byId,
    ),
    holdoutByLanguage: Object.fromEntries(
      ['RU', 'KZ', 'EN'].map((language) => [
        language,
        summarize(
          holdout.filter((item) => item.language === language),
          byId,
        ),
      ]),
    ),
  };
}

/** Claim eligibility is deliberately stronger than a completed-only calibration percentage. */
export function assessQualityTarget(
  reference: FrozenBenchmark,
  results: BenchmarkResult[],
  checklist?: ChecklistVersion,
) {
  const metrics = summarizeBenchmark(reference.cases, results);
  const holdout = reference.cases.filter((c) => c.split === 'holdout');
  const summary = metrics.holdout;
  const reasons: string[] = [];
  if (!reference.humanReviewed) reasons.push('LABELS_NOT_HUMAN_REVIEWED');
  if (!reference.independentDialogs) reasons.push('INDEPENDENT_DIALOGUES_NOT_CONFIRMED');
  if (!reference.configurationId?.trim()) reasons.push('CONFIGURATION_NOT_FROZEN');
  if (!holdout.length) reasons.push('NO_HOLDOUT');
  const criteria = checklist?.criteria.map((c) => c.id);
  if (!criteria?.length) reasons.push('CHECKLIST_COVERAGE_UNKNOWN');
  else if (
    holdout.some(
      (c) =>
        Object.keys(c.expectedValues).length !== criteria.length ||
        criteria.some((id) => !(id in c.expectedValues)),
    )
  )
    reasons.push('PARTIAL_REFERENCE_LABELS');
  if (
    checklist &&
    fingerprint({
      title: checklist.title,
      sections: checklist.sections,
      criteria: checklist.criteria,
    }) !== reference.checklistHash
  )
    reasons.push('CHECKLIST_CONTENT_MISMATCH');
  if (
    criteria &&
    reference.criterionIds &&
    (reference.criterionIds.length !== criteria.length ||
      new Set(reference.criterionIds).size !== criteria.length ||
      criteria.some((id) => !reference.criterionIds!.includes(id)))
  )
    reasons.push('CHECKLIST_CRITERIA_MISMATCH');
  if (summary.completedDialogs !== summary.scheduledDialogs) reasons.push('INCOMPLETE_HOLDOUT');
  if ((summary.criterionAgreementPercent ?? 0) <= 95)
    reasons.push('CRITERION_AGREEMENT_NOT_ABOVE_95');
  if (
    ['RU', 'KZ', 'EN'].some(
      (language) => (metrics.holdoutByLanguage[language].criterionAgreementPercent ?? 0) <= 95,
    )
  )
    reasons.push('LANGUAGE_COVERAGE_OR_AGREEMENT_INSUFFICIENT');
  if (summary.gross.falseNegatives || summary.gross.falsePositives)
    reasons.push('GROSS_VIOLATION_ERRORS');
  if (!summary.gross.truePositives || !summary.gross.trueNegatives)
    reasons.push('GROSS_CLASS_COVERAGE_INSUFFICIENT');
  if ((summary.dialogueConfidenceInterval95?.lowerPercent ?? 0) <= 95)
    reasons.push('INSUFFICIENT_STATISTICAL_EVIDENCE');
  return {
    targetPercent: 95,
    claimSupported: reasons.length === 0,
    reasons,
    criterionAgreementPercent: summary.criterionAgreementPercent,
    exactDialogConfidenceInterval95: summary.dialogueConfidenceInterval95,
  };
}
