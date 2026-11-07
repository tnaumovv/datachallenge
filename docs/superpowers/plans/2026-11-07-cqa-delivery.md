# CQA delivery implementation plan

Goal: deliver the approved A–E workflow, keep v4 reproducible, compare GPT empirically.
Architecture: additive TypeScript modules, SQLite persistence, React UI; existing queue and scoring engine.
Tech stack: Node/Express/React/Zod/SQLite, Gemini and compatible OpenAI adapter.
Spec: docs/superpowers/specs/2026-11-07-cqa-unified-design.md

## Global constraints
- Independent implementation; product/docs contain no external application names. Preserve dependency licenses and Git history.
- Preserve dirty QA work. Existing codex/cqa-backend branch is the authorized implementation workspace.
- v4 remains default; candidate is explicit opt-in. Unknown usage is not zero. No hidden provider fallback.
- Preliminary outputs cannot enter completed evaluations or exports. Model originals immutable.
- No deployment/push. API keys never printed; benchmarks only synthetic DEV with bounded calls.

## Review focus
1. Unknown usage, cache reuse and retries must not undercount/double-count cost.
2. Old payloads, review-required exports and optimistic concurrency must remain safe.
3. Evidence/NA/unresolved distinctions must survive schema, scoring and UI boundaries.
4. Navigation, asynchronous errors and accessibility at narrow widths.
5. No holdout leakage or implicit model/profile activation.

### Task 1: diagnostics and evaluation comparison
Own shared/diagnostics.ts, server/src/usage/*, server/src/analytics/*, server/tests/diagnostics-api.test.ts. Add reusable installDiagnosticsRoutes(app,db,evaluations), no edits to app.ts/db.ts/service.ts until coordinated. Cost derives per-attempt with explicit optional price snapshot; unsupported price remains unknown. Compare only identical transcript hashes, expose answer/score differences, original and effective separately. Overview selects latest evaluation per conversation/version with explicit selection metadata, coverage including failures and review required. Cache receipts persistence initializer exported; root hooks enqueue. Include API integration tests, failed attempts, same transcript mismatch, duplicate reruns, unknown costs. Tests RED then GREEN; typecheck. Report exact hooks root must add.

### Task 2: facts-first policy and review
Own shared/evaluation-policy.ts, server/src/evaluations/facts.ts, candidate.ts, policy.ts, server/src/review/* and tests. Implement candidate observations + resolved/unresolved, exact criterion coverage, evidence validation. Four-call/deadline policy including one shared retry, one repair and configured independent verifier. Store runs separately; mandatory review as failed REVIEW_REQUIRED without final score. Shared transactional decision path for appeals/review with revision and idempotency, immutable originals. Root integrates existing service/providers and migrations. Test bounds, disagreement, unknown, gross, concurrent decisions and export safety.

### Task 3: profiles and moderated precedents
Own server/src/checklists/profiles.ts, server/src/precedents/*, shared/checklist-profiles.ts, tests. Add route installer/schema initializer. Seed explicit legacy profile; activation is separate and same family/channel checked. Diff and stale metadata; weight-only preview remains non-AI. Moderated precedents only from resolved human decisions; semantic fingerprint/channel/language match; exclude current transcript and declared holdout, max two. No automatic activation or learning. Tests invalid activation, stale, diff, eligibility and snapshot stability.

### Task 4: working UI
Own web files. Add overview/operations/review routes, comparison and diagnostics, evidence-linked loss reasons, message timeline without invented audio offsets, profiles/diff/activation and stale badges. Reuse current UI design and APIs, preserve deep links/back navigation. Human review must submit explicit evidence and expected revision; never accept unresolved silently. A11y keyboard/reduced-motion/responsive. Component tests and browser runtime QA at 360/768/1440.

### Task 5: GPT comparison and integration verification
Root owns adapter/configuration integration, DB migration registration, app route registration, queue integration, benchmark CLI. OpenAI strict schema smoke first; same frozen DEV labels and order balanced comparison, complete outcome denominator, latency p50/p95, usage unknown and priced estimates explicit. No promotion without evidence. Read official model/API docs. Meaningful adapter tests, typecheck/full tests/format/build/smoke; fresh whole-branch review and fixes.
