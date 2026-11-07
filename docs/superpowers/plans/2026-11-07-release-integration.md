# CQA Release Integration Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for integration. The existing frontend and backend chats own their scoped tasks; only the integration chat pushes main.

**Goal:** Complete the existing four-screen MVP, preserve concurrent work, and publish a tested, reproducible application to Git.

**Architecture:** Keep Express, SQLite, the existing evaluation queue, and shared contracts. React/Vite builds into `dist/web`; the same Express process serves the production UI and `/api`. Use isolated temporary databases for verification.

**Tech Stack:** Existing TypeScript, Express 5, Node.js 24, SQLite, Zod, Vitest; React/Vite for the already planned UI.

**Spec:** `docs/superpowers/plans/2026-11-07-cqa-24h.md`, the two official PDFs referenced there, and the user's 2026-11-07 instruction to finish autonomously, coordinate other project chats, push Git, and account for Merey's concurrent work.

## Global Constraints

- Preserve existing conversations, checklist versions, evaluation attempts, appeals, and untracked design artifacts.
- Fetch before integration/push; never force-push or reset another contributor's work.
- Frontend uses the actual API and server scores. A missing provider must remain an explicit failure to start AI evaluation.
- Release checks use isolated databases and `AI_PROVIDER=none`. Separate model tasks own their private credentials and bounded free probes. Do not invent live results or claim candidate labels are human-approved.
- Do not publish `.env`, source credentials, SQLite databases, transcripts, or local reference sets.
- Existing mocks are visual references; build the four working screens already specified.

## Review Focus

- Direct navigation/reload on a saved dialog must load the application shell.
- An unknown API route or missing asset must remain a real 404, never an HTML success.
- API-only development must still start before a frontend build exists.
- A production restart must retain imported data and checklist versions.
- Concurrent upstream commits must survive final integration and verification.

## Task 1: Preserve the completed diagnostics

**Files:** Existing diagnostics changes in `shared/contracts.ts`, `server/src/evaluations/`, their tests and README.

**Interfaces:** Keep `EvaluationAttempt.failureStage`, `finishReason`, `validationErrors` and legacy defaults.

- [x] Inspect the completed change and its previous review.
- [x] Run `npm test`, `npm run typecheck`, `npm run build`, `npm run format:check`, `git diff --check`: 97 tests and all commands pass.
- [x] Commit only diagnostic paths, fetch, rebase safely, and push: `301379c`.

## Task 2: Serve the production frontend

**Files:** Modify `server/src/app.ts`, `server/src/index.ts`; add `server/tests/web.test.ts`.

**Interfaces:** `createApp(db, { webRoot?: string, ...existingOptions })`. Startup provides the absolute `dist/web` directory. API routes retain their status/content type.

- [x] Write failing HTTP tests for `/`, `/dialogs`, `/dialogs/:id`, `/checklists`, `/appeals`, static JS, API 404, missing assets and absent builds.
- [x] Run `npm test -- server/tests/web.test.ts` and observe six missing shell/asset responses.
- [x] Serve only the dedicated build directory when `index.html` exists, with fallback for the specified app routes and no API fallback.
- [x] Run focused tests, the full suite, typecheck, build and formatting.
- [x] Commit the verified server integration: `340c7ec`, with startup wiring in `1158bcc`.

## Task 3: Integrate independent work and prove startup

**Files:** Frontend branch files; add `scripts/smoke.mjs`, `.github/workflows/ci.yml`; update README and ignore generated output.

**Interfaces:** `npm run build` produces `dist/server`, `dist/shared`, `dist/web`; `npm start` serves both API and UI. `node scripts/smoke.mjs` uses only a temporary SQLite DB and `AI_PROVIDER=none`.

- [x] Review the requirement and backend audits. Implement only confirmed blockers with a failing regression test first.
- [x] Fetch and inspect upstream changes, then merge the frontend's checked commit without overwriting Merey's work.
- [x] Smoke-test import, duplicate import, checklist versioning, manual scoring, missing-provider behavior, direct UI routes and persistence after restart against the actual built server.
- [x] Add CI for clean installation, tests, typecheck, build, formatting and production smoke.
- [x] Verify actual DEV import separately into a temporary DB without printing credentials or transcripts: 65 records, RU35/KZ15/EN15, 60 chats/5 calls, five audio links, repeat import 0/65, all four tables created.
- [x] Update README and a concise readiness record with commands, real evidence and outstanding external prerequisites.
- [x] Run browser QA for the four screens, then perform a fresh full verification and independent review.
- [ ] Fetch/reconcile, push without force, and confirm the final remote commit and CI result.

