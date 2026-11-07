# Evidence and N/A experiment

User authorizes refinement and fresh-example validation plus analysis of Habr article 966546.

- Freeze old compact v5 and revised v6 before reading fresh examples.
- Explicitly require operator evidence for every positive number, including partial scores; checked spans cannot substitute. Require JSON null naReason for every non-NA value. Retain real N/A eligibility and custom criteria.
- Choose 12 DEV chats absent from previous paired experiment, 4 per language. Label all criteria from transcript/checklist before predictions. Assistant labels are not human-reviewed or independent ground truth.
- Run v4/v5/v6, 2 repeats, rotating/reversed order, same model/config and production validators/retries; isolated DB, finite 288-call maximum. Preserve raw usage and failures.
- Compare errors/repairs, agreement per language, cost and evaluation p50/p95. No unconditional promotion: require evidence of non-regression and operational benefit.
- Analyze transferable article recommendations; distinguish author claims from measured facts. No ASR changes, model switches or added per-dialogue LLM stages in this experiment.
- Run tests/typechecks/build/smoke and independent review. Publish aggregate findings, preserve raw transcripts locally.

Refinement: three ambiguous criterion labels excluded before predictions. The 72-evaluation three-arm run still showed missing evidence, so a separate 24-evaluation technical comparison tests identical v6 prompts with current vs conditional JSON schema on the same frozen set. This second stage is not a new holdout. Generation-schema constraints remain QA-only pending results.

Outcome: v6 retained as QA candidate only. Main run attempted all 72 evaluations, 94 calls; v6 had 2 terminal failures and increased evidence errors. Eight additional diagnostic calls explored conditional schemas; rejected forms were removed from runnable QA code and preserved only in ignored runtime. Independent reviewer confirmed frozen hashes/accounting. Historical runner docs clarify current v6 vs original v5 behavior.
