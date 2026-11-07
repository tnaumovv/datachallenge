# CQA accuracy recovery

The user authorized fixing every finding in `output/hackathon-audit/report.txt` and improving N/A, greeting and scale decisions, followed by a fresh comparison. The report is in the original checkout; baseline is commit `7db60e1`. Preserve imported conversations, original evaluations, appeals, existing exports and secrets.

## Approach

The implementation choice is an evidence-first structured rubric on the existing Gemini model. Shortening instructions alone (earlier v5/v6 experiments) did not establish improvement. A multi-model ensemble adds unrequested provider dependencies and cost. Instead, the model supplies concise grounded observations, while code derives standard answers from the published rubric. No transcript-specific outcomes or reference labels enter inference. Nonstandard or edited criteria continue to use their actual saved definitions and scales.

Recognized original rules include the shipped legacy and current definitions, excluding weight changes from semantic identity. Modified instructions, scales, N/A rules or criterion semantics disable built-in mappings. Standard mappings:

- Contact: greeting in client language AND self-introduction; a name suffices; inspect first operator turn, never a bot greeting.
- Needs: sufficient information at operator start => N/A; otherwise clarification before substantive action => true, otherwise false. Asking a necessary question before client disconnect counts as clarification.
- Identity: protected request/action requires identification; otherwise N/A. Verification must precede the protected step.
- Consultation: no formulated substantive request => N/A; wrong key advice => 0; all major questions addressed => 20 (15 for a secondary omission); some major questions addressed => 10; vague guidance only => 5; otherwise 0. A concrete correct next step counts as addressed. Identification and wording defects are assessed separately.
- Empathy: polite AND (no expressed problem OR concrete response to it).
- Dialogue: unintelligible => 0; client must clarify wording/order => 4; one minor lapse => 7; otherwise 10. Asking an unanswered independent question is not a wording clarification.
- Closing: explicit interruption before opportunity => N/A; otherwise summary/offer AND farewell.
- Gross: any insult, private paid service offer or confidential disclosure => true; no automatic score zeroing.

Raw structured observations are strictly checked against the actual checklist, and converted to the existing `CriterionAnswer[]` contract. Existing structural, speaker, language, score and evidence validation stays enabled. Positive partial scores require operator evidence. Version/cache identifiers change. Legacy adapters used by integrations remain supported; existing optional facts-first review policy is preserved.

## Other fixes

- Keep desktop menu items at a stable vertical position when hover expands the menu.
- Render known organizer HTML recording pages as sandboxed embedded players, retain external playback, and use accurate fallback text. Do not introduce a server-side arbitrary URL proxy. Direct media URLs keep native audio controls.
- Overview defaults to the same explicitly active checklist profile as evaluation. Describe mismatched results as a different version, rather than falsely assuming an older version. Activation remains explicit; after the quality gate, align the working profile with the measured standard version using the normal API and a backup.

## Validation and promotion

Use existing audit examples only for development. Freeze fresh RU/KZ/EN examples and all expected answers before comparing baseline versus candidate with the same model, checklist, repeat count, rotating order and bounded calls. Keep failed/missing evaluations in scheduled denominators; report full-dialog matches, answer matches, score MAE, N/A errors, gross errors, latency and attempts. References are assistant-authored, not independent human or organizer Ground Truth. Do not tune on the final comparison after seeing predictions. A higher percentage on a different set is not improvement.

Promote only after the paired fresh comparison improves answer agreement and full-dialog agreement without losing completion or gross detection. If it fails, retain the previous working protocol, report the evidence, and continue diagnosis with a newly frozen final set after further development. Keep bounded experiments and no provider switch. Real control data and a PROD export cannot be fabricated.

Run focused RED/GREEN tests for derivation, strict parsing, dynamic criteria, provider integration and profile selection; run the full suite, both type checks, formatting, build and smoke. Verify menu, playback, changed criterion and appeal flows in the browser. Use a fresh whole-branch reviewer before integration. Local integration into the original checkout is part of delivering the authorized fixes; publishing/pushing is outside this request.
