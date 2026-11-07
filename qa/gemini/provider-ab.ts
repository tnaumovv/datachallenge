/** Explicit paid calibration run; predictions and transcripts remain in ignored runtime/. */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createDatabase } from '../../server/src/db.js';
import { ConversationService } from '../../server/src/conversations/service.js';
import { ChecklistService } from '../../server/src/checklists/service.js';
import { EvaluationService } from '../../server/src/evaluations/service.js';
import { providerFromEnv } from '../../server/src/evaluations/config.js';
import { CompatibleProvider } from '../../server/src/evaluations/compatible.js';
import { ProviderError } from '../../server/src/evaluations/provider.js';
import { PROMPT_VERSION } from '../../server/src/evaluations/legacy-prompt.js';
import {
  assertFrozenInputs,
  fingerprint,
  summarizeBenchmark,
  type FrozenBenchmark,
  type BenchmarkResult,
} from './benchmark.js';
import { reviewEvaluation } from './review.js';
import { summarizePerformance } from './prompt-metrics.js';
import type { Evaluation } from '../../shared/contracts.js';

const { values } = parseArgs({
  options: {
    run: { type: 'boolean', default: false },
    reference: { type: 'string' },
    database: { type: 'string' },
    repeats: { type: 'string', default: '2' },
    'openai-model': { type: 'string', default: 'gpt-6-luna' },
  },
});
if (!values.reference || !values.database)
  throw new Error('Provide --reference and --database; --run enables API calls');
const repeats = Number(values.repeats);
if (![1, 2].includes(repeats)) throw new Error('repeats must be 1 or 2');
const ref: FrozenBenchmark = JSON.parse(readFileSync(values.reference, 'utf8'));
if (!ref.cases.length || ref.cases.length > 12) throw new Error('Choose 1..12 frozen cases');
const source = new DatabaseSync(values.database, { readOnly: true });
const conversations = new ConversationService(source).list('DEV');
const checklist = new ChecklistService(source).get(ref.checklistVersionId)!;
assertFrozenInputs(ref, conversations, checklist);
const dir = `runtime/provider-ab/${Date.now()}`;
mkdirSync(dir, { recursive: true });
const db = createDatabase(`${dir}/evaluations.sqlite`);
for (const item of ref.cases) {
  const c = conversations.find((c) => c.sourceConversationId === item.sourceId)!;
  db.prepare('INSERT INTO conversations VALUES (?,?,?,?,?)').run(
    c.id,
    c.groupId,
    c.sourceConversationId,
    c.transcriptHash,
    JSON.stringify(c),
  );
}
db.prepare('INSERT INTO checklist_versions VALUES (?,?,?,?)').run(
  checklist.id,
  checklist.checklistId,
  checklist.version,
  JSON.stringify(checklist),
);
source.close();
type Row = BenchmarkResult & {
  variant: string;
  repeat: number;
  evaluationId: string;
  durationMs: number;
  usage: Evaluation['usage'];
  attempts: Evaluation['attempts'];
};
// Snapshot only for this exact pair; unknown models must not borrow their prices.
const pricing: Record<
  string,
  { inputPerMillion: number; outputPerMillion: number; source: string }
> = {
  'gemini-3.5-flash-lite': {
    inputPerMillion: 0.3,
    outputPerMillion: 2.5,
    source: 'docs/AI_MODELS.md',
  },
  'gpt-6-luna': {
    inputPerMillion: 0.1,
    outputPerMillion: 0.5,
    source: 'https://developers.openai.com/api/docs/models/gpt-6-luna',
  },
};
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  finishedAt: null as string | null,
  referenceHash: fingerprint(ref),
  labelSource: ref.labelSource,
  humanReviewed: ref.humanReviewed,
  independentAccuracyEstimate: false,
  promptVersion: PROMPT_VERSION,
  repeats,
  maxCalls: ref.cases.length * repeats * 2 * 4,
  calls: 0,
  rows: [] as Row[],
  summary: {} as Record<string, unknown>,
  configurations: {} as Record<string, unknown>,
  stopReason: null as string | null,
  complete: false,
  latencyScope: 'single-concurrency, includes repair/retry/backoff; excludes UI queue',
  pricingVersion: '2026-11-07-standard-uncached-estimate',
  pricing,
};
writeFileSync(`${dir}/frozen-reference.json`, JSON.stringify(ref, null, 2));
function save() {
  for (const variant of ['gemini', 'openai']) {
    const rows = report.rows.filter((r) => r.variant === variant);
    const model = variant === 'openai' ? values['openai-model'] : process.env.GEMINI_MODEL;
    const price = model ? pricing[model] : undefined;
    report.summary[variant] = {
      latency: (({ p50Ms, p95Ms, totalDurationMs }) => ({ p50Ms, p95Ms, totalDurationMs }))(
        summarizePerformance(rows),
      ),
      cost: price
        ? summarizePerformance(
            rows.flatMap((r) =>
              r.attempts.map((a) => ({ durationMs: a.durationMs ?? 0, usage: a.usage })),
            ),
            price,
          )
        : { estimatedUncachedUsd: null, reason: 'unknown tariff' },
      byRepeat: Array.from({ length: repeats }, (_, n) =>
        summarizeBenchmark(
          ref.cases,
          rows.filter((r) => r.repeat === n),
        ),
      ),
    };
  }
  writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
}
if (!values.run) {
  save();
  console.log(JSON.stringify({ directory: dir, dryRun: true, maxCalls: report.maxCalls }));
  db.close();
  process.exit(0);
}
if (!process.env.OPENAI_API_KEY || !process.env.GEMINI_API_KEY)
  throw new Error('Both provider keys must be configured locally');
