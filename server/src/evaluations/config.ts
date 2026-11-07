import type { PriceSnapshot } from '../../../shared/diagnostics.js';
import { z } from 'zod';
import { GeminiProvider } from './gemini.js';
import { CompatibleProvider } from './compatible.js';
import type { EvaluationProvider } from './provider.js';

export function evaluationOptionsFromEnv(env: Record<string, string | undefined>): {
  requestTimeoutMs: number;
  candidate: boolean;
  precedents: boolean;
  deadlineMs: number;
  verifier?: EvaluationProvider;
  priceSnapshot?: PriceSnapshot;
} {
  const settings = z
    .object({
      AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1).max(600_000).default(90_000),
    })
    .parse(env);
  if (env.AI_HARD_BUDGET_USD)
    throw new Error(
      'Hard monetary budget requires a supported upper-bound reservation; automatic calls disabled',
    );
  const policy = z
    .enum(['v4', 'facts-first-v1'])
    .default('v4')
    .parse(env.AI_EVALUATION_POLICY || undefined);
  const deadlineMs = z.coerce
    .number()
    .int()
    .min(1)
    .max(600000)
    .default(120000)
    .parse(env.AI_EVALUATION_DEADLINE_MS);
  const verifier =
    env.AI_VERIFIER_PROVIDER && env.AI_VERIFIER_PROVIDER !== 'none'
      ? providerFromEnv({
          ...env,
          AI_PROVIDER: env.AI_VERIFIER_PROVIDER,
          [env.AI_VERIFIER_PROVIDER.toUpperCase() + '_MODEL']: env.AI_VERIFIER_MODEL,
          AI_REASONING_EFFORT: env.AI_VERIFIER_REASONING_EFFORT,
        })
      : undefined;
  return {
    requestTimeoutMs: settings.AI_REQUEST_TIMEOUT_MS,
    candidate: policy === 'facts-first-v1',
    precedents:
      z
        .enum(['true', 'false'])
        .default('false')
        .parse(env.AI_USE_PRECEDENTS || undefined) === 'true',
    deadlineMs,
    verifier,
    priceSnapshot: priceFromEnv(env),
  };
}

export function providerFromEnv(
  env: Record<string, string | undefined>,
): EvaluationProvider | undefined {
  const kind = z
    .enum(['none', 'gemini', 'groq', 'ollama', 'openai', 'deepseek'])
    .default('none')
    .parse(env.AI_PROVIDER || undefined);
  if (kind === 'none') return undefined;
  if (kind !== 'gemini') {
    const prefix = kind.toUpperCase();
    const settings = z
      .object({
        modelId: z.string().trim().min(1),
        apiKey: kind === 'ollama' ? z.string().optional() : z.string().trim().min(1),
        maxOutputTokens: z.coerce.number().int().min(1024).max(32768).default(8192),
        reasoningEffort: (kind === 'openai'
          ? z.enum(['none', 'low', 'medium', 'high'])
          : z.enum(['low', 'medium', 'high'])
        ).optional(),
      })
      .parse({
        modelId: env[prefix + '_MODEL'],
        apiKey: env[prefix + '_API_KEY'],
        maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
        reasoningEffort: env.AI_REASONING_EFFORT || undefined,
      });
    return new CompatibleProvider({
      ...settings,
      kind,
      baseUrl: kind === 'ollama' ? env.OLLAMA_BASE_URL || undefined : undefined,
    });
  }
  const settings = z
    .object({
      GEMINI_API_KEY: z.string().trim().min(1),
      GEMINI_MODEL: z.string().trim().min(1),
      AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1024).max(32768).default(8192),
      GEMINI_THINKING_LEVEL: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
    })
    .parse({ ...env, GEMINI_THINKING_LEVEL: env.GEMINI_THINKING_LEVEL || undefined });
  return new GeminiProvider({
    apiKey: settings.GEMINI_API_KEY,
    modelId: settings.GEMINI_MODEL,
    maxOutputTokens: settings.AI_MAX_OUTPUT_TOKENS,
    thinkingLevel: settings.GEMINI_THINKING_LEVEL,
  });
}

export function priceFromEnv(env: Record<string, string | undefined>): PriceSnapshot | undefined {
  const values = [
    env.AI_INPUT_USD_PER_MILLION,
    env.AI_OUTPUT_USD_PER_MILLION,
    env.AI_THINKING_USD_PER_MILLION,
  ];
  const present = values.map((v) => (v !== undefined && v.trim() !== '' ? v : undefined));
  if (present.every((v) => v === undefined)) return undefined;
  if (present.some((v) => v === undefined))
    throw new Error('All three explicit tariff rates are required');
  const [inputPerMillion, outputPerMillion, thinkingPerMillion] = present.map((v) =>
    z.coerce.number().finite().min(0).parse(v),
  );
  return {
    currency: 'USD',
    capturedAt: new Date().toISOString(),
    inputPerMillion,
    outputPerMillion,
    thinkingPerMillion,
    outputIncludesThinking: false,
  };
}
