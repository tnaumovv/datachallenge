import { z } from 'zod';
import { GeminiProvider } from './gemini.js';
import type { EvaluationProvider } from './provider.js';

export function evaluationOptionsFromEnv(env: Record<string, string | undefined>): {
  requestTimeoutMs: number;
} {
  const settings = z
    .object({
      AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1).max(600_000).default(90_000),
    })
    .parse(env);
  return { requestTimeoutMs: settings.AI_REQUEST_TIMEOUT_MS };
}

export function providerFromEnv(
  env: Record<string, string | undefined>,
): EvaluationProvider | undefined {
  const kind = z
    .enum(['none', 'gemini'])
    .default('none')
    .parse(env.AI_PROVIDER || undefined);
  if (kind === 'none') return undefined;
  const settings = z
    .object({
      GEMINI_API_KEY: z.string().trim().min(1),
      GEMINI_MODEL: z.string().trim().min(1),
      AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1024).max(32768).default(8192),
    })
    .parse(env);
  return new GeminiProvider({
    apiKey: settings.GEMINI_API_KEY,
    modelId: settings.GEMINI_MODEL,
    maxOutputTokens: settings.AI_MAX_OUTPUT_TOKENS,
  });
}
