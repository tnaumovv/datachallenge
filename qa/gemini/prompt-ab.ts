/** Paired calibration experiment. Full inputs and outputs stay in ignored runtime/. */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createDatabase } from '../../server/src/db.js';
import { ConversationService } from '../../server/src/conversations/service.js';
import { ChecklistService } from '../../server/src/checklists/service.js';
import { EvaluationService } from '../../server/src/evaluations/service.js';
import { GeminiProvider } from '../../server/src/evaluations/gemini.js';
import { buildEvaluationPrompt as baseline } from './baseline-prompt-v4.js';
import { buildEvaluationPrompt as compactV5 } from './compact-prompt-v5.js';
import { buildEvaluationPrompt as compact } from './compact-prompt.js';
import { ProviderError, type ProviderInput } from '../../server/src/evaluations/provider.js';
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
    'include-v5': { type: 'boolean', default: false },
    reference: { type: 'string' },
    database: { type: 'string' },
    repeats: { type: 'string', default: '2' },
  },
});
if (!values.reference || !values.database)
  throw new Error('Provide --reference and --database; add --run for API calls');
const repeats = Number(values.repeats);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 2)
  throw new Error('repeats must be 1..2');
const ref: FrozenBenchmark = JSON.parse(readFileSync(values.reference, 'utf8'));
if (!ref.cases.length || ref.cases.length > 20) throw new Error('Choose 1..20 cases');
const source = new DatabaseSync(values.database, { readOnly: true });
const conversations = new ConversationService(source).list('DEV');
const checklist = new ChecklistService(source).get(ref.checklistVersionId)!;
assertFrozenInputs(ref, conversations, checklist);
const dir = `runtime/prompt-ab/${Date.now()}`;
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
const builders: Record<string, typeof baseline> = values['include-v5']
  ? { baseline, compactV5, compact }
  : { baseline, compact };
