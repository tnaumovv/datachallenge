import type { TokenUsage } from '../../shared/contracts.js';

/** Standard uncached tariff estimate, not an invoice; includes thinking and failed attempts. */
export function summarizePerformance(
  rows: { durationMs: number; usage: Partial<TokenUsage> }[],
  pricing = { inputPerMillion: 0.3, outputPerMillion: 2.5 },
) {
  const sum = (key: keyof TokenUsage) => {
    const values = rows.map((r) => r.usage[key]);
    return rows.length && values.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)
      ? (values as number[]).reduce((a, b) => a + b, 0)
      : null;
  };
  const inputTokens = sum('inputTokens');
  const outputTokens = sum('outputTokens');
  const thinkingTokens = sum('thinkingTokens');
  const totalTokens = sum('totalTokens');
  const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const costs = rows.map(({ usage: u }) => {
    if (!valid(u.inputTokens) || !valid(u.outputTokens)) return null;
    const output = valid(u.thinkingTokens)
      ? u.outputTokens + u.thinkingTokens
      : valid(u.totalTokens) && u.totalTokens >= u.inputTokens + u.outputTokens
        ? u.totalTokens - u.inputTokens
        : null;
    return output === null
      ? null
      : (u.inputTokens * pricing.inputPerMillion + output * pricing.outputPerMillion) / 1e6;
  });
  // This experiment has no tools. SDK total = prompt + candidates + thoughts.
  // Preserve raw unknown thoughts; infer only the aggregate billable output.
  const billableOutputTokens =
    outputTokens !== null && thinkingTokens !== null
      ? outputTokens + thinkingTokens
      : totalTokens !== null &&
          inputTokens !== null &&
          outputTokens !== null &&
          totalTokens >= inputTokens + outputTokens
        ? totalTokens - inputTokens
        : null;
  const durations = rows.map((r) => r.durationMs).sort((a, b) => a - b);
  const quantile = (p: number) =>
    durations.length ? durations[Math.ceil(p * durations.length) - 1] : null;
  return {
    inputTokens,
    outputTokens,
    thinkingTokens,
    totalTokens,
    billableOutputTokens,
    knownUsageEstimatedUsd: costs.reduce<number>((s, c) => s + (c ?? 0), 0),
    unknownUsageRows: costs.filter((c) => c === null).length,
    estimatedUncachedUsd:
      costs.length && costs.every((c) => c !== null)
        ? costs.reduce<number>((sum, c) => sum + (c ?? 0), 0)
        : null,
    p50Ms: quantile(0.5),
    p95Ms: quantile(0.95),
    totalDurationMs: durations.reduce((a, b) => a + b, 0),
  };
}
