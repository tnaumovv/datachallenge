# Evidence/N/A refinement and fresh-example test — 7 November 2026

**Decision: retain production v4.** The v6 prompt makes evidence and N/A field rules explicit, but the fresh comparison did not establish fewer errors or faster processing. Neither v5 nor v6 is enabled in production.

## What changed

The frozen v5 candidate is preserved in `qa/gemini/compact-prompt-v5.ts`. The new `compact-prompt.ts` is v6:

- Every positive standard operator score, including partial numeric scores, requires an operator ID in `evidenceMessageIds`; `checkedSpanMessageIds` cannot substitute.
- Identity may use a system confirmation. Custom criteria retain the relevant speaker role.
- false/0 require a checked span for all criteria. NA additionally requires `allowNA` and the actual `naRule` condition.
- Every non-NA value requires JSON null `naReason`. Missing required action is false/0, not automatic NA.
- Standard gross=false requires every operator message in the checked span.

These rules match the existing validator; no validator was weakened to make a candidate pass. V6 request text is 128,073 characters across the 12 cases, compared with 149,037 for v4 and 118,041 for v5. V6 is 14.1% shorter than v4 but longer than v5.

## Main comparison

12 DEV conversations absent from the previous A/B, four each RU/KZ/EN. Two repetitions, three variants, rotating order and reversing it in the second repetition. Model `gemini-3.5-flash-lite`, thinking low, 8192 maximum output tokens, 120-second attempt timeout, concurrency one. Frozen labels, identical data/checklist, isolated database, unchanged service retry policy. 72 evaluations were attempted with 94 API calls; the terminal provider failure makes the runner's `complete` flag false even though every planned evaluation was attempted.

| Metric | Production v4 | Compact v5 | Revised compact v6 |
| --- | ---: | ---: | ---: |
| Completed evaluations | 24/24 | 24/24 | 22/24 |
| Available labels matched, failures included in denominator | 146/186 (78.49%) | 153/186 (82.26%) | 143/186 (76.88%) |
| RU matched labels | 52/64 | 53/64 | 52/64 |
| KZ matched labels | 52/64 | 57/64 | 52/64 |
| EN matched labels | 42/58 | 43/58 | 39/58 |
| Attempts rejected by validation | 1 | 3 | 5 |
| Missing operator evidence errors | 0 | 2 | 5 |
| Non-NA reason errors | 1 | 1 | 0 |
| First-attempt completions | 20/24 | 20/24 | 17/24 |
| Evaluation p50 | 3.639 s | 3.765 s | 4.112 s |
| Evaluation p95 | 114.523 s | 12.453 s | 12.725 s |
| Known-usage standard-tariff estimate | $0.09395 | $0.07825 | $0.08084 |
| Attempts with unknown billing usage | 4 | 3 | 8 |

V6's two terminal failures were one unrepaired evidence error and one provider failure. Provider timeouts, transient failures and rate limits confound the latency results, particularly v4 p95. Do not attribute the large p95 difference to the prompt. End-to-end times include retries/backoff; auxiliary single-attempt metrics are in the JSON report. The lower v6 count of missed NA decisions is conditional on successful evaluations and is not evidence of overall improvement.

Cost is an estimate for known usage at the project-recorded uncached tariff ($0.30/M input, $2.50/M output including thoughts), not an invoice or complete spend. Failed attempts with missing usage remain unknown. No claim of proven total savings is made.

## Label limitations

References were prepared by the assistant from transcripts and checklist before predictions. A separate agent reviewed them without seeing outputs. This is not independent human ground truth. The selected DEV records may share templates and had prior submission processing; “fresh” means absent from the preceding paired A/B, not never seen by the entire project.

Three ambiguous labels were excluded before calls: EN-002 closing (whether acknowledging login success is a summary), EN-014 consultation (10 versus 15), and EN-014 gross (whether the stated account restriction constitutes confidential disclosure). There are 93 labelled decisions repeated twice per variant, not 186 independent observations. No labels or v6 instructions were retuned after the main run. N/A coverage includes needs/identity, but not consultation=NA or closing=NA. Meaningful deployment confidence requires expert labels and broader cases.

## Conditional-schema exploration

After the text-only failure, an additional two-evaluation technical smoke test and six diagnostic calls explored conditional output constraints (8 additional API calls total). These are separate from the main 94 calls and reuse the same dataset; they are not another fresh accuracy test.

Flattened and nested full branch schemas passed four offline constraint tests but were rejected by the configured API with HTTP 400 `INVALID_ARGUMENT`. Three minimal probes confirmed boolean enum, boolean const and null-only fields individually work; this does not establish the cause of full-schema rejection. A smaller schema using sibling properties/anyOf was accepted by the API but failed local enforcement tests. It was abandoned rather than promoted on the basis of a single successful call.

All prototypes and diagnostics remain only in ignored `runtime/prompt-na-v6/`. The rejected schema option was removed from the runnable QA CLI. Production schema and validator are unchanged. Further schema work must first establish equivalent local/API enforcement before spending on another batch.

## Artifacts and reproduction

- Aggregate: `qa/gemini/reports/2026-11-07-prompt-v6-fresh.json`.
- Main raw run: `runtime/prompt-ab/1794069247943`.
- Frozen reference/source DB: `runtime/prompt-na-v6/frozen-reference.json`, `source.sqlite`.
- Article analysis: `docs/ARTICLE_966546.md`.

```sh
# Dry run; no API calls.
npm run qa:prompt-ab -- --include-v5 \
  --reference runtime/prompt-na-v6/frozen-reference.json \
  --database runtime/prompt-na-v6/source.sqlite

# Explicit new paid/quota-consuming three-arm run.
node --env-file=.env --import tsx qa/gemini/prompt-ab.ts --run --include-v5 \
  --reference runtime/prompt-na-v6/frozen-reference.json \
  --database runtime/prompt-na-v6/source.sqlite --repeats 2

# Recalculate existing results without model calls.
npm run qa:prompt-report -- runtime/prompt-ab/1794069247943
```

The next useful step is expert adjudication of applicability/closing examples and a provider-compatible conditional schema prototype. Another unmeasured prompt shortening is not justified by these results.
