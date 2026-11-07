import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { reviewEvaluation } from './review.js';
import type { Conversation, ChecklistVersion, Evaluation } from '../../shared/contracts.js';

if (process.argv[2] !== '--run')
  throw new Error('Live Gemini calls require --run followed by explicit case IDs');
const sources = process.argv.slice(3);
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
};
const runPath = `runtime/gemini-qa/run-${Date.now()}.json`;
for (const sourceId of sources) {
  const conversation = conversations.find(
    (c) => c.sourceConversationId === sourceId && c.channel === 'agent chat',
  );
  if (!conversation) throw new Error(`Synthetic chat ${sourceId} missing`);
  const request = { conversationIds: [conversation.id], checklistVersionId: checklist.id };
  const { evaluationIds } = await api('/api/evaluations', request);
  const id = evaluationIds[0];
  console.log(JSON.stringify({ sourceId, evaluationId: id, status: 'submitted' }));
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
  let cacheVerified = false;
  if (evaluation.status === 'completed') {
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
  run.results.push(summary);
  writeFileSync(runPath, JSON.stringify(run, null, 2));
  console.log(JSON.stringify(summary));
  if (evaluation.status === 'failed') {
    console.log('Stopped after failed evaluation to preserve quota.');
    break;
  }
}
run.finishedAt = new Date().toISOString();
run.notRun = sources.filter((sourceId) => !run.results.some((r: any) => r.sourceId === sourceId));
writeFileSync(runPath, JSON.stringify(run, null, 2));
if (
  run.notRun.length ||
  run.results.some(
    (r: any) => r.status !== 'completed' || r.reviewStatus !== 'passed' || !r.cacheVerified,
  )
)
  process.exitCode = 1;
console.log(JSON.stringify({ report: runPath, evaluated: run.results.length, notRun: run.notRun }));
