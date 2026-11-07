# Organizer Results Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Export complete persisted DEV/PROD evaluations in the organizer's exact JSON 1.0 contract.

**Architecture:** A formatter validates and maps original evaluations; a snapshot reader selects history from SQLite; a CLI opens the database read-only and publishes validated JSON without clobbering files.

**Tech Stack:** Existing TypeScript, Node SQLite, Zod, Vitest, tsx; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-07-results-export-design.md`

## Global Constraints

- Work only in `codex/results-export` from `a29bb060`; no changes to the original checkout, its `.env` or runtime, or any web files.
- No external API or model calls; no real results or fabricated submission files committed.
- DEV exactly 60 chats + 5 calls; PROD exactly 10 chats. All source IDs and all eight standard criteria must be unique and complete.
- Explicit checklist selection; latest inserted evaluation; immutable original AI answers and score; terminal failures preserved.

## Review Focus

- Multiple revisions of the same source ID must fail instead of silently choosing a transcript.
- A newer failure or unfinished task must never silently reuse an older success.
- Human appeal edits must not contaminate the machine submission or mutate its original.
- Unknown model/provider metadata must fail instead of producing a guessed production mode.
- Failed validation or an existing destination must leave existing files and database contents unchanged.

---

### Task 1: Persisted-results export and CLI

**Files:**

- Create: `server/src/results/format.ts`, `server/src/results/export.ts`, `server/src/results/cli.ts`
- Create: `server/tests/fixtures/results.ts`, `server/tests/results-export.test.ts`, `server/tests/results-cli.test.ts`
- Modify: `package.json`, `README.md`

**Interfaces:**

- Consumes: existing `Conversation`, `Evaluation`, `ChecklistVersion`, SQLite payloads and `scoreEvaluation`.
- Produces: `exportResults(db: DatabaseSync, options: ExportOptions): ResultsDocument`, and `npm run export:results -- --database ... --group DEV|PROD --output ... --team-name ... --checklist-version ... [--source-group ...]`.

- [x] Write a test-only complete dataset and a literal expected official result: 85.38 with N/A and all eight official IDs, complete source numbering, rationale, and no extra fields.
- [x] Run `npm test -- server/tests/results-export.test.ts`; expected missing-export failure before implementation.
- [x] Add formatter/snapshot reader tests for all five review conditions, aliases, legal values, critical flag, model aggregation, dataset counts/channels, and selected checklist isolation.
- [x] Implement `format.ts` and `export.ts` with strict source consistency and read-only snapshot selection. Run the export tests; expected all passing.
- [x] Add CLI subprocess tests for real read-only disk export, explicit arguments/group validation, missing database, incomplete sets, help, and destination preservation. Run them before implementing the CLI; expected missing-CLI failure.
- [x] Implement CLI and package command, document exact flags and selection policy in README, with no submission example outside fixtures.
- [x] Run `npm test`, `npm run typecheck`, `npx tsc -p qa/gemini/tsconfig.json`, `npm run format:check`, `npm run build`, `npm run smoke`, `git diff --check`; expected zero failures.
- [x] Review the whole diff independently, fix material findings with failing regression tests, and commit only this feature. Report SHA and actual verification to the coordinating task.

### Task 2: Compatible production provider modes

**Files:**

- Modify: `server/src/results/export.ts`, `server/tests/results-export.test.ts`, `README.md`

**Interfaces:**

- Consumes: existing persisted `Evaluation.providerId`, `attempts`, and unchanged export API.
- Produces: correct `model.mode` for explicitly supported gemini/groq/openai/deepseek/ollama records.

The coordinator added real CompatibleProvider adapters while Task 1 was being reviewed. Its implementation at release commit `8c39d32` fixes cloud URLs and restricts Ollama to loopback HTTP and local models. Support exactly those production IDs without importing adapters or changing the branch base.

- [x] Add tests: groq/openai/deepseek remain `external_api`; an Ollama-only set is `local`; actual local+cloud calls are `hybrid`; a local error before any call does not claim `hybrid`; demo/test/unknown IDs remain rejected.
- [x] Run the exporter tests; expect 6 failures on the previous Gemini-only gate.
- [x] Add an explicit provider-mode allowlist; collect modes only for actually attempted calls, and update README/spec to match.
- [x] Run full tests on Node 24, typechecks, formatting, build, smoke, and diff checks; expect all passing. Review only this small delta with the existing reviewer and commit the compatibility change before handoff.
