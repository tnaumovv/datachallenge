# Evaluation Attempt Diagnostics Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development for this scoped change.

**Goal:** Preserve the failure stage, provider finish reason, and field-level validation errors in each evaluation attempt.

**Architecture:** Add nullable diagnostic fields to attempts. Have the existing validators produce typed issues, and preserve them at the queue boundary before saving or retrying. Normalize older records on read without inventing historical diagnostics.

**Tech Stack:** Existing TypeScript, Zod 4, SQLite, Vitest, and Express; no new dependencies.

**Spec:** User request on 2026-11-07: add the failure stage, finishReason and exact validator error with its field path to attempts, and prove the next run can diagnose INVALID_MODEL_OUTPUT.

## Global Constraints

- Preserve scoring, validation acceptance rules, retry limits, timeout behavior, usage, and the existing HTTP error codes.
- Store `failureStage`, `finishReason`, and `validationErrors: { code, path, message }[]` per attempt; paths use string/number segments.
- Record successful finish reasons; leave failure stage null and validation errors empty for successful attempts.
- Provider failures have no validator issues. Do not persist arbitrary SDK exceptions or raw response excerpts from JSON parse errors.
- Historical absent fields read as null/empty; SQLite schema migration is unnecessary because attempts are in JSON payloads.
- Work in the current task checkout; leave existing output artifacts intact. No publication or live Gemini requests are required.

## Review Focus

- A later timeout must not erase the earlier invalid response's diagnostics.
- Answer ordering must not shift a reported field path to the wrong answer.
- Union schema errors must retain the alternatives, not only "Invalid input".
- Legacy records and recovery of interrupted attempts must remain readable.
- Typed answer errors must retain HTTP 400/INVALID_ANSWERS for manual scoring and appeals.

## Task 1: Capture and preserve diagnostics

**Files:** `shared/contracts.ts`, `server/src/evaluations/{validation,service,scoring,evidence}.ts`, `server/tests/evaluation-diagnostics.test.ts`, `server/tests/evaluation.test.ts`, `README.md`.

**Interfaces:** Attempts gain `failureStage`, `finishReason`, `validationErrors`. A typed answer-validation exception carries the same issue shape while extending the existing HttpError. The queue maps JSON and Zod failures to issues at their actual stage.

- [x] Add failing queue-level tests for finish reasons, JSON, schema, answer values/coverage, evidence, repair, timeout, persistence/API, and legacy reads.
- [x] Run the new suite and confirm diagnostics assertions fail against the baseline.
- [x] Add the attempt contract, typed validator issues, stage capture, and legacy read defaults; document the API fields.
- [x] Run the focused tests, then `npm test`, `npm run typecheck`, `npm run build`, and `npm run format:check`.
- [x] Review the diff and address material findings. Leave the reviewed local changes ready for the next run.

## Verification

- The initial 19 diagnostic tests failed on absent fields against the baseline and passed after implementation.
- Two additional regression checks cover parser locations and the manual-scoring HTTP contract; interrupted recovery also asserts the new fields.
- Full suite: 97/97 tests passed in five files. Typecheck, build, formatting, and diff whitespace checks passed.
- Independent read-only review found no actionable issues. Live Gemini behavior and deployment were outside this local change; no external model request was made.
