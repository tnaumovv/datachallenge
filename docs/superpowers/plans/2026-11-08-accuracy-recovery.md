# CQA Accuracy Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fix the audit findings and measure an actual paired improvement on frozen fresh dialogues.

**Architecture:** Keep Node/Express/SQLite/React and the configured Gemini model. Introduce an evidence-first observation protocol with server-derived standard rubric values and a dynamic fallback for custom criteria. Preserve public answers, scoring, review and export contracts.

**Tech Stack:** TypeScript, Zod, Vitest, React, existing Gemini SDK, CUA browser.

**Spec:** `docs/superpowers/specs/2026-11-08-accuracy-recovery-design.md`

## Global Constraints

- Preserve imported conversations, original evaluations, appeals, existing exports and secrets.
- Do not pass reference labels to inference or tune on the final comparison after predictions.
- Preserve custom instructions, scales and N/A definitions; mappings apply only to recognized standard semantics.
- Keep the existing model and bounded calls; no provider switch or public push.
- Real control data and a PROD export cannot be fabricated.

## Review Focus

- Changed built-in IDs and numeric scales must bypass standard derivation, even with familiar titles.
- No operator turns, bot introductions, names in source languages, and later greetings cannot become positive first-contact evidence.
- Partial positive scales need operator evidence; absent/NA decisions still need a checked span.
- HTML player handling must not create an arbitrary backend URL fetcher or execute unsafe links.
- Frozen comparison must bind inputs, prompts, model/configuration and all scheduled outcomes, including failures.

### Task 1: Fix menu, player and profile consistency

**Files:** `web/src/components/ui/sidebar.css`, `web/src/Transcript.tsx`, `web/src/Transcript.test.tsx`, `web/src/OverviewPage.tsx`, profile-selection UI tests, version-warning copy.

**Interfaces:** consumes existing Conversation.audioUrl and useProfiles; produces the same component props and explicitly active overview default.

- [x] Add failing tests: organizer player URL renders an iframe without a bogus native audio element; direct media still renders audio; fallback retains an external link; overview uses the active v1 rather than the newest v2, and does not silently choose a draft on profile-load failure.
- [x] Run focused tests and confirm failures reproduce missing behavior. The baseline browser menu failure is already recorded against unchanged commit 7db60e1; verify stable geometry and correct routes after CSS fix.
- [x] Implement stable desktop header height, sandboxed known organizer player rendering, accurate fallback/reset behavior, active-profile overview selection, and truthful version-warning labels.
- [x] Run focused tests, full suite, and rendered menu/player checks.
- [x] Commit this independently testable UI fix.

### Task 2: Evidence-first rubric protocol

**Files:** create `server/src/evaluations/rubric.ts` and `server/tests/rubric.test.ts`; modify prompt, generation schema, provider capability, Gemini/compatible adapters and evaluation service; corresponding provider/lifecycle tests.

**Interfaces:** `buildRubricJsonSchema(conversation, checklist)`, `parseRubricOutput(raw, conversation, checklist): CriterionAnswer[]`; `EvaluationProvider.outputFormat?: 'rubric-v7'` selects parsing, absent means the existing answers contract. `buildEvaluationPrompt` supplies untrusted transcript and actual checklist, no reference labels. Existing facts-first candidate policy remains separate.

- [x] Add failing table-driven tests for every mapping, needs=N/A, first-turn introduction, all numeric scale steps, temporal identification, gross, interruption and custom criteria. Strictly reject duplicate/missing criteria, invented IDs and incompatible facts.
- [x] Add failing lifecycle test proving a provider's structured facts become validated public answers and evidence, with repair on invalid output. Require nonempty operator evidence in generated schemas whenever available, including partial grades.
- [x] Implement rubric schemas/parsing, concise facts-first instructions and new cache/prompt identifiers; retain every current validator and the custom-criterion escape based on semantic fingerprint.
- [x] Run focused RED/GREEN checks and the full suite. Perform one small live compatibility check before a batch; use old audit cases for development only.
- [x] Commit the proven protocol and regression tests.

### Task 3: Freeze fresh cases, paired comparison and delivery

**Files:** QA paired runner/tests and aggregate report/docs; ignored runtime contains full synthetic references, responses and temporary databases.

**Interfaces:** consumes frozen cases, baseline checkout and candidate checkout; produces complete per-variant counts, input/config hashes and promotion decision. No expected values are supplied to either provider.

- [x] Add failing checks that failed/unrun cases stay in the denominator, predictions follow freeze, and input/configuration changes invalidate a comparison.
- [x] Implement/reuse bounded paired runner; freeze 12 or more balanced fresh cases before predictions; rotate order and run two repeats if budget permits.
- [x] Compare old/new on identical data; no post-hoc relabeling. Promote only with better answer/full-dialog agreement, preserved completion and no gross regression.
- [ ] Run final suite, application/QA type checks, formatting, production build and smoke; check rendered edited criterion, evidence, recording and appeal flows.
- [ ] Obtain a fresh whole-branch review, resolve material findings with RED/GREEN, and integrate verified commits into the original checkout while preserving runtime state and historical results.
- [ ] Restart the local application on the verified build and align the explicitly active standard checklist after a backup. Publish no fabricated PROD data and do not push remotely.
