# Organizer results export

The source of the submission contract is the three-page organizer attachment
`CQA_Student_Guide_Appendix_Results.pdf` (JSON format 1.0). Export persisted results
without starting a queue, loading `.env`, changing the database, or calling AI.

## Approach and scope

Use a read-only SQLite CLI and the existing scorer, with a separate formatter for
the official JSON contract. An HTTP export would depend on a running server and
its provider configuration; reading a live database snapshot works independently.
The coordinating task explicitly authorized implementation without further
questions. No frontend changes or actual submission datasets belong in this work.

## Decisions

- Require `--database`, `--group DEV|PROD`, `--output`, `--team-name`, and
  `--checklist-version`. `--source-group` optionally selects the actual API group
  name when it differs from DEV/PROD; it does not relax dataset validation.
- DEV is exactly 60 chats and 5 calls; PROD is exactly 10 chats. Reject duplicate
  source IDs, including multiple imported revisions: choosing a revision silently
  could submit results for the wrong transcript.
- For each conversation and explicitly selected checklist version, choose the
  evaluation with the greatest SQLite rowid (insertion order, matching existing
  history APIs). Do not fall back from a newer failure to an older success.
  Missing, queued, or running evaluations abort the export. Persisted failures
  become the specified error record with their existing reason.
- Use `originalAnswers` and `originalScore` only. Appeals intentionally remove AI
  evidence from human corrections, so silently exporting effective answers would
  misrepresent those corrections as evidence-backed AI output. Neither history
  nor appeal state is changed.
- Accept the eight official IDs and existing aliases: needs/discovery,
  identity/identification, closing/closure, gross/critical. Reject other or duplicate
  criteria and nonstandard weights, scales, N/A rules, and scoring modes.
- Map N/A to null; use the union of evidence and checked-span IDs, deduplicated and
  ordered by the full saved transcript. Require nonempty explanations, N/A reasons,
  and real evidence references. Verify the persisted total against the existing
  scorer and export the critical answer separately without zeroing the total.
- Derive model names from each attempted call's modelVersion, falling back to its
  persisted modelId if the provider returned no version. List distinct names in
  sorted order. Gemini is the only installed production adapter and maps to
  external_api; unknown provider IDs are rejected instead of guessing their mode.
  Records failed before any call contribute no model name; if no call was made
  anywhere in the set, fail rather than invent an actually used model.
- Validate everything before creating an output. Publish UTF-8 JSON atomically
  without overwriting an existing path. The caller must explicitly remove an old
  submission before regenerating it. Never create a missing source database.

## Verification

Use synthetic test-only datasets, literal expected JSON, history and real appeal
service integration, malformed persisted data, and subprocess CLI tests. Confirm
read-only export leaves stored payloads unchanged, then run the complete existing
suite, typecheck, format check, build, and smoke check. No external calls.