const transport: typeof fetch = async (url, init) => {
  if (report.calls >= report.maxCalls) throw new ProviderError('CALL_BUDGET', false);
  report.calls++;
  save();
  return fetch(url, init);
};
const gemini = providerFromEnv({
  ...process.env,
  AI_PROVIDER: 'gemini',
  AI_EVALUATION_POLICY: 'v4',
})!;
const openai = new CompatibleProvider(
  {
    kind: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    modelId: values['openai-model']!,
    reasoningEffort: 'none',
    maxOutputTokens: 8192,
    outputFormat: 'answers-v4',
  },
  transport,
);
// Gemini transport counts at the provider boundary; SDK retries are disabled.
const providers = {
  gemini: {
    ...gemini,
    id: gemini.id,
    modelId: gemini.modelId,
    configurationId: gemini.configurationId,
    generate: async (input: Parameters<typeof gemini.generate>[0]) => {
      if (report.calls >= report.maxCalls) throw new ProviderError('CALL_BUDGET', false);
      report.calls++;
      save();
      return gemini.generate(input);
    },
  },
  openai,
};
for (const [key, p] of Object.entries(providers))
  report.configurations[key] = {
    providerId: p.id,
    modelId: p.modelId,
    configurationId: p.configurationId,
  };
try {
  outer: for (let repeat = 0; repeat < repeats; repeat++) {
    for (let i = 0; i < ref.cases.length; i++) {
      const item = ref.cases[i];
      const c = conversations.find((c) => c.sourceConversationId === item.sourceId)!;
      const order: ('gemini' | 'openai')[] =
        (i + repeat) % 2 ? ['openai', 'gemini'] : ['gemini', 'openai'];
      for (const variant of order) {
        const service = new EvaluationService(db, providers[variant], {
          concurrency: 1,
          requestTimeoutMs: 120000,
        });
        service.start();
        const [id] = service.enqueue([c.id], checklist.id, true);
        let e: Evaluation;
        try {
          for (;;) {
            e = service.get(id)!;
            if (e.status === 'completed' || e.status === 'failed') break;
            await delay(50);
          }
        } finally {
          await service.stop();
        }
        const review = reviewEvaluation(e, c, checklist, item);
        report.rows.push({
          sourceId: item.sourceId,
          variant,
          repeat,
          evaluationId: id,
          status: e.status as 'completed' | 'failed',
          technicalErrors: review.technicalErrors,
          semanticMismatches: review.semanticMismatches,
          values: Object.fromEntries(e.originalAnswers.map((a) => [a.criterionId, a.value])),
          total: e.originalScore?.total ?? null,
          durationMs: Date.parse(e.finishedAt!) - Date.parse(e.startedAt!),
          usage: e.usage,
          attempts: e.attempts,
        });
        writeFileSync(`${dir}/${id}.json`, JSON.stringify(e, null, 2));
        save();
        console.log(
          JSON.stringify({
            variant,
            repeat,
            sourceId: item.sourceId,
            status: e.status,
            calls: e.usage.calls,
          }),
        );
        if (e.status === 'failed' && e.error?.code !== 'INVALID_MODEL_OUTPUT') {
          report.stopReason = e.error?.code ?? 'PROVIDER_FAILED';
          break outer;
        }
      }
    }
  }
} finally {
  report.complete = !report.stopReason && report.rows.length === ref.cases.length * repeats * 2;
  report.finishedAt = new Date().toISOString();
  save();
  db.close();
  if (!report.complete) process.exitCode = 1;
  console.log(
    JSON.stringify({
      directory: dir,
      complete: report.complete,
      stopReason: report.stopReason,
      calls: report.calls,
    }),
  );
}
