import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { reviewEvaluation } from './review.js';
import type { Conversation, ChecklistVersion, Evaluation } from '../../shared/contracts.js';

const { values: options, positionals: sources } = parseArgs({
  options: {
    run: { type: 'boolean' },
    'max-calls': { type: 'string', default: '6' },
    model: { type: 'string', default: 'gemini-3.6-flash' },
  },
  allowPositionals: true,
});
if (!options.run) throw new Error('Live Gemini calls require --run followed by explicit case IDs');
const maxCalls = Number(options['max-calls']);
if (!Number.isInteger(maxCalls) || maxCalls < 0 || maxCalls > 36)
  throw new Error('--max-calls must be an integer from 0 to 36; 0 reads saved results only');
const expectations = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
if (
  !sources.length ||
  sources.length > 9 ||
  new Set(sources).size !== sources.length ||
  sources.some((id) => !expectations.cases.some((c: any) => c.sourceId === id))
)
  throw new Error('Choose 1 to 9 distinct pre-reviewed synthetic DEV cases');
const base = process.env.CQA_API_URL ?? 'http://127.0.0.1:3011';
const target = new URL(base);
if (
  !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
  target.port === '3000' ||
  target.protocol !== 'http:'
)
  throw new Error('Use a separate local test API; demo port 3000 and remote hosts are refused');
async function api(path: string, body?: unknown) {
  const response = await fetch(
    base + path,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const json = await response.json();
  if (!response.ok) throw new Error(`API ${response.status}: ${json.error?.code ?? 'unknown'}`);
  return json;
}
const previous: Evaluation[] = await api('/api/evaluations');
const previousIds = new Set(previous.map((e) => e.id));
const conversations: Conversation[] = await api('/api/conversations?groupId=DEV');
const checklist: ChecklistVersion = JSON.parse(
  readFileSync('runtime/gemini-qa/checklist-version.json', 'utf8'),
);
const run: any = {
  startedAt: new Date().toISOString(),
  checklistVersionId: checklist.id,
  sources,
  results: [],
  reference: expectations.kind,
  maxNewModelCalls: maxCalls,
  readOnly: maxCalls === 0,
};
let newModelCalls = 0;
const runPath = `runtime/gemini-qa/run-${Date.now()}.json`;
for (const sourceId of sources) {
  const conversation = conversations.find(
    (c) => c.sourceConversationId === sourceId && c.channel === 'agent chat',
  );
  if (!conversation) throw new Error(`Synthetic chat ${sourceId} missing`);
  const request = { conversationIds: [conversation.id], checklistVersionId: checklist.id };
  let id: string;
  if (maxCalls === 0) {
    const saved = previous.find(
      (e) =>
        e.status === 'completed' &&
        e.conversationId === conversation.id &&
        e.checklistVersionId === checklist.id &&
        e.modelId === options.model,
    );
    if (!saved) {
      run.stopReason = `No saved result for ${sourceId}; read-only mode never enqueues a task`;
      break;
    }
    id = saved.id;
  } else {
    // The current backend permits at most four provider attempts per evaluation.
    // Reserve the full amount before POST, since enqueue immediately starts generation.
    if (newModelCalls + 4 > maxCalls) {
      run.stopReason = 'Call budget cannot reserve four attempts for another evaluation';
      break;
    }
    const { evaluationIds } = await api('/api/evaluations', request);
    id = evaluationIds[0];
  }
  console.log(
    JSON.stringify({
      sourceId,
      evaluationId: id,
      status: maxCalls === 0 ? 'loaded_saved' : 'submitted',
    }),
  );
  let evaluation: Evaluation;
  const deadline = Date.now() + 400_000;
  do {
    evaluation = await api('/api/evaluations/' + id);
    if (['completed', 'failed'].includes(evaluation.status)) break;
    if (Date.now() > deadline) throw new Error('Polling deadline exceeded; task not re-enqueued');
    await delay(2000);
  } while (true);
  const reference = expectations.cases.find((c: any) => c.sourceId === sourceId);
  const { technicalErrors, semanticMismatches, reviewStatus } = reviewEvaluation(
    evaluation,
    conversation,
    checklist,
    reference,
  );
  const before = createHash('sha256').update(JSON.stringify(evaluation)).digest('hex');
  let cacheVerified: boolean | null = maxCalls === 0 ? null : false;
  if (evaluation.status === 'completed' && maxCalls !== 0) {
    const repeated = await api('/api/evaluations', request);
    const after = await api('/api/evaluations/' + id);
    cacheVerified =
      repeated.evaluationIds[0] === id &&
      createHash('sha256').update(JSON.stringify(after)).digest('hex') === before;
  }
  writeFileSync(
    `runtime/gemini-qa/result-${sourceId}-${id}.json`,
    JSON.stringify(evaluation, null, 2),
  );
  const summary = {
    reusedEvaluation: previousIds.has(id),
    newModelCalls: previousIds.has(id) ? 0 : evaluation.usage.calls,
    sourceId,
    assertedCriteria: Object.keys(reference.expectedValues),
    language: conversation.language,
    evaluationId: id,
    modelId: evaluation.modelId,
    status: evaluation.status,
    total: evaluation.finalScore?.total ?? null,
    grossViolation: evaluation.finalScore?.grossViolation ?? null,
    usage: evaluation.usage,
    durationMs: evaluation.attempts.reduce((s, a) => s + (a.durationMs ?? 0), 0),
    technicalErrors,
    semanticMismatches,
    reviewStatus,
    actualModelVersions: [
      ...new Set(evaluation.attempts.map((a) => a.modelVersion).filter(Boolean)),
    ],
    cacheVerified,
    sha256: before,
    error: evaluation.error,
  };
  newModelCalls += summary.newModelCalls;
  run.results.push(summary);
  writeFileSync(runPath, JSON.stringify(run, null, 2));
  console.log(JSON.stringify(summary));
  if (evaluation.status === 'failed') {
    console.log('Stopped after failed evaluation to preserve quota.');
    break;
  }
}
run.finishedAt = new Date().toISOString();
run.newModelCalls = newModelCalls;
run.notRun = sources.filter((sourceId) => !run.results.some((r: any) => r.sourceId === sourceId));
writeFileSync(runPath, JSON.stringify(run, null, 2));
if (
  run.notRun.length ||
  run.results.some(
    (r: any) =>
      r.status !== 'completed' || r.reviewStatus !== 'passed' || r.cacheVerified === false,
  )
)
  process.exitCode = 1;
console.log(JSON.stringify({ report: runPath, evaluated: run.results.length, notRun: run.notRun }));
