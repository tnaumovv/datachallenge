# Analysis Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair audited evaluation failures, enable local Gemini and evaluate previously untested dialogues honestly.

**Architecture:** Strengthen the existing evidence validation boundary and clarify versioned checklist instructions. Retain the Gemini adapter and add a bounded, frozen-reference evaluation runner using the existing API.

**Tech Stack:** TypeScript, Express, Zod, SQLite, Vitest, Gemini SDK.

**Spec:** `docs/superpowers/specs/2026-11-07-analysis-reliability-design.md`

## Global Constraints

- Preserve checklist weights, levels, N/A rules, custom criteria and previous versions.
- Never persist or print API keys, organizer URLs or raw SDK errors.
- Never report assistant annotations as human Ground Truth.
- Holdout labels and checklist are frozen before predictions; regression cases are separate.
- Work in the managed `codex/analysis-reliability` checkout after isolating concurrent provider edits. Preserve the original checkout, its README/DEMO changes and parallel provider work. No merge, push or unrelated changes are required.

## Review Focus

- Kazakh quotations and names must not cause Russian explanations to be rejected.
- System identity confirmation must remain valid evidence.
- Custom criteria can legitimately cite a client; built-in operator-role checks must not apply to unknown IDs.
- A missing key or exhausted quota must yield an explicit failure, never a fictional prediction.
- Partial or failed evaluations must not inflate agreement or count as correct predictions.

### Task 1: Grounded answer validation

**Files:** `server/src/evaluations/evidence.ts`, `server/src/evaluations/language.ts`, `server/tests/evidence-quality.test.ts`, existing provider fixtures in tests.

**Interfaces:** Preserve `validateEvidence(conversation, answers): CriterionEvidence[]`; errors remain `OutputValidationError` with field paths and feed the existing single repair attempt.

- [x] Write tests for client-only positive evidence, system identity, missing spans, incomplete gross coverage, inconsistent N/A reasons, explanation language and custom client criteria.
- [x] Run the new tests and observe the missing-validation failures.
- [x] Implement necessary role/span/language checks and update arithmetic/provider fixtures to satisfy the strengthened contract.
- [x] Run the complete test suite and typecheck.

### Task 2: Checklist and Gemini configuration

**Files:** `server/src/checklists/default.ts`, `server/src/evaluations/prompt.ts`, `qa/gemini/checklist.json`, `qa/gemini/cases.json`, local `.env` and SQLite checklist versions.

**Interfaces:** Preserve the provider/output contracts and scoring rules; bump the prompt version to invalidate stale evaluation caches.

- [x] Clarify temporal needs assessment and review/escalation closing using general rules.
- [x] Correct EN-006 local expectations to needs=false and total=85; keep it in regression/calibration.
- [x] Create a new local default checklist version without replacing earlier versions.
- [x] Configure the user-supplied key and an accessible explicit model; calibrate the selected thinking level with bounded requests. Include the thinking setting in the cache identity.

### Task 3: Frozen unseen-dialogue evaluation

**Files:** `qa/gemini/benchmark.ts`, `qa/gemini/benchmark.test.ts`, `qa/gemini/benchmark-run.ts`, ignored `runtime/ai-quality/` artifacts.

**Interfaces:** A reference bundle records source IDs, transcript/checklist hashes, split and expected values. The runner uses `/api/evaluations`, reads `originalAnswers` and `originalScore`, never passes reference values to the model, and bounds new calls.

- [x] Test exact comparisons, separate failure denominators, score error, N/A/gross counts and rejection of changed transcripts/checklists.
- [x] Freeze new DEV expectations before predictions. Reuse and independently validate the parallel experiment's frozen snapshots; labels match the earlier draft unchanged.
- [x] Run real regressions through the isolated API on port 3013 and a read-only backup. Reuse completed parallel new-dialogue experiments without additional model calls, preserving separate generation-schema configurations and incomplete coverage.
- [x] Run tests, typecheck, QA typecheck, formatting, production build and smoke; request fresh code review.
- [x] Report actual completion and reference agreement in `qa/gemini/reports/2026-11-07-reliability.json`, including the missing full nine-case final-profile run and lack of independent human labels.
