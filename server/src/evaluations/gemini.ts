import { createHash } from 'node:crypto';
import { ApiError, GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { buildEvaluationPrompt, ModelOutputSchema } from './prompt.js';
import {
  ProviderError,
  type EvaluationProvider,
  type ProviderInput,
  type ProviderResult,
} from './provider.js';

const DEVELOPER_API_URL = 'https://generativelanguage.googleapis.com';
const CONTENT_FILTER_FINISH_REASONS = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
  'IMAGE_RECITATION',
]);

function retryInfoDelayMs(message: string): number | undefined {
  try {
    // The SDK stores the JSON error body in ApiError.message. Keep it local.
    const details = JSON.parse(message)?.error?.details;
    if (!Array.isArray(details)) return;
    let longest: number | undefined;
    for (const detail of details) {
      if (
        detail?.['@type'] !== 'type.googleapis.com/google.rpc.RetryInfo' ||
        typeof detail.retryDelay !== 'string'
      )
        continue;
      const duration = /^(\d+)(?:\.(\d{1,9}))?s$/.exec(detail.retryDelay);
      if (!duration) continue;
      const seconds = Number(duration[1]);
      if (seconds > 315_576_000_000) continue;
      // Round nanos up to milliseconds so a retry cannot precede the requested delay.
      const nanos = Number((duration[2] ?? '').padEnd(9, '0'));
      const delay = seconds * 1000 + Math.ceil(nanos / 1_000_000);
      longest = Math.max(longest ?? 0, delay);
    }
    return longest;
  } catch {
    // Optional, malformed metadata must not replace the original safe error.
    return undefined;
  }
}

export class GeminiProvider implements EvaluationProvider {
  readonly id = 'gemini';
  readonly modelId: string;
  readonly configurationId: string;
  private client: GoogleGenAI;
  private maxOutputTokens: number;
  constructor(
    config: { apiKey: string; modelId: string; maxOutputTokens?: number },
    private fetcher: typeof fetch = fetch,
  ) {
    this.modelId = config.modelId;
    this.maxOutputTokens = config.maxOutputTokens ?? 8192;
    this.configurationId = createHash('sha256')
      .update(
        JSON.stringify({
          adapter: 'gemini-v1',
          maxOutputTokens: this.maxOutputTokens,
          apiVersion: 'v1beta',
          baseUrl: DEVELOPER_API_URL,
          backend: 'developer-api',
        }),
      )
      .digest('hex');
    this.client = new GoogleGenAI({
      apiKey: config.apiKey,
      vertexai: false,
      httpOptions: {
        baseUrl: DEVELOPER_API_URL,
        apiVersion: 'v1beta',
        retryOptions: { attempts: 1 },
      },
    });
  }
  async generate(input: ProviderInput): Promise<ProviderResult> {
    const prompt = buildEvaluationPrompt(input.conversation, input.checklist, input.repair);
    const { $schema, ...schema } = z.toJSONSchema(ModelOutputSchema);
    let retryAfterMs: number | undefined;
    const trackedFetch: typeof fetch = async (url, init) => {
      const response = await this.fetcher(url, init);
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter !== null) {
        const seconds = Number(retryAfter);
        const delay = Number.isFinite(seconds)
          ? seconds * 1000
          : Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(delay)) retryAfterMs = Math.max(0, delay);
      }
      return response;
    };
    try {
      const response = await this.client.models.generateContent({
        model: this.modelId,
        contents: prompt.user,
        config: {
          systemInstruction: prompt.system,
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          maxOutputTokens: this.maxOutputTokens,
          abortSignal: input.signal,
          automaticContinuation: false,
          httpOptions: { fetch: trackedFetch, retryOptions: { attempts: 1 } },
        },
      });
      const usage = response.usageMetadata;
      const finishReason = response.candidates?.[0]?.finishReason;
      const promptBlockReason = response.promptFeedback?.blockReason;
      // A default enum alongside a real candidate does not indicate a block.
      const blockReason =
        promptBlockReason &&
        (promptBlockReason !== 'BLOCKED_REASON_UNSPECIFIED' || !response.candidates?.length)
          ? promptBlockReason
          : finishReason && CONTENT_FILTER_FINISH_REASONS.has(finishReason)
            ? finishReason
            : undefined;
      return {
        text: response.text ?? '',
        modelVersion: response.modelVersion,
        finishReason,
        blockReason,
        usage: {
          inputTokens: usage?.promptTokenCount ?? null,
          outputTokens: usage?.candidatesTokenCount ?? null,
          thinkingTokens: usage?.thoughtsTokenCount ?? null,
          totalTokens: usage?.totalTokenCount ?? null,
        },
      };
    } catch (error) {
      if (input.signal.aborted) throw new ProviderError('INTERRUPTED', false);
      if (error instanceof ApiError) {
        const bodyDelay = retryInfoDelayMs(error.message);
        if (bodyDelay !== undefined) retryAfterMs = Math.max(retryAfterMs ?? 0, bodyDelay);
        if (error.status === 401 || error.status === 403)
          throw new ProviderError('AUTH_FAILED', false);
        if (error.status === 404) throw new ProviderError('MODEL_UNAVAILABLE', false);
        if (error.status === 429) throw new ProviderError('RATE_LIMIT', true, retryAfterMs);
        throw new ProviderError(
          'PROVIDER_FAILED',
          error.status === 408 || error.status >= 500,
          retryAfterMs,
        );
      }
      throw new ProviderError('PROVIDER_FAILED', true);
    }
  }
}
