# RAG and operator coaching

User authorized adding RAG and concrete operator recommendations after discussing source-grounded evaluation. A separate chat owns AI accuracy fixes; keep this work isolated on codex/rag-coaching and make integration hooks small.

Use existing Node/SQLite/React stack. Add a knowledge page accepting plain text / UTF-8 TXT or Markdown with source, version, language, applicability dates and explicit activation. Never seed banking rules into production. A fictional example is available only as a disabled-for-evaluation document. Retrieval uses SQLite FTS5 lexical prefix search with BM25, bounded chunks and optional multilingual keywords. Embeddings can follow measured retrieval gaps; external vector infrastructure is unnecessary for this initial small corpus.

Freeze selected excerpts and source metadata at enqueue; include that snapshot in the cache key; pass it as untrusted factual context through provider prompt composition for all existing modes. Do not substitute document content for transcript events or rubric rules. Missing sources cannot justify a penalty or N/A. Dated rules require a known conversation date. Explanations cite [K1] identifiers; reject fabricated reference identifiers. Persist excerpts for historical reproducibility even after deactivation.

Show sources used as input beside results. Generate coaching from effective answers, criterion instructions and exact transcript quotes without another API request. Give criterion-specific steps for the unmodified standard semantics; use the user's instruction for custom criteria. Skip N/A and full marks. Recompute after appeals; failed/incomplete evaluations get no coaching. Label phrase examples as suggestions, never quotations.

Validation: knowledge API lifecycle, date/version boundaries, demo exclusion, prompt isolation, cache invalidation, immutable queued snapshots, provider integration, citation validation, coaching custom criteria and appeals, UI empty/error/save/source/coaching flows, full tests/typecheck/build/smoke and browser checks. Real improvement in semantic accuracy remains unmeasured until supplied official sources and independent labels exist.
