# Submission Readiness Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. This follows the user's explicit request to fix the audited issues, prepare real DEV results, verify and push.

**Goal:** Make the test command reproducible, align the demonstrated Gemini configuration, and publish all currently obtainable submission artifacts for team Paradox.

**Architecture:** Keep the existing application, persistent evaluation queue and read-only exporter. Scope test discovery to application directories. Preserve the standard eight-criterion checklist and all previous evaluations. Process DEV through the real API, with bounded calls and quota-aware stopping.

**Tech Stack:** TypeScript, Vitest, Express, SQLite, Gemini, existing export CLI.

**Spec:** The user's 2026-11-07 request and `README.md` submission JSON 1.0 rules; official student-guide results appendix.

## Global Constraints

- Team name is Paradox. DEV has exactly 60 chats and five calls; PROD requires the ten actual control chats when supplied.
- Preserve `.env` credentials, imported transcripts, database history and collaborators' commits; keep them out of Git.
- Use the existing free Gemini project; do not enable billing or silently switch providers/models.
- A saved model error is an error record. Missing predictions cannot be invented or replaced with reference answers.
- Export original model answers using one saved standard eight-criterion version, not the separate demonstration version.
- User authorized local configuration updates, real DEV evaluation and Git push. No additional design approval is needed for these audited fixes.

## Review Focus

- Temporary copied tests must not be discovered by `npm test`.
- Restarting from `.env` must select the same model/settings as the verified running server.
- A changed provider/configuration must stop a running batch instead of mixing accidental configurations.
- Resume must skip completed current evaluations and preserve failures/history.
- Export must validate all 65 original IDs, scores, evidence positions and actual model metadata before publication.

## Task 1: Reproducible test discovery and model setup

**Files:** `vitest.config.ts`, `package.json`, `.env.example`, `README.md`, `docs/AI_MODELS.md`; local ignored `.env`.

- [ ] Preserve the observed failing `npm test` evidence (364 pass, two temporary suites fail).
- [ ] Include only server/web/qa tests; add the root config to formatting checks.
- [ ] Set the documented Gemini profile to `gemini-3.5-flash-lite`, low thinking, 8192 output tokens, 120000 ms timeout. Keep `AI_PROVIDER=none` in the public empty-key template.
- [ ] Back up and update only model settings in the local `.env`; verify secrets remain byte-identical.
- [ ] Verify tests in both the isolated checkout and original checkout with ignored backup tests present, then typecheck/build/smoke.
- [ ] Commit the scoped changes.

## Task 2: Real DEV processing and artifact preparation

**Interfaces:** Existing `GET /api/ai/status`, conversation/checklist/evaluation endpoints, `POST /api/evaluations`, and `npm run export:results`.

- [ ] Back up SQLite consistently and record baseline counts, hashes and model configuration.
- [ ] Verify Free Tier and quota for the configured project; start with a real language sample, retaining all calls and errors.
- [ ] Evaluate all available DEV dialogs sequentially with a fixed configuration, bounded retries and periodic saved progress. Stop on exhausted quota/authentication/configuration change.
- [ ] Export `results/dev/results.json` with team Paradox when every DEV dialog has a terminal persisted evaluation. Validate round-trip correspondence with the source database.
- [ ] Publish a concise readiness record with measured counts and any actual remaining prerequisites; do not fabricate PROD.

## Task 3: Verify, review and publish

- [ ] Run the full suite, both typechecks, formatting, production build, smoke and diff checks.
- [ ] Review the complete change independently; fix confirmed defects and verify them.
- [ ] Fetch/reconcile without force, push main, confirm remote artifacts and green CI.
- [ ] Fast-forward the original checkout, restart its server with the aligned configuration, and verify persistence and current metadata.
