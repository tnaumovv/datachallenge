# Freedom CQA interface plan

> Execute inline with superpowers:executing-plans. The user supplied the direction and requested implementation without further questions.

**Goal:** Make the four existing working screens easier to read and navigate, with Freedom green and the supplied capsule-button reference.

**Architecture:** Keep the React/Vite app, native navigation, existing forms, API contracts and server scoring. Share an accessible native action button and SVG icon vocabulary; update the existing stylesheet rather than add another theme layer.

**Tech stack:** Existing React, TypeScript, CSS, native controls, Vitest and installed Playwright for rendered verification. No new dependencies.

**Spec:** User's 7 November message and attached green milestone board. It specifies capsule controls with a circular leading icon, concise Russian copy, clear navigation and readable text.

## Design decisions

- Audience: a quality reviewer finding a conversation, inspecting evidence, editing rules or reviewing an appeal.
- Domain: conversation, criterion, weight, quotation, saved assessment, appeal, checklist version.
- Color world: Freedom leaf green, dark forest, mint glass, white paper, graphite text; amber only for a pending appeal, red only for an error.
- Signature: rounded green controls with circular icons; the same shape connects navigation, assessment actions, imports and version saving.
- Avoid: decorative statistics, slogans, duplicate page explanations and tiny metadata. Keep original/effective answers, meaningful limits, errors and demo/preview boundaries.
- Typography: 14px body and controls, 12px metadata, 18px panel headings, 30px page headings, 44px score. Body line height at least 1.5.
- Controls: 44px main targets, fully rounded actions, 32px icon discs, restrained 16px input corners and 20px panels. Dark action with readable white text, green hover/focus.
- Navigation: three persistent labelled destinations; selected page has a distinct green capsule. Dialogue detail remains a separate deep link with an explicit return control.

## Constraints and review focus

- Only web/** changes; no server/shared/schema/scoring edits, dependency additions, push or main merge.
- Preserve all existing API/error/loading/draft/appeal behavior and immutable versions.
- Demo data stays explicitly labelled; a score preview stays explicitly unsaved.
- No document overflow at 390px or 320px; the wide table scrolls within its own container.
- Controls retain accessible text, keyboard focus and disabled/busy behavior. Long Russian/Kazakh/English text wraps without covering actions.

## Task 1: Shared visual controls and shell

**Files:** src/ActionButton.tsx, src/Icon.tsx, src/App.tsx, src/workspace.css.

- [x] Create native ActionButton with icon, variant, children and normal button attributes; icons are decorative.
- [x] Apply Freedom identity, concise shell and capsule navigation; remove repeated marketing copy.
- [x] Adjust typography, contrast, targets and responsive table containment in the existing stylesheet.

## Task 2: Four clear working screens

**Files:** src/DialogsPage.tsx, src/EvaluationPanel.tsx, src/Transcript.tsx, src/ChecklistEditor.tsx, src/AppealsPage.tsx, src/EvaluationAppeals.tsx, src/ImportDialog.tsx.

- [x] Reuse action controls for imports, evaluations, new versions and decisions.
- [x] Shorten redundant copy while retaining consequences, limits and original evidence.
- [x] Keep existing integration assertions aligned with the intentional new labels; add no snapshot or cosmetic unit tests.

## Task 3: Verify and show

- [x] Run existing frontend tests, typecheck, build and format checks.
- [x] Inspect all four screens at desktop and narrow widths; verify navigation, evidence focus, modal keyboard behavior and no page errors.
- [x] Review the diff for accidental behavior changes; commit the checked frontend and report the local preview.

## Verification — 7 November 2026

- Existing suite: 205/205 tests. App/web typecheck, production build, Prettier and diff whitespace checks passed.
- Real browser: 20 layouts, four screens at 320/390/768/1024/1512px; no document overflow or page errors.
- Verified selection through the 44px checkbox label; modal Escape restores opener focus; saved assessment makes no model request; evidence hash survives refresh; cancelling navigation retains a dirty draft; server score preview stays explicitly unsaved.
- Built UI at port 5180 uses an isolated real API and shows its empty state without sample fallback. Port 5174 is the explicitly labelled fictional-data demo. No paid model calls or shared database mutations.
- Independent source review found no P1/P2 regressions. Its small-text contrast observations were corrected in labels, preview text and status colors.
- User-facing screenshots and the browser QA report are stored outside source control in the task visualizations folder.
