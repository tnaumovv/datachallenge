# Implementation plan

1. Add shared knowledge contracts, SQLite FTS service and routes. Tests first: metadata validation, immutable versions, date selection, demo and inactive exclusion, literal query safety and empty search.
2. Integrate optional knowledge snapshots at enqueue/cache, provider input and prompt composition. Validate citation IDs after parsing; preserve existing response schemas and empty-corpus behavior. Test with a recording provider and no external calls.
3. Add deterministic, evidence-linked operator coaching based on effective answers and standard-criterion fingerprints. Test NA/full marks/flags/custom semantics/appeal changes.
4. Compose existing fields, buttons, panels and navigation into knowledge management and result panels. Include loading, error/retry, empty and disabled example states. Verify rendered desktop/mobile flow.
5. Run focused/full tests, typecheck, formatting, build and smoke; review integration delta against concurrent accuracy branch without editing that worktree. Document usage and limitations, deliver local branch.

Review focus: temporal applicability when transcripts only contain relative times; no demo contamination; no stale cache after rule changes; no fabricated citations; no generic standard coaching on customized criteria.