const variants = Object.keys(builders);
const versions: Record<string, string> = {
  baseline: 'cqa-evaluator-v4',
  compactV5: 'cqa-evaluator-v5-candidate',
  compact: 'cqa-evaluator-v6-candidate',
};
const files: Record<string, string> = {
  baseline: 'baseline-prompt-v4.ts',
  compactV5: 'compact-prompt-v5.ts',
  compact: 'compact-prompt.ts',
};
type Variant = string;
type Row = BenchmarkResult & {
  variant: Variant;
  repeat: number;
  durationMs: number;
  usage: Evaluation['usage'];
  evaluationId: string;
};
const report = {
  startedAt: new Date().toISOString(),
  finishedAt: null as string | null,
  labelSource: ref.labelSource,
  humanReviewed: ref.humanReviewed,
  independentAccuracyEstimate: false,
  referenceHash: fingerprint(ref),
  model: 'gemini-3.5-flash-lite',
  thinking: 'low' as const,
  maxOutputTokens: 8192,
  timeoutMs: 120000,
  repeats,
  maxCalls: ref.cases.length * repeats * variants.length * 4,
  calls: 0,
  pricing: {
    inputPerMillion: 0.3,
    outputIncludingThinkingPerMillion: 2.5,
    source: 'docs/AI_MODELS.md',
    estimatedUncachedTariffOnly: true,
  },
  // Full evaluation latency includes retries, excluding HTTP polling overhead and queue wait.
  latencyScope:
    'single-concurrency evaluation service, including repair/backoff; no frontend/network queue wait',
  promptVersions: versions,
  promptHashes: Object.fromEntries(
    variants.map((v) => [v, fingerprint(readFileSync('qa/gemini/' + files[v], 'utf8'))]),
  ),
  rows: [] as Row[],
  summary: {} as Record<string, unknown>,
  stopReason: null as string | null,
  complete: false,
};
writeFileSync(`${dir}/frozen-reference.json`, JSON.stringify(ref, null, 2));
for (const [variant, builder] of Object.entries(builders)) {
  const prompts = ref.cases.map((item) => ({
    sourceId: item.sourceId,
    ...builder!(
      conversations.find((c) => c.sourceConversationId === item.sourceId)!,
      checklist,
    ),
  }));
  writeFileSync(`${dir}/${variant}-prompts.json`, JSON.stringify(prompts, null, 2));
  console.log(
    JSON.stringify({
      variant,
      promptCharacters: prompts.reduce((s, p) => s + p.system.length + p.user.length, 0),
    }),
  );
}
function save() {
  for (const variant of Object.keys(builders) as Variant[]) {
    const rows = report.rows.filter((r) => r.variant === variant);
    report.summary[variant] = {
      performance: summarizePerformance(rows),
      byRepeat: Array.from({ length: repeats }, (_, repeat) =>
        summarizeBenchmark(
          ref.cases,
          rows.filter((r) => r.repeat === repeat),
        ),
      ),
    };
  }
  writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
}
save();
if (!values.run) {
  console.log(JSON.stringify({ directory: dir, dryRun: true }));
  db.close();
  process.exit(0);
}
if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY required');
let active: { variant: Variant; input: ProviderInput };
const transport: typeof fetch = async (url, init) => {
  if (report.calls >= report.maxCalls) throw new ProviderError('CALL_BUDGET', false);
  const prompt = builders[active.variant]!(
    active.input.conversation,
    active.input.checklist,
    active.input.repair,
  );
  const body = JSON.parse(String(init?.body));
  body.systemInstruction = { parts: [{ text: prompt.system }] };
  body.contents = [{ role: 'user', parts: [{ text: prompt.user }] }];
  report.calls++;
  save();
  return fetch(url, { ...init, body: JSON.stringify(body) });
};
const gemini = new GeminiProvider(
  {
    apiKey: process.env.GEMINI_API_KEY,
    modelId: report.model,
    thinkingLevel: report.thinking,
    maxOutputTokens: report.maxOutputTokens,
    outputFormat: 'answers-v4',
  },
  transport,
);
try {
  outer: for (let repeat = 0; repeat < repeats; repeat++) {
    for (let i = 0; i < ref.cases.length; i++) {
      const item = ref.cases[i];
      const conversation = conversations.find((c) => c.sourceConversationId === item.sourceId)!;
      // Rotate first position across cases; reverse within the second repeat.
      const offset = i % variants.length;
      const order: Variant[] = [...variants.slice(offset), ...variants.slice(0, offset)];
      if (repeat % 2) order.reverse();
      for (const variant of order) {
        const provider = {
          id: gemini.id,
          modelId: gemini.modelId,
          configurationId: fingerprint([gemini.configurationId, report.promptHashes[variant]]),
          generate(input: ProviderInput) {
            active = { variant, input };
            return gemini.generate(input);
          },
        };
        const service = new EvaluationService(db, provider, {
          concurrency: 1,
          requestTimeoutMs: report.timeoutMs,
        });
        service.start();
        const [id] = service.enqueue([conversation.id], checklist.id, true);
        let evaluation: Evaluation;
        try {
          for (;;) {
            evaluation = service.get(id)!;
            if (['completed', 'failed'].includes(evaluation.status)) break;
            await delay(100);
          }
        } finally {
          await service.stop();
        }
        // The QA transport selects the prompt; record its real identity, independently of production's constant.
        evaluation.promptVersion = versions[variant];
        db.prepare('UPDATE evaluations SET payload=? WHERE id=?').run(
          JSON.stringify(evaluation),
          id,
        );
        const review = reviewEvaluation(evaluation, conversation, checklist, item);
        const row: Row = {
          sourceId: item.sourceId,
          variant,
          repeat,
          evaluationId: id,
          status: evaluation.status as 'completed' | 'failed',
          technicalErrors: review.technicalErrors,
          semanticMismatches: review.semanticMismatches,
          values: Object.fromEntries(
            evaluation.originalAnswers.map((a) => [a.criterionId, a.value]),
          ),
          total: evaluation.originalScore?.total ?? null,
          durationMs: Date.parse(evaluation.finishedAt!) - Date.parse(evaluation.startedAt!),
          usage: evaluation.usage,
        };
        report.rows.push(row);
        writeFileSync(`${dir}/${id}.json`, JSON.stringify(evaluation, null, 2));
        save();
        console.log(
          JSON.stringify({
            sourceId: item.sourceId,
            variant,
            repeat,
            status: row.status,
            calls: evaluation.usage.calls,
            durationMs: row.durationMs,
            mismatches: review.semanticMismatches.length,
          }),
        );
        if (row.status === 'failed' && evaluation.error?.code !== 'INVALID_MODEL_OUTPUT') {
          report.stopReason = evaluation.error?.code ?? 'PROVIDER_FAILED';
          break outer;
        }
      }
    }
  }
} finally {
  report.complete =
    !report.stopReason && report.rows.length === ref.cases.length * repeats * variants.length;
  if (!report.complete) process.exitCode = 1;
  report.finishedAt = new Date().toISOString();
  save();
  db.close();
  console.log(
    JSON.stringify({ directory: dir, calls: report.calls, stopReason: report.stopReason }),
  );
}
