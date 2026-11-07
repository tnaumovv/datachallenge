# Reliable Gemini dialogue evaluation

The user authorized fixing the audit findings, configuring Gemini locally and measuring agreement on previously untested dialogues. Keep Express, SQLite, the existing provider adapter, checklist weights, scales, N/A rules and editable criteria.

Tighten the existing evidence boundary: positive built-in operator assessments need operator evidence (system confirmation is also valid for identity); negative and N/A decisions need checked spans; absence of gross violations must cover every operator turn. Reject obviously non-Russian explanations while allowing original foreign-language quotations. These checks establish necessary conditions, not full semantic truth.

Clarify the checklist rather than hardcode individual dialogue scores: distinguish a promised next step from an already performed escalation, require important missing details before substantive action, and accept an explicit review handoff as a consultation next step and closing summary. Preserve custom checklist versions; create a new local default version through the normal service.

Use the existing Gemini integration with a local key entered by the user. Support an optional validated thinking level and include it in the provider configuration hash, so cached predictions cannot cross settings. Use an explicit available model; do not silently switch models after a failure. Keep credentials out of reports and Git. Never substitute fictional output for a live result. Real selected evaluations may be saved through the local application API after a database backup; unit tests and smoke use isolated databases.

Freeze input hashes, the checklist and assistant-proposed expected values for nine previously untested DEV chats before generating any predictions. Keep known failures in a separate regression split. Report provider completion, criterion agreement, N/A/gross errors and score differences separately. Assistant reference labels are not independent human Ground Truth; related synthetic templates limit generalization claims. Do not change labels or tune prompts after seeing holdout predictions.

Approach: focused deterministic validation plus clearer model instructions. A second LLM judge adds calls without independent truth; dialogue-specific score overrides would hide errors. Neither is needed for this repair.
