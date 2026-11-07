import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  ChecklistVersion,
  Conversation,
  Evaluation,
  EvaluationConfiguration,
} from '../../shared/contracts.js';
import {
  assertFrozenInputs,
  fingerprint,
  summarizeBenchmark,
  assessQualityTarget,
  selectSavedEvaluation,
  predictionFollowsFreeze,
  type BenchmarkResult,
  type FrozenBenchmark,
} from './benchmark.js';
import { reviewEvaluation } from './review.js';

const { values: options } = parseArgs({
  options: {
    run: { type: 'boolean' },
    reference: { type: 'string' },
    'max-calls': { type: 'string', default: '16' },
    split: { type: 'string', default: 'holdout' },
    api: { type: 'string', default: 'http://127.0.0.1:3000' },
  },
});
if (!options.run || !options.reference)
  throw new Error('Use --run --reference path/to/frozen-reference.json');
const maxCalls = Number(options['max-calls']);
if (!Number.isInteger(maxCalls) || maxCalls < 0 || maxCalls > 36)
  throw new Error('Call budget must be 0..36; 0 reads saved results only');
if (!['holdout', 'regression', 'all'].includes(options.split)) throw new Error('Unknown split');
const target = new URL(options.api);
if (
  target.protocol !== 'http:' ||
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  target.username ||
  target.password ||
  target.pathname !== '/' ||
  target.search ||
  target.hash
)
  throw new Error('Only a plain local HTTP API is allowed');
const base = target.origin;
const reference: FrozenBenchmark = JSON.parse(readFileSync(options.reference, 'utf8'));
if (!reference.configurationId?.trim())
  throw new Error(
    'Frozen configuration ID is required; legacy references cannot select comparable results',
  );
if (
  reference.schemaVersion !== 1 ||
  !Number.isFinite(Date.parse(reference.frozenAt)) ||
  Date.parse(reference.frozenAt) > Date.now()
)
  throw new Error('Invalid reference freeze metadata');
const cases = reference.cases.filter(
  (item) => options.split === 'all' || item.split === options.split,
);
if (!cases.length || cases.length > 20) throw new Error('Choose 1..20 frozen cases');
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(base + path, {
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`API ${response.status}: ${data.error?.code ?? 'UNKNOWN'}`);
  return data;
}
const conversations = await api<Conversation[]>('/api/conversations?groupId=DEV');
const checklist = await api<ChecklistVersion>(
  '/api/checklists/' + encodeURIComponent(reference.checklistVersionId),
);
const liveConfiguration =
  maxCalls === 0 ? undefined : await api<EvaluationConfiguration>('/api/ai/status');
