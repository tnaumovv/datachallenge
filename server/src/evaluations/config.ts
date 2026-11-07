import { z } from 'zod';
import { GeminiProvider } from './gemini.js';
import { CompatibleProvider } from './compatible.js';
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
        reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
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
