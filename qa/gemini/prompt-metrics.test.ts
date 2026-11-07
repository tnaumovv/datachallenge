import { expect, it } from 'vitest';
import { summarizePerformance } from './prompt-metrics.js';

it('includes failed attempts, thinking costs and nearest-rank latency', () => {
  const result = summarizePerformance([
    { durationMs: 100, usage: { inputTokens: 1000, outputTokens: 100, thinkingTokens: 200 } },
    { durationMs: 900, usage: { inputTokens: 2000, outputTokens: 200, thinkingTokens: 100 } },
  ]);
  expect(result.inputTokens).toBe(3000);
  expect(result.estimatedUncachedUsd).toBeCloseTo(0.0024, 8);
  expect(result.p50Ms).toBe(100);
  expect(result.p95Ms).toBe(900);
});

it('does not turn missing usage into zero cost', () => {
  const result = summarizePerformance([{ durationMs: 50, usage: { inputTokens: null } }]);
  expect(result.estimatedUncachedUsd).toBeNull();
  expect(result.outputTokens).toBeNull();
  expect(summarizePerformance([]).p50Ms).toBeNull();
});

it('estimates billable output from total minus input when thinking is unreported', () => {
  const result = summarizePerformance([
    {
      durationMs: 1,
      usage: {
        inputTokens: 1000,
        outputTokens: 100,
        thinkingTokens: null,
        totalTokens: 1300,
      },
    },
  ]);
  expect(result.thinkingTokens).toBeNull();
  expect(result.estimatedUncachedUsd).toBeCloseTo(0.00105, 8);
});

it('rejects inconsistent total token counts for billing inference', () => {
  expect(
    summarizePerformance([
      {
        durationMs: 1,
        usage: {
          inputTokens: 1000,
          outputTokens: 100,
          totalTokens: 900,
        },
      },
    ]).estimatedUncachedUsd,
  ).toBeNull();
});

it('reports known cost separately when a failed API call has no usage', () => {
  const r = summarizePerformance([
    { durationMs: 10, usage: { inputTokens: 1000, outputTokens: 100, thinkingTokens: 0 } },
    { durationMs: 20, usage: {} },
  ]);
  expect(r.estimatedUncachedUsd).toBeNull();
  expect(r.knownUsageEstimatedUsd).toBeCloseTo(0.00055, 8);
  expect(r.unknownUsageRows).toBe(1);
});

it('does not allow another row to hide an inconsistent total', () => {
  const r = summarizePerformance([
    { durationMs: 1, usage: { inputTokens: 1000, outputTokens: 100, totalTokens: 900 } },
    { durationMs: 1, usage: { inputTokens: 1000, outputTokens: 100, totalTokens: 1500 } },
  ]);
  expect(r.unknownUsageRows).toBe(1);
  expect(r.estimatedUncachedUsd).toBeNull();
});

it('uses the selected provider tariff without double-counting reasoning', () => {
  const result = summarizePerformance(
    [
      {
        durationMs: 100,
        usage: {
          inputTokens: 1000000,
          outputTokens: 800000,
          thinkingTokens: 200000,
          totalTokens: 2000000,
        },
      },
    ],
    { inputPerMillion: 0.1, outputPerMillion: 0.5 },
  );
  expect(result.estimatedUncachedUsd).toBe(0.6);
});