assertFrozenInputs(reference, conversations, checklist, liveConfiguration);
const previous = await api<Evaluation[]>('/api/evaluations');
const directory = 'runtime/ai-quality';
mkdirSync(directory, { recursive: true });
type RunResult = BenchmarkResult & {
  evaluationId: string;
  modelId: string;
  providerId: string;
  configurationId: string;
  modelVersions: string[];
  calls: number;
  semanticMismatches: Record<string, unknown>[];
  errorCode: string | null;
};
const run = {
  startedAt: new Date().toISOString(),
  finishedAt: null as string | null,
  referenceFile: options.reference,
  referenceHash: fingerprint(reference),
  labelSource: reference.labelSource,
  humanReviewed: reference.humanReviewed,
  independentAccuracyEstimate: false,
  modelId: reference.modelId,
  promptVersion: reference.promptVersion,
  checklistVersionId: checklist.id,
  maxNewModelCalls: maxCalls,
  newModelCalls: 0,
  readOnly: maxCalls === 0,
  liveConfiguration: liveConfiguration ?? null,
  split: options.split,
  results: [] as RunResult[],
  stopReason: null as string | null,
  metrics: summarizeBenchmark(cases, []),
  qualityGate: assessQualityTarget({ ...reference, cases }, [], checklist),
};
const reportPath = `${directory}/benchmark-${Date.now()}.json`;
const save = () => {
  run.metrics = summarizeBenchmark(cases, run.results);
  run.qualityGate = assessQualityTarget({ ...reference, cases }, run.results, checklist);
  writeFileSync(reportPath, JSON.stringify(run, null, 2) + '\n');
};
save();
for (const item of cases) {
  const conversation = conversations.find((c) => c.sourceConversationId === item.sourceId)!;
  let evaluationId: string;
  if (maxCalls === 0) {
    const saved = selectSavedEvaluation(reference, item, conversation.id, previous);
    if (!saved) continue;
    evaluationId = saved.id;
  } else {
    if (run.newModelCalls + 4 > maxCalls) {
      run.stopReason = 'Remaining budget cannot reserve four backend attempts';
      break;
    }
    assertFrozenInputs(
      reference,
      conversations,
      checklist,
      await api<EvaluationConfiguration>('/api/ai/status'),
    );
    // Reference labels are intentionally absent: only immutable conversation/checklist IDs are sent.
    const submitted = await api<{ evaluationIds: string[] }>('/api/evaluations', {
      conversationIds: [conversation.id],
      checklistVersionId: checklist.id,
      force: true,
    });
    evaluationId = submitted.evaluationIds[0];
    console.log(JSON.stringify({ sourceId: item.sourceId, evaluationId, status: 'submitted' }));
  }
  const deadline = Date.now() + 650000;
  let evaluation: Evaluation;
  for (;;) {
    evaluation = await api<Evaluation>('/api/evaluations/' + encodeURIComponent(evaluationId));
    if (['completed', 'failed'].includes(evaluation.status)) break;
    if (Date.now() > deadline)
      throw new Error('Polling deadline exceeded; evaluation was not resubmitted');
    await delay(1500);
  }
  const review = reviewEvaluation(evaluation, conversation, checklist, item);
  if (item.split === 'holdout' && !predictionFollowsFreeze(reference, evaluation))
    review.technicalErrors.push('Holdout prediction did not start after the reference freeze');
  if (
    evaluation.modelId !== reference.modelId ||
    evaluation.promptVersion !== reference.promptVersion ||
    evaluation.configurationId !== reference.configurationId
  )
    review.technicalErrors.push('Evaluation does not match the frozen model/prompt configuration');
  const result: RunResult = {
    sourceId: item.sourceId,
    evaluationId,
    status: evaluation.status as 'completed' | 'failed',
    modelId: evaluation.modelId,
    providerId: evaluation.providerId,
    configurationId: evaluation.configurationId,
    modelVersions: [
      ...new Set(evaluation.attempts.map((a) => a.modelVersion).filter((v): v is string => !!v)),
    ],
    calls: maxCalls === 0 ? 0 : evaluation.usage.calls,
    values: Object.fromEntries(evaluation.originalAnswers.map((a) => [a.criterionId, a.value])),
    total: evaluation.originalScore?.total ?? null,
    technicalErrors: review.technicalErrors,
    semanticMismatches: review.semanticMismatches,
    errorCode: evaluation.error?.code ?? null,
  };
  run.newModelCalls += result.calls;
  run.results.push(result);
  writeFileSync(
    `${directory}/result-${evaluation.id}.json`,
    JSON.stringify(evaluation, null, 2) + '\n',
  );
  save();
  console.log(JSON.stringify(result));
  if (maxCalls !== 0 && (evaluation.status === 'failed' || review.technicalErrors.length)) {
    run.stopReason = 'Stopped after a provider or technical validation failure';
    break;
  }
}
run.finishedAt = new Date().toISOString();
save();
if (
  run.results.length !== cases.length ||
  run.results.some(
    (r) => r.status !== 'completed' || r.technicalErrors.length || r.semanticMismatches.length,
  )
)
  process.exitCode = 1;
console.log(
  JSON.stringify({
    report: reportPath,
    metrics: run.metrics,
    newModelCalls: run.newModelCalls,
    stopReason: run.stopReason,
  }),
);
