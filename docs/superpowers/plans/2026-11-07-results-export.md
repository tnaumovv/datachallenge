# Organizer Results Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

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

- [ ] Write a test-only complete dataset and a literal expected official result: 85.38 with N/A and all eight official IDs, complete source numbering, rationale, and no extra fields.
- [ ] Run `npm test -- server/tests/results-export.test.ts`; expected missing-export failure before implementation.
- [ ] Add formatter/snapshot reader tests for all five review conditions, aliases, legal values, critical flag, model aggregation, dataset counts/channels, and selected checklist isolation.
- [ ] Implement `format.ts` and `export.ts` with strict source consistency and read-only snapshot selection. Run the export tests; expected all passing.
- [ ] Add CLI subprocess tests for real read-only disk export, explicit arguments/group validation, missing database, incomplete sets, help, and destination preservation. Run them before implementing the CLI; expected missing-CLI failure.
- [ ] Implement CLI and package command, document exact flags and selection policy in README, with no submission example outside fixtures.
- [ ] Run `npm test`, `npm run typecheck`, `npx tsc -p qa/gemini/tsconfig.json`, `npm run format:check`, `npm run build`, `npm run smoke`, `git diff --check`; expected zero failures.
- [ ] Review the whole diff independently, fix material findings with failing regression tests, and commit only this feature. Report SHA and actual verification to the coordinating task.