### Submission appendix follow-up

The later organizer appendix, “Как сдать результаты” (JSON 1.0), requires `results/dev/results.json` for 65 DEV records and `results/prod/results.json` for 10 control records. These are submission artifacts, not the internal API representation.

- [x] Integrate an isolated exporter with the eight official criterion IDs, `null` for N/A, one-based full-transcript evidence positions, actual model metadata and explicit error records.
- [x] Validate completeness, duplicates, allowed values and score arithmetic before writing a submission file; preserve original evaluations and appeal history.
- [x] Document the export/validate/commit/push sequence and reconcile the two AI tasks' scoped code with the measured results and limitations.
- [ ] Generate actual DEV/PROD artifacts from complete persisted evaluations when the control dataset and required free quota are available. Never label synthetic fixtures or assistant reference candidates as model predictions or independent human Ground Truth.

## Coordination and rulings

- The user explicitly opted out of questions while away and authorized Git pushes; routine implementation choices continue autonomously.
- The initial diagnostics used `codex/cqa-backend`; subsequent integration uses the isolated `codex/cqa-release` worktree. UI, model reliability, provider comparison and export have separate worktrees and scoped commits.
- Existing source data and design files are preserved. Generated `output/` files will be ignored rather than added to the public repository.
- Live model quality and unapproved reference decisions remain separate from passing local contract/integration checks.
- Merey's branches were discovered by repeated fetches and preserved with merge commits: Gemini QA `2755600`, review workspace/appeals `c1d8770`, checklist editor `2e50eaf`. Frontend integration continues from the snapshot `ab25a6a`.
- The backend chat completed the user's additional recovery request (`1158bcc`). Its RetryInfo regression fix (`5f154e5`) follows a confirmed long-quota-delay observation in Merey's report.
- Baseline after those integrations: clean `npm ci`, 185 tests, application/QA typechecks, production build, full source formatting, and compiled startup/restart smoke passed. This does not yet verify the frontend's unfinished route integration or live model quality.
- Later integration includes Merey's final editor/demo fixes, the four-screen snapshot `24c3780`, and the hidden-worktree serving regression fix `7c1fd1c`. The latter first reproduced HTTP500 and then passed with a root-relative `sendFile` call.
- Integration now runs on `codex/cqa-release` in its own managed worktree. The source checkout remains available to the active Gemini reliability task and its local data; the UI worktree owns the user's subsequent Freedom styling request.
- Freedom `783181a` was published through `a29bb06` with successful CI and runtime QA on four routes at five widths. Merey's shared model setup `f54204c` is preserved. Follow-up UI `54bd912` adapts conversation switching, answer states, original evidence selection, gross flags and tablet containment from his remote branch, preserving Freedom. Chrome QA covered 28 additional size/state combinations with no page errors or model POSTs.
- AI commits `a0a72a3` and `50d57f9` add evidence/language checks, provider identities, constrained JSON and a frozen benchmark. Independent review found two reporting defects: pre-freeze saved predictions and ignored semantic evidence/score failures. Both were reproduced by failing tests and fixed in `b2beea9`; the reviewer then confirmed the fixes. Values, full-dialog agreement and human Ground Truth remain distinct.
- Export `3184ba4` (including `5142858`) implements organizer JSON 1.0, read-only snapshots, explicit version/history selection, actual cloud/local model modes and exclusive atomic output. Its independent review found no outstanding issues. No real or fabricated submission files were committed.
- Final integrated source verification: **364 tests in 24 files**, app/QA typechecks, formatting, production build and startup/restart smoke passed. The real isolated demo HTTP flow passed default85.38, custom-criterion version, cache/force and appeal93.08 while preserving original answers/usage. No external model calls were made by release verification. Remaining external tasks are independent labels/quality, accessible audio, complete DEV processing and the unseen control set.
