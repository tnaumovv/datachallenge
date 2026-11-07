# Consistent Select Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Replace all 20 native selects with one accessible control matching the user's Origin UI reference.

**Architecture:** Add a `Select` presentation adapter under `web/src/components/ui` using Radix Select for interaction, focus, typeahead, positioning, and dismissal. Existing pages continue owning values, validation, async requests, and mutations. Use the current theme tokens and existing Lucide icons.

**Tech Stack:** React 19, TypeScript, Radix Select 2.4.1, CSS, Vitest and Testing Library.

**Spec:** User's reference: https://21st.dev/@originui/components/select/select-with-helper-text and instruction to replace every select.

## Global Constraints

- Keep all current values, disabled states, labels, validation relationships, and handlers.
- Preserve the diagnostic panes and their viewport height.
- Preserve unrelated uncommitted work, including knowledge and coaching features.
- No business mutations or paid provider calls during browser checks.
- Keep useful helper text already present; do not add repetitive instructions to every field.

## Capability Decision

- Capability: Single selection with long options, empty values, keyboard navigation, disabled options, and use within native modal dialogs.
- Existing owner: Native HTML selects, with page-local state and CSS. No shared custom select dependency or primitive exists.
- Candidates: Native select (https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/select), Radix Select (https://www.radix-ui.com/primitives/docs/components/select).
- Selected approach: external-dependency, comparative; Radix Select, the same primitive as the reference.
- Gap: Native browser menus cannot reproduce the reference's styled popup consistently. A project-owned popup would duplicate library focus and accessibility behavior.
- Lifetime rationale: One small adapter isolates library details and empty-value conversion for all current consumers.
- Obligations: The app owns styling, labels, option mapping, dialog portal placement, and regression coverage. Radix owns popup keyboard interaction and focus management.
- Validation: Focused component tests, existing frontend flows, typecheck/build, and desktop/mobile browser checks including a select in a native dialog.

## Review Focus

- Empty filter values remain selectable; unset required answers remain unset.
- Values `0`, `false`, and identifiers containing slashes remain distinct and unchanged.
- Menu content stays interactive above native modal dialogs and within small viewports.
- Escape closes the list and restores focus; arrow keys/typeahead work.
- Asynchronous option changes never silently submit or change a selected version.

### Task 1: Shared select adapter

- [x] Write and run failing tests for controlled values, empty selection, disabled options, focus, and dialog placement.
- [x] Implement `Select({ value, onValueChange, options, ...triggerProps })` in `web/src/components/ui/select.tsx`, plus themed CSS and optional helper text.
- [x] Verify the focused tests.

### Task 2: Migrate current consumers

- [x] Replace selects in DialogsPage, ReviewNavigation, EvaluationPanel, OverviewPage, OperationsPage, ImportDialog, ChecklistEditor, ChecklistProfiles, ReviewQueuePage, EvaluationAppeals, and KnowledgePage.
- [x] Update native-specific tests to use actual popup interactions and accessible state assertions.
- [x] Check no visible native selects remain and run frontend tests and typecheck.

### Task 3: Verify and review

- [x] Run the full test suite, build, formatting, and diff checks.
- [x] Check filtering, long options, keyboard dismissal, responsive layout, and native-dialog selection in the local browser.
- [x] Review only task-owned changes and resolve material findings.
