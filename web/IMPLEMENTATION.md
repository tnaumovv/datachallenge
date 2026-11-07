# CQA frontend integration plan

> **For agentic workers:** Use superpowers:executing-plans. The user explicitly requested continuous execution without questions.

**Goal:** Deliver four working Russian screens on the existing API while preserving Merey's work.

**Architecture:** Extend the existing React/Vite application, native history routing, fetch client, evaluation polling hook, Transcript, EvaluationPanel and ChecklistEditor. The shared Zod contract and backend remain authoritative. No second cache/form/validation framework.

**Tech Stack:** Existing React 19, Vite 8, TypeScript, native HTML form/dialog/audio controls, shared Zod, Vitest. Add jsdom and Testing Library only for UI tests.

**Spec:** Delegation in chat 01a1b560-6a8c-7571-b935-e6060257e832 and accepted output/imagegen/cqa-v2-*.png in the original checkout. Those images guide visual roles, never production data.

## Global constraints

- Separate worktree codex/cqa-frontend from origin/main; no push or main merge.
- Write only web/**, package.json/package-lock.json and client Vite/TypeScript configuration. Do not alter server/**, shared/**, README or existing plans.
- Routes /dialogs, /dialogs/:id, /checklists, /appeals. API proxy defaults to http://127.0.0.1:3000. Build only dist/web without clearing dist/server.
- Real API only; synthetic data belongs to isolated tests. No evaluation runs on load and no manufactured completed result. Preserve 503 and all mutation failures.
- Reuse original/effective answers, original/final scores, citation messages and backend score calculation. Appeal preview calls POST /api/score.
- Keep original evidence separate from human decisions, N/A reason and discrete scale values, immutable checklist versions, required reviewer reasons, pending/resolved history.
- Existing source commits integrated once: 09754d9, e296b4e, 2e50eaf, fd69e73. Their README changes are intentionally excluded because documentation belongs to the integrating chat.
- QA is isolated from shared runtime data and cloud models; use existing browser control and non-secret test records.

## Review focus

1. API failure never becomes an empty successful state or fixture fallback.
2. Evidence deep links retain evaluation and conversation context after refresh/back.
3. A pending appeal's preview cannot appear as a saved final result; stale responses cannot overwrite newer choices.
4. Saving/refreshing checklist versions retains a dirty draft on failure and never changes an old version.
5. Narrow layouts, long transcript text and non-Russian content retain reachable controls and readable content.

### Task 1: Integrate shell, routes, conversations and API

**Files:** web/src/App.tsx, navigation.ts, DialogsPage.tsx, ImportDialog.tsx, api.ts, workspace.css; web/src/*.test.ts(x).
**Interfaces:** Reuse api.conversations/checklists/start/retry; add typed import, all-evaluations and appeal/version methods without changing shared contracts. Native routes are parsed by readLocation(url), constructed by reviewUrl(view).

- [ ] Write failing navigation/API tests for deep links, safe errors, import and status mapping; run them RED.
- [ ] Implement persistent labelled sidebar, list filters/search/selection, import and batch evaluation with genuine pending/error/empty states. Keep conversation detail as a separate route and reuse Transcript/EvaluationPanel.
- [ ] Run focused tests and typecheck GREEN.

### Task 2: Complete assessment and appeal workflows

**Files:** web/src/EvaluationPanel.tsx, use-evaluation.ts, AppealsPage.tsx, AppealDialog.tsx, appeal-model.ts and tests.
**Interfaces:** Selected evaluation + criterion creates AppealInput. POST decision returns updated Evaluation. Preview consumes effectiveAnswers with a single candidate replacement through POST /api/score; no local scoring formula.

- [ ] Write RED tests for criterion value decoding, N/A validation, stale preview suppression, failure mapping and submit state.
- [ ] Add per-criterion appeal entry, original/final distinction, saved history/retry/force actions, queue/filter/history and confirm/change with mandatory reason and preview.
- [ ] Run tests GREEN; verify original quotes remain labelled original after a human change.

### Task 3: Connect editor, production config and rendered QA

**Files:** web/src/ChecklistEditor.tsx/.css and model/tests, web/vite.config.ts, web/tsconfig.json, web/tests/**, package.json/package-lock.json.
**Interfaces:** Existing ChecklistEditor.onSaveVersion calls typed API and adds returned version to shared selectors. Existing isolated demo is retained as a test harness, never used as production fallback.

- [ ] Test immutable versions/draft failure retention; connect editor and complete selected-criterion outline with shared validation.
- [ ] Verify build targets dist/web; preserve existing API scripts and add explicit web/test scripts.
- [ ] Run full test/type/build/format checks. Exercise all four real HTTP workflows and 503/empty/error/recovery in an isolated API with browser screenshots, desktop and narrow width, keyboard and console checks.
- [ ] Obtain one fresh-context branch review, fix material findings, commit checked result and report exact integrated hashes plus backend integration needs. Do not push.

## Capability decisions

- Routing: extend existing native History API owner; three destinations plus existing dialogue deep link need no competing router.
- Requests/polling: extend existing typed fetch and abortable polling; no second data cache.
- Editor: reuse Merey's validated native-form editor and shared Zod model (19 existing tests); no new rich editor/form engine.
- Dialog/focus/audio: platform native dialog/audio with semantic labels; browser QA proves dismissal and focus restoration.
- Table: semantic native table and bounded client filters over actual API records; no virtualization or bespoke table engine.
- Validation/scoring: shared schemas + POST /api/score only. No formula duplication.

## Execution ledger

- Baseline origin/main 301379c: 97 tests passing.
- Merged checklist branch in 9986cd2 and review-demo branch in d3db16c; 116 tests and typecheck passing, README preserved.
- User file ownership excludes root .gitignore, which the optional FULL lifecycle helper requires changing. Keep QA artifacts in temporary storage and use direct browser/test evidence; do not claim helper-owned delivery acceptance.
