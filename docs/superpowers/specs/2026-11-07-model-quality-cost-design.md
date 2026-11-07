# Reliable, low-cost CQA model selection

User request: improve dialogue evaluation toward >95% correctness and compare free/cheap models. The user confirmed that only existing labels are available and only free API calls are allowed. Existing labels are assistant calibration references, not independent expert Ground Truth. A percentage on those labels must never be presented as independently verified accuracy.

The current dirty checkout already contains evidence validation, Gemini recovery and benchmark work. Initial investigation extended the dirty `codex/cqa-backend` checkout. Final delivery is isolated on `codex/model-quality-cost` above the separately committed reliability baseline; preserve all existing source edits, `.env`, imported data and old evaluations. Do not commit unrelated pending work or change the working provider automatically.

Approaches considered: Gemini-only fixes are easiest but leave dependence on its small free quota; a common adapter for Groq/Ollama and inexpensive OpenAI-compatible services allows measured selection without replacing the application; local-only evaluation avoids API fees but this 8 GiB Mac has no Ollama and cannot comfortably run larger models. Engineering choice: strengthen the existing pipeline and add explicitly selected compatible providers. No paid requests, automatic model fallback, bulk download, deployment or changed reference labels.

Generation should constrain criterion IDs, scale values, applicability and message IDs using the actual checklist/transcript. Keep the public answers-array contract and all server validation. Give the model explicit temporal reasoning rules and prevent one criterion's penalty from contaminating another. This is necessary validation, not proof of semantic truth.

Use the existing EvaluationProvider interface for Groq (strict JSON schema), Ollama (local-only schema output), OpenAI and DeepSeek (documented JSON output). Fixed cloud endpoints, no redirects, no secret-bearing errors, usage and termination normalization, and endpoint/model/options-aware cache identity. No hidden SDK retries or automatic paid fallback. Gemini remains supported.

Benchmark reports should expose per-criterion and exact-dialog agreement, completion/coverage, language groups and a dialogue-level confidence interval. A quality gate must refuse a >95% claim for assistant labels, regression-only sets, partial checklists, incomplete runs, critical misses or insufficient statistical evidence. Freeze references before generation; do not feed labels to the model. Run free Gemini probes only within a small explicit total call budget, isolate their database and record failed attempts as cost/availability evidence.

Deliver a sourced Russian comparison with current official pricing, estimated cost for one stated token workload, actual local observations and clear separation of tested vs untested candidates. No model is assumed to achieve 95% merely from a public benchmark.
