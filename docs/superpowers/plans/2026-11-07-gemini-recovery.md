# Gemini Recovery Implementation Plan

**Goal:** Handle explicit provider blocks, use an NA enum in the outgoing schema, send validation diagnostics to repair, and configure the request timeout from the environment.

**Spec:** User request on 2026-11-07; all four fixes and tests are authorized. Do not call a paid API.

**Architecture:** Keep the existing queue and official SDK. Add nullable attempt block metadata and a terminal MODEL_BLOCKED error. Pass repair metadata as JSON data. Parse AI_REQUEST_TIMEOUT_MS at startup and pass it to EvaluationService. Bump the prompt version because its schema/repair behavior changes.

**Constraints:** Preserve usage, existing bounded retries, scoring and evidence rules, historical records, and API error safety. Default timeout stays 90000 ms; supported environment values are integer milliseconds from 1 to 600000. All model traffic in tests uses an injected transport.

## Work

- [x] Write and run failing tests for blocked responses, schema enum, repair contents/isolation, repair after a timeout, and environment timeout validation/enforcement.
- [x] Implement the adapter, contracts, queue, prompt, startup config and documentation changes.
- [x] Run the full test suite, typecheck, build, formatting, and whitespace checks.
- [x] Independently review the changes and resolve material findings.

## Review focus

- A blocked response must keep usage and its reason without a JSON repair call.
- Block metadata must default to null for old records and normal attempts.
- Repair diagnostics must survive an intervening timeout and stay outside system instructions.
- No unsupported const is emitted for NA; local validation still rejects other strings.
- Startup must actually use the configured timeout and reject timer-overflow values.

## Verification

- All 21 new tests failed against baseline, then passed after the fixes.
- `npm test`: 118/118 tests passed in the six backend test files present at verification time. The parallel integration chat added `server/tests/web.test.ts` after that run; its work is outside this patch.
- Typecheck, build, format check and diff whitespace check passed.
- A separate startup check with AI disabled confirmed that the actual server entry point rejects AI_REQUEST_TIMEOUT_MS=0 before listening.
- Independent review found no actionable issues. No paid or live Gemini API call was made.
