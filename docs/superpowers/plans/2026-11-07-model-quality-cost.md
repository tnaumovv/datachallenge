# CQA model quality and cost implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Preserve the existing dirty checkout and execute inline.

**Goal:** Make CQA evaluation more constrained, compare compatible free/cheap providers and make unsupported accuracy claims impossible in the benchmark report.

**Architecture:** Retain EvaluationProvider, the evaluation queue and answers-array API. Add a checklist-specific generation schema and an HTTP compatible-provider adapter; extend offline benchmark reporting without exposing expected labels to inference.

**Tech Stack:** TypeScript, Node fetch, Zod, Express, SQLite, Vitest; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-07-model-quality-cost-design.md`

## Global constraints

- Only free live calls. Preserve `.env`, runtime database, previous edits and frozen labels.
- No automatic provider/model fallback; local Ollama must not use a cloud host or cloud-tagged model.
- Public evaluation JSON and edited/custom checklists remain compatible.
- Do not claim >95% independent correctness from assistant labels or unit tests.

## Review focus

- A custom criterion reuses a standard ID but has a different scale or applicability.
- A provider returns an error/refusal/truncated answer with chargeable usage.
- Endpoint redirects, API errors and cache keys must not expose credentials or mix providers.
- A perfect score on a tiny, partial or incomplete benchmark must not pass the quality gate.
- Provider availability and quota failures count in results, not only successful completions.

### Task 1: Constrain generation to actual inputs

Files: `server/src/evaluations/prompt.ts`, `gemini.ts`; `server/tests/gemini.test.ts`, new `generation-schema.test.ts`.
Interface: `buildModelJsonSchema(conversation: Conversation, checklist: ChecklistVersion): object` consumed by provider adapters.

- [x] Add failing tests for schema acceptance/rejection of actual criterion levels, custom IDs, allowed NA and transcript IDs.
- [x] Run `npx vitest run server/tests/generation-schema.test.ts server/tests/gemini.test.ts`, observe the intended failures.
- [x] Implement input-specific JSON schema and prompt guidance; use it in Gemini without removing independent server validation.
- [x] Run focused tests and `npm test`.

### Task 2: Add compatible model providers

Files: new `server/src/evaluations/compatible.ts`, `server/tests/compatible.test.ts`; `config.ts`, `.env.example`.
Interface: `CompatibleProvider implements EvaluationProvider`, settings for `groq`, `ollama`, `openai`, `deepseek`.

- [x] Add failing tests for structured requests, normalized finish/usage, refusal/truncation, safe retry codes and endpoint/config isolation.
- [x] Implement fixed HTTPS cloud endpoints, loopback-only Ollama, explicit model selection, abort/redirect control and safe error mapping.
- [x] Wire validated environment selection and document example settings without modifying `.env`.
- [x] Run focused tests, typecheck and the full suite.

### Task 3: Report evidence and compare candidates honestly

Files: `qa/gemini/benchmark.ts`, `benchmark.test.ts`, `benchmark-run.ts`; new `docs/AI_MODELS.md`; README.
Interface: `assessQualityTarget(reference: FrozenBenchmark, results: BenchmarkResult[])` returns a conservative claim gate and reasons.

- [x] Add failing tests for per-criterion/dialog metrics, confidence bounds, partial labels, unreviewed labels, critical misses and incomplete runs.
- [x] Implement metrics/gate and attach to the existing runner reports.
- [x] Inspect live availability; compare a few available free Gemini configurations within a total recorded call budget. Keep all calibration and holdout claims separate.
- [x] Write the sourced comparison and actual results, including unavailable credentials and billing limitations.
- [x] Run tests, both typechecks, formatter, build and smoke. Review the final diff; leave local changes reviewable without committing the user's pending work.

## Completion evidence

Implemented and reviewed on `codex/model-quality-cost`, based on reliability commit `a0a72a36d29d88ae5e20ec02101d8e43a85151dd`. The new managed worktree isolates this scoped delta from existing shared edits. All 274 tests, app/QA typechecks, formatting, build, smoke and diff checks passed. Eighteen Gemini calls were recorded in isolated databases; no more live calls are planned. All three review findings were fixed with failing-then-passing checks and verified by the reviewer. No independent >95% claim is supported. The final schema deduplication was verified offline only.
