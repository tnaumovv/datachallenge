# Prompt optimization experiment — 7 November 2026

The compact candidate reduces prompt text by 20.76%, but is **not enabled in the application**. Overall calibration agreement and median latency improved; Russian agreement, repair count and tail latency regressed. Production continues to use `cqa-evaluator-v4`.

| Metric | Baseline v4 | Compact candidate |
| --- | ---: | ---: |
| Evaluations | 22 | 22 |
| Matched available criterion labels | 132/156 (84.62%) | 136/156 (87.18%) |
| RU matched labels | 40/42 | 38/42 |
| KZ matched labels | 45/54 | 45/54 |
| EN matched labels | 47/60 | 53/60 |
| Fully labelled evaluations passing all labels/evidence/score checks | 3/14 | 6/14 |
| Evaluation latency p50 | 2.937 s | 2.698 s |
| Evaluation latency p95 (nearest rank) | 3.719 s | 5.614 s |
| Total evaluation time, including backoff | 80.930 s | 82.273 s |
| API calls, including retries | 23 | 26 |
| Invalid-output repair attempts | 0 | 3 |
| Rate-limit attempts | 1 | 1 |
| Known input tokens across all attempts | 73,068 | 65,288 |
| Known output tokens across all attempts | 24,168 | 21,205 |
| Standard-tariff estimate for known usage | $0.0823404 | $0.0725989 |

The known-usage estimate is 11.83% lower for compact; **full cost savings are not established**. One rate-limit attempt per variant returned no usage. This is an estimate at the project-recorded $0.30/M input and $2.50/M output including thinking, without cache discounts/free-tier credits, not an invoice or verified current bill. Missing usage is not zero. The SDK defines total tokens as prompt + candidates + tool inputs + thoughts. No tools are configured here, so total minus input supplies billable output when a separate thinking counter is absent; the raw thinking field remains null.

## Method and limitations

11 existing examples, 2 repetitions, 2 variants, alternating baseline/compact order and reversing it for the second repetition. Model `gemini-3.5-flash-lite`, thinking `low`, maximum output 8192, 120-second attempt timeout, concurrency 1. Full conversations, checklist rules, output schema, validators, scoring and production retry logic are shared. Transport substitution changes only the prompt; isolated SQLite stores all attempts. Working `.env` and database were not changed. Runtime prompt snapshots were byte-compared against a fresh dry run after freezing baseline; identical.

The labels predate this experiment but were prepared by an assistant, partly used for earlier tuning, and not independently human-reviewed. Four cases have partial labels. The 156 decisions per variant are 78 labels repeated twice, **not 156 independent samples**. “Fully labelled” uses only the seven cases with every checklist criterion. Agreement does not establish correct explanations beyond existing evidence checks. Both variants had zero observed gross false positives/negatives: the reference includes one positive and nine negative distinct cases (one case is unlabelled for gross). This small calibration experiment does not establish general accuracy or stable p95.

Compact had two missing-operator-evidence repairs and one non-null N/A-reason repair. Both variants hit one rate limit. No prompt was retuned during or after the experiment. Further work should clarify these instructions, then use a fresh evaluation sample; improving this same set alone would risk overfitting.

## Current runner commands (historical results above)

The commands below now compare v4 with the current v6 candidate, not the historical v4/v5 run above. Add `--include-v5` for a three-arm v4/v5/v6 comparison. To inspect the original experiment without new calls, use its saved raw run and `qa:prompt-report`.

The following commands accept local input paths; full conversations and reference labels are intentionally ignored by Git. The reference must match the source SQLite checklist/transcript hashes. Use the same frozen reference and database for both variants.

```sh
# Dry run: validates inputs and saves both prompts, no model calls.
npm run qa:prompt-ab -- --reference <frozen-reference.json> --database <source.sqlite>

# Real paired evaluation; reads the local API key without printing it.
node --env-file=.env --import tsx qa/gemini/prompt-ab.ts --run \
  --reference <frozen-reference.json> --database <source.sqlite> --repeats 2

# Recompute metrics from saved attempts; no API calls.
npm run qa:prompt-report -- runtime/prompt-ab/<run-id>
```

The run has a finite call cap (four attempts per evaluation), stops on terminal provider errors, and reports incomplete runs with a nonzero exit status. Validation failures remain in the dataset. Inspect `complete` in the derived report before comparing variants. A dry run creates an isolated runtime database but does not load an API key or call Gemini.

The checked-in aggregate is `qa/gemini/reports/2026-11-07-prompt-ab.json`; full run is `runtime/prompt-ab/1794068757826`. The frozen baseline is `qa/gemini/baseline-prompt-v4.ts`; the frozen v5 candidate is `qa/gemini/compact-prompt-v5.ts`. The current `compact-prompt.ts` contains the subsequent v6 experiment.

## Validation

371 tests passed across 26 files. Application and QA TypeScript checks, production build, repository formatting and production smoke passed. Independent review led to fixes for frozen baseline selection, incomplete-run status, partial-label naming and unknown-cost accounting. No additional API calls were made for verification.
