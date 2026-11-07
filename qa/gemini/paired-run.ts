import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ChecklistInputSchema,
  SourceConversationSchema,
  type ChecklistVersion,
  type Conversation,
  type Evaluation,
} from '../../shared/contracts.js';
import { createDatabase } from '../../server/src/db.js';
import { providerFromEnv, evaluationOptionsFromEnv } from '../../server/src/evaluations/config.js';
import { EvaluationService } from '../../server/src/evaluations/service.js';
import { ProviderError, type EvaluationProvider } from '../../server/src/evaluations/provider.js';
import { scoreEvaluation } from '../../server/src/evaluations/scoring.js';
import { fingerprint, type FrozenCase } from './benchmark.js';
import { reviewEvaluation, type ReferenceCase } from './review.js';
import {
  assertPairedInputs,
  predictionFollowsFreeze,
  summarizePaired,
  type PairedReference,
  type PairedResult,
  type PairedVariant,
  type VariantName,
} from './paired.js';

const protocolFiles = [
  'server/src/evaluations/prompt.ts',
  'server/src/evaluations/legacy-prompt.ts',
  'server/src/evaluations/rubric.ts',
  'server/src/evaluations/generation-schema.ts',
  'server/src/evaluations/facts.ts',
  'server/src/evaluations/gemini.ts',
  'server/src/evaluations/compatible.ts',
  'server/src/evaluations/service.ts',
  'server/src/evaluations/scoring.ts',
  'server/src/evaluations/evidence.ts',
  'server/src/checklists/profiles.ts',
];
function protocolHash() {
  return fingerprint(
    protocolFiles.map((path) => ({
      path,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    })),
  );
}
function configuredProviders() {
  assert(
    process.env.AI_PROVIDER === 'gemini',
    'This controlled comparison requires the configured Gemini model',
  );
  return Object.fromEntries(
    (['baseline', 'candidate'] as const).map((name) => {
      const p = providerFromEnv({
        ...process.env,
        AI_EVALUATION_POLICY: name === 'baseline' ? 'v4' : 'rubric-v7',
      });
      assert(p);
      return [name, p];
    }),
  ) as Record<VariantName, EvaluationProvider>;
}
function variants(providers: Record<VariantName, EvaluationProvider>): PairedVariant[] {
  return (['baseline', 'candidate'] as const).map((name) => ({
    name,
    protocolHash: protocolHash(),
    configuration: {
      configured: true,
      providerId: providers[name].id,
      modelId: providers[name].modelId,
      configurationId: providers[name].configurationId,
      promptVersion: providers[name].promptVersion!,
    },
  }));
}
const [command, directoryArg, caseArg, checklistArg] = process.argv.slice(2);
assert(
  ['freeze', 'run', 'resume', 'report'].includes(command),
  'Usage: paired-run.ts freeze|run|resume|report OUTPUT_DIR [CASES_JSON CHECKLIST_JSON]',
);
assert(directoryArg, 'Output directory required');
const directory = resolve(directoryArg);
const manifestPath = resolve(directory, 'frozen.json');
const providers = command === 'report' ? null : configuredProviders();
if (command === 'freeze') {
  assert(!existsSync(manifestPath), 'A frozen reference cannot be replaced');
  assert(caseArg && checklistArg, 'Cases and checklist files required');
  mkdirSync(directory, { recursive: true });
  const input = JSON.parse(readFileSync(checklistArg, 'utf8'));
  const parsed = ChecklistInputSchema.parse(input);
  const checklist: ChecklistVersion = {
    ...parsed,
    id: 'accuracy-recovery-v2',
    checklistId: 'accuracy-recovery',
    version: 2,
    createdAt: new Date().toISOString(),
  };
  const raw = JSON.parse(readFileSync(caseArg, 'utf8')) as (ReferenceCase & {
    channel: 'agent chat' | 'voice call';
    transcript: unknown[];
  })[];
  assert(raw.length >= 12);
  assert(
    ['RU', 'KZ', 'EN'].every((language) => raw.filter((c) => c.language === language).length >= 4),
  );
  const conversations: Conversation[] = raw.map((item) => {
    const record = SourceConversationSchema.parse({
      conversation_id: item.sourceId,
      channel: item.channel,
      language: item.language,
      transcript: item.transcript,
      audio_url: null,
    });
    const messages = record.transcript.map((m, i) => ({
      ...m,
      id: item.sourceId + '-m' + (i + 1),
    }));
    return {
      id: item.sourceId,
      sourceConversationId: item.sourceId,
      groupId: 'FRESH_SYNTHETIC_ACCURACY_NOT_PROD',
      channel: record.channel,
      language: record.language,
      messages,
      audioUrl: null,
      importedAt: new Date().toISOString(),
      transcriptHash: fingerprint({ language: record.language, channel: record.channel, messages }),
    };
  });
  const cases: FrozenCase[] = raw.map((item, i) => {
    assert.deepEqual(
      Object.keys(item.expectedValues).sort(),
      checklist.criteria.map((c) => c.id).sort(),
      'Every reference must cover the actual checklist',
    );
    const answers = checklist.criteria.map((c) => ({
      criterionId: c.id,
      value: item.expectedValues[c.id],
      explanation: 'Frozen local expectation. Never sent to inference.',
      evidenceMessageIds: [],
      checkedSpanMessageIds: [],
      naReason: item.expectedValues[c.id] === 'NA' ? 'Reference applicability' : null,
    }));
    return {
      sourceId: item.sourceId,
      language: item.language,
      role: item.role,
      notes: item.notes,
      expectedValues: item.expectedValues,
      expectedTotal: scoreEvaluation(checklist.criteria, answers).total ?? undefined,
      split: 'holdout',
      transcriptHash: conversations[i].transcriptHash,
    };
  });
  const reference: PairedReference = {
    schemaVersion: 1,
    frozenAt: new Date().toISOString(),
    labelSource:
      'Assistant-authored synthetic rubric expectations, NOT human-reviewed or organizer Ground Truth',
    humanReviewed: false,
    repeats: 2,
    maxCalls: 100,
    checklist,
    conversations,
    variants: variants(providers!),
    cases,
  };
  assertPairedInputs(reference, conversations, checklist, reference.variants);
  writeFileSync(manifestPath, JSON.stringify(reference, null, 2) + '\n');
  console.log(
    JSON.stringify({
      event: 'FROZEN',
      path: manifestPath,
      sha256: fingerprint(reference),
      frozenAt: reference.frozenAt,
      cases: cases.length,
      repeats: reference.repeats,
      maxCalls: reference.maxCalls,
      configurations: reference.variants,
    }),
  );
} else {
  const bytes = readFileSync(manifestPath);
  const reference = JSON.parse(bytes.toString()) as PairedReference;
  const referenceSha256 = createHash('sha256').update(bytes).digest('hex');
  if (command === 'report') {
    const progress = JSON.parse(readFileSync(resolve(directory, 'progress.json'), 'utf8'));
    assert(progress.referenceSha256 === referenceSha256);
    console.log(JSON.stringify(summarizePaired(reference, progress.rows), null, 2));
  } else {
    const previous =
      command === 'resume'
        ? JSON.parse(readFileSync(resolve(directory, 'progress.json'), 'utf8'))
        : null;
    assert(
      previous || !existsSync(resolve(directory, 'progress.json')),
      'Use resume for an incomplete frozen run; accidental reruns are disabled',
    );
    if (previous) {
      assert.equal(previous.referenceSha256, referenceSha256, 'Cannot resume a changed reference');
      assert(
        previous.rows.length < reference.cases.length * reference.repeats * 2,
        'This comparison is already complete',
      );
      assert(previous.calls < reference.maxCalls, 'Comparison call budget exhausted');
      assert(
        (previous.resumptions?.length ?? 0) < 2,
        'Resume limit reached; inspect provider availability',
      );
      writeFileSync(
        resolve(
          directory,
          `progress-before-resume-${(previous.resumptions?.length ?? 0) + 1}.json`,
        ),
        JSON.stringify(previous, null, 2) + '\n',
      );
    }
    assertPairedInputs(
      reference,
      reference.conversations,
      reference.checklist,
      variants(providers!),
    );
    const start = previous?.startedAt ?? new Date().toISOString();
    assert(Date.parse(start) >= Date.parse(reference.frozenAt));
    let calls = previous?.calls ?? 0,
      blocked = false;
    const rows: PairedResult[] = previous?.rows ?? [];
    const requests: unknown[] = previous?.requests ?? [];
    const resumptions = [
      ...(previous?.resumptions ?? []),
      ...(previous
        ? [{ at: new Date().toISOString(), previousCalls: calls, previousRows: rows.length }]
        : []),
    ];
    const interval = Number(process.env.QA_MIN_CALL_INTERVAL_MS ?? 0);
    assert(Number.isFinite(interval) && interval >= 0 && interval <= 60000);
    let lastCallAt = 0;
    const stores = {} as Record<VariantName, DatabaseSync>;
    const services = {} as Record<VariantName, EvaluationService>;
    for (const name of ['baseline', 'candidate'] as const) {
      const path = resolve(directory, name + '.sqlite');
      assert(
        previous ? existsSync(path) : !existsSync(path),
        'Database must match fresh/resume mode',
      );
      const db = createDatabase(path);
      stores[name] = db;
      if (!previous)
        db.prepare('INSERT INTO checklist_versions VALUES(?,?,?,?)').run(
          reference.checklist.id,
          reference.checklist.checklistId,
          reference.checklist.version,
          JSON.stringify(reference.checklist),
        );
      for (const c of reference.conversations) {
        if (previous) {
          const row = db.prepare('SELECT payload FROM conversations WHERE id=?').get(c.id);
          assert(
            row && fingerprint(JSON.parse(String(row.payload))) === fingerprint(c),
            'Stored transcript changed',
          );
          continue;
        }
        db.prepare('INSERT INTO conversations VALUES(?,?,?,?,?)').run(
          c.id,
          c.groupId,
          c.sourceConversationId,
          c.transcriptHash,
          JSON.stringify(c),
        );
      }
      const storedChecklist = db
        .prepare('SELECT payload FROM checklist_versions WHERE id=?')
        .get(reference.checklist.id);
      assert(
        storedChecklist &&
          fingerprint(JSON.parse(String(storedChecklist.payload))) ===
            fingerprint(reference.checklist),
        'Stored checklist changed',
      );
      const configured = providers![name];
      const wrapped: EvaluationProvider = {
        id: configured.id,
        modelId: configured.modelId,
        configurationId: configured.configurationId,
        outputFormat: configured.outputFormat,
        promptVersion: configured.promptVersion,
        async generate(input) {
          if (calls >= reference.maxCalls) throw new ProviderError('COMPARISON_CALL_LIMIT', false);
          const wait = Math.max(0, lastCallAt + interval - Date.now());
          if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
          lastCallAt = Date.now();
          calls++;
          requests.push({
            call: calls,
            variant: name,
            at: new Date().toISOString(),
            sourceId: input.conversation.sourceConversationId,
            transcriptHash: input.conversation.transcriptHash,
            checklistVersionId: input.checklist.id,
            promptVersion: configured.promptVersion,
          });
          console.log(
            JSON.stringify({
              event: 'call',
              number: calls,
              variant: name,
              source: input.conversation.sourceConversationId,
              repair: Boolean(input.repair),
            }),
          );
          return configured.generate(input);
        },
      };
      services[name] = new EvaluationService(db, wrapped, {
        ...evaluationOptionsFromEnv({
          ...process.env,
          AI_EVALUATION_POLICY: name === 'baseline' ? 'v4' : 'rubric-v7',
          AI_USE_PRECEDENTS: 'false',
          AI_VERIFIER_PROVIDER: 'none',
        }),
        concurrency: 1,
      });
      services[name].start();
    }
    const writeProgress = () =>
      writeFileSync(
        resolve(directory, 'progress.json'),
        JSON.stringify(
          { referenceSha256, startedAt: start, calls, rows, requests, resumptions },
          null,
          2,
        ) + '\n',
      );
    writeProgress();
    try {
      for (let repeat = 0; repeat < reference.repeats && !blocked; repeat++) {
        const cases = repeat % 2 ? [...reference.cases].reverse() : reference.cases;
        for (let i = 0; i < cases.length && !blocked; i++) {
          const item = cases[i];
          const conversation = reference.conversations.find(
            (c) => c.sourceConversationId === item.sourceId,
          )!;
          const order: VariantName[] =
            (i + repeat) % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
          for (const name of order) {
            if (blocked) break;
            if (
              rows.some(
                (row) =>
                  row.variant === name && row.repeat === repeat && row.sourceId === item.sourceId,
              )
            )
              continue;
            assertPairedInputs(
              reference,
              reference.conversations,
              reference.checklist,
              variants(providers!),
            );
            const service = services[name];
            const [id] = service.enqueue([conversation.id], reference.checklist.id, true);
            const began = Date.now();
            let e: Evaluation;
            for (;;) {
              e = service.get(id)!;
              if (['completed', 'failed'].includes(e.status)) break;
              assert(Date.now() - began < 540000, 'Evaluation exceeded outer deadline');
              await new Promise((r) => setTimeout(r, 100));
            }
            assert(
              predictionFollowsFreeze(reference, e),
              'Prediction preceded the reference freeze',
            );
            const reviewed = reviewEvaluation(e, conversation, reference.checklist, item);
            rows.push({
              variant: name,
              repeat,
              sourceId: item.sourceId,
              status: e.status === 'completed' ? 'completed' : 'failed',
              technicalErrors: reviewed.technicalErrors,
              semanticMismatches: reviewed.semanticMismatches,
              values: Object.fromEntries(e.originalAnswers.map((a) => [a.criterionId, a.value])),
              total: e.originalScore?.total ?? null,
            });
            writeFileSync(
              resolve(directory, `${name}-r${repeat}-${item.sourceId}.json`),
              JSON.stringify(e, null, 2) + '\n',
            );
            writeProgress();
            console.log(
              JSON.stringify({
                event: 'evaluated',
                variant: name,
                repeat,
                source: item.sourceId,
                status: e.status,
                mismatches: reviewed.semanticMismatches.length,
                technicalErrors: reviewed.technicalErrors.length,
                calls: e.attempts.length,
                error: e.error?.code,
              }),
            );
            if (
              e.status === 'failed' &&
              [
                'AUTH_FAILED',
                'BILLING_REQUIRED',
                'MODEL_UNAVAILABLE',
                'RATE_LIMIT',
                'COMPARISON_CALL_LIMIT',
                'PROVIDER_FAILED',
              ].includes(e.error!.code)
            )
              blocked = true;
          }
        }
      }
    } finally {
      for (const name of ['baseline', 'candidate'] as const) {
        await services[name].stop();
        stores[name].close();
      }
      writeProgress();
    }
    const summary = summarizePaired(reference, rows);
    const report = {
      kind: 'paired_synthetic_accuracy_comparison_not_organizer_ground_truth',
      referenceSha256,
      frozenAt: reference.frozenAt,
      startedAt: start,
      finishedAt: new Date().toISOString(),
      modelId: reference.variants[0].configuration.modelId,
      configurations: reference.variants,
      uniqueDialogs: reference.cases.length,
      repeats: reference.repeats,
      actualCalls: calls,
      maxCalls: reference.maxCalls,
      resumptions,
      ...summary,
    };
    writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(
      JSON.stringify({
        event: 'COMPLETE',
        actualCalls: calls,
        promotion: summary.promotion,
        metrics: Object.fromEntries(
          Object.entries(summary.variants).map(([name, x]) => [name, x.aggregate]),
        ),
      }),
    );
  }
}
