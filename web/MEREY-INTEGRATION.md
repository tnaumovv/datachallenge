# Merey review improvements — integration record

> Execute inline using superpowers:executing-plans; the user authorized continuing implementation and accounting for all branches. Preserve the approved Freedom direction.

**Goal:** Integrate missing review behavior from `origin/codex/emerald-ui-refinement` through `bdcb84e` without replacing Freedom styling. The implementation is based on main `8c39d32`; the parent's checked-span fixes in `web/tests/fixtures.ts` and `web/tests/demo.ts` are preserved.

**Architecture:** Keep the two-column assessment/transcript workspace, shared capsule ActionButton, native History API, existing evaluation hook and server scoring. Use a compact native conversation selector with previous/next controls. Add display-only answer semantics and evidence selection to the existing owners.

**Tech stack:** Existing React/TypeScript/CSS, Vitest, installed Playwright. No dependencies, external AI calls or production fixtures.

## Source decisions

| Source               | Integration                                                                                                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `196878f`            | Adapt conversation switching to a compact selector and previous/next controls. Clear the prior evaluation, appeal and message when changing conversations. Keep the title and existing two readable columns.                                 |
| `c27edc5`            | Port `answerTone` for partial, N/A, pending and violation states. Retain server points inside the expanded criterion; avoid two unexplained ratios in its summary. Keep the current score card, date and explicit force rerun.               |
| `2cd5ecc`            | Connect selected quote, criterion and transcript. Also cover original evidence after a manual correction and expand matching criteria on a restored deep link.                                                                               |
| `5d14d15`            | Display point contributions only for weighted criteria. Gross remains a flag.                                                                                                                                                                |
| `4bb2224`, `44164fd` | Current Freedom roles, 320–1512px layout and table scroll containment already cover the useful baseline. Add only containment required by the new toolbar/selection state; omit alternate palette, navigation shape and three-column sizing. |
| `bdcb84e`            | Adapt the tablet-height intent with a flex-based review page: the header and toolbar keep their natural height while the two panels fill the remaining viewport. Do not copy the alternate stylesheet's fixed minimum height.                |

## Constraints / review focus

- Change only web/**; no backend, shared contracts, scoring, demo provider, dependency or README edits. Parent integrates/pushes the checked commit.
- No model request from selection/navigation. Abortable history/polling and explicit rerun remain intact.
- Original and effective answers remain separate. Original evidence still navigates after human replacement clears effective evidence pointers.
- Preserve appeals, dirty editor guards, dates, import focus restoration, demo/preview boundaries and Freedom capsule controls.
- Navigation must reset stale review context, support native keyboard selection, and disable previous/next at boundaries. Long multilingual titles must fit 320px.

## Work

- [x] Add failing regression tests for conversation switching, selected/original evidence, gross flags, and answer-state semantics.
- [x] Implement compact ReviewNavigation and adapt the selected source changes in App, EvaluationPanel, Transcript, Icon and review-format.
- [x] Add scoped styles using existing Freedom tokens; keep text/controls readable.
- [x] Run scoped frontend tests, typechecks and production build; verify actual browser states and mobile scroll containment.
- [x] Review the diff. The parent chat owns integration and push.

## Verification — 2026-11-07

- Regression tests were observed failing before implementation and passing afterward. All 62 frontend tests passed; after updating the baseline to main `8c39d32`, the full suite passed: **298 tests in 22 files**.
- Application/web typechecks, production build, formatting and `git diff --check` passed.
- Read-only review found no new P1/P2 issues in navigation, answer semantics, preserved original evidence or control accessibility.
- Installed Playwright with local Chrome exercised the rendered demo with synthetic API fixtures. The visible demo label remained present; the run issued **zero POST requests** and recorded **zero page errors**. No shared database or external AI service was used.
- **28 layout combinations** covered partial, revised, gross-violation and all-N/A evaluations at 1512×982, 1280×720, 1024×768, 1024×600, 768×1024, 390×844 and 320×700. Checks confirmed no document-width overflow, usable controls, scrollable long transcripts and desktop/tablet panel containment where height permits.
- Browser flows also covered running, failed and unassessed evaluations; quote-to-message focus; next/previous selection; browser Back; restored deep links; and original evidence after a human correction. Gross flags show no point ratio; all-N/A evaluations do not show a fabricated zero score.
- Desktop and mobile screenshots were visually inspected. Local artifacts: `/Users/timurabishev/.codex/visualizations/2026/11/07/01a1b541-6718-7ee1-8c01-b1161603ade9/freedom-cqa/merey-integration/`.
