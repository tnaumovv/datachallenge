import { readFileSync, writeFileSync } from 'node:fs';
import { summarizePerformance } from './prompt-metrics.js';
import type { FrozenBenchmark, BenchmarkResult } from './benchmark.js';
import type { Evaluation } from '../../shared/contracts.js';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: tsx qa/gemini/prompt-report.ts runtime/prompt-ab/<run>');
type Row = BenchmarkResult & {
  variant: string;
  repeat: number;
  durationMs: number;
  usage: Evaluation['usage'];
};
const report = JSON.parse(readFileSync(`${directory}/report.json`, 'utf8'));
const reference: FrozenBenchmark = JSON.parse(
  readFileSync(`${directory}/frozen-reference.json`, 'utf8'),
);
const rows: Row[] = report.rows;
const variants = Object.keys(report.promptHashes);
const summarize = (selected: Row[]) => {
  let matched = 0,
    labelled = 0,
    allLabelsMatched = 0,
    fullyLabelledMatched = 0,
    fullyLabelled = 0;
  let naMissed = 0,
    naSpurious = 0;
  let grossFalsePositives = 0,
    grossFalseNegatives = 0;
  for (const row of selected) {
    const ref = reference.cases.find((c) => c.sourceId === row.sourceId)!;
    const valid = row.status === 'completed' && !row.technicalErrors.length;
    const labels = Object.entries(ref.expectedValues);
    labelled += labels.length;
    const hits = valid ? labels.filter(([id, v]) => row.values[id] === v).length : 0;
    matched += hits;
    if (valid)
      for (const [id, value] of labels) {
        if (value === 'NA' && row.values[id] !== 'NA') naMissed++;
        if (value !== 'NA' && row.values[id] === 'NA') naSpurious++;
      }
    const all = valid && hits === labels.length && !row.semanticMismatches?.length;
    if (all) allLabelsMatched++;
    if (
      reference.criterionIds?.length &&
      labels.length === reference.criterionIds.length &&
      reference.criterionIds.every((id) => id in ref.expectedValues)
    ) {
      fullyLabelled++;
      if (all) fullyLabelledMatched++;
    }
    if (valid && ref.expectedValues.gross === true && row.values.gross !== true)
      grossFalseNegatives++;
    if (valid && ref.expectedValues.gross === false && row.values.gross === true)
      grossFalsePositives++;
  }
  const evaluations: Evaluation[] = selected.map((row) =>
    JSON.parse(
      readFileSync(
        `${directory}/${(row as Row & { evaluationId: string }).evaluationId}.json`,
        'utf8',
      ),
    ),
  );
  const allAttempts = evaluations.flatMap((e) => e.attempts);
  const attempts = allAttempts.map((a) => ({ durationMs: a.durationMs ?? 0, usage: a.usage }));
  const errors: Record<string, number> = {};
  const validationErrors: Record<string, number> = {};
  for (const a of allAttempts) {
    if (a.errorCode) errors[a.errorCode] = (errors[a.errorCode] ?? 0) + 1;
    for (const error of a.validationErrors)
      validationErrors[error.code] = (validationErrors[error.code] ?? 0) + 1;
  }
  return {
    attemptUsage: summarizePerformance(attempts),
    firstAttemptCompleted: evaluations.filter((e) => e.attempts[0]?.status === 'completed').length,
    attemptErrors: errors,
    validationErrors,
    // Auxiliary view only: never substitute it for all-evaluation latency.
    singleAttemptPerformance: summarizePerformance(
      selected.filter(
        (_, i) => evaluations[i].attempts.length === 1 && evaluations[i].status === 'completed',
      ),
    ),
    evaluations: selected.length,
    matched,
    labelled,
    agreementPercent: labelled ? (100 * matched) / labelled : null,
    allAvailableLabelsAndEvidenceMatched: allLabelsMatched,
    fullyLabelled,
    fullyLabelledMatched,
    naMissed,
    naSpurious,
    grossFalsePositives,
    grossFalseNegatives,
    failures: selected.filter((r) => r.status !== 'completed' || r.technicalErrors.length).length,
    calls: selected.reduce((s, r) => s + r.usage.calls, 0),
    performance: summarizePerformance(selected),
  };
};
const output = {
  startedAt: report.startedAt,
  finishedAt: report.finishedAt,
  complete:
    !report.stopReason &&
    !!report.finishedAt &&
    rows.length === reference.cases.length * report.repeats * variants.length,
  sourceReport: `${directory}/report.json`,
  referenceHash: report.referenceHash,
  promptHashes: report.promptHashes,
  promptVersions: report.promptVersions ?? null,
  schemaExperiment: report.schemaExperiment ?? false,
  schemaHash: report.schemaHash ?? null,
  model: report.model,
  thinking: report.thinking,
  maxOutputTokens: report.maxOutputTokens,
  distinctDialogs: reference.cases.length,
  repeats: report.repeats,
  humanReviewed: reference.humanReviewed,
  independentAccuracyEstimate: false,
  calibrationOnly: true,
  pricing: report.pricing,
  latencyScope: report.latencyScope,
  variants: Object.fromEntries(
    variants.map((variant) => {
      const selected = rows.filter((r) => r.variant === variant);
      return [
        variant,
        {
          ...summarize(selected),
          byRepeat: Array.from({ length: report.repeats }, (_, n) =>
            summarize(selected.filter((r) => r.repeat === n)),
          ),
          byLanguage: Object.fromEntries(
            ['RU', 'KZ', 'EN'].map((lang) => [
              lang,
              summarize(
                selected.filter(
                  (r) => reference.cases.find((c) => c.sourceId === r.sourceId)!.language === lang,
                ),
              ),
            ]),
          ),
        },
      ];
    }),
  ),
};
writeFileSync(`${directory}/summary.json`, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
