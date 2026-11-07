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
    const prompt = buildEvaluationPrompt(
      input.conversation,
      input.checklist,
      input.repairInstruction,
    );
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
      return {
        text: response.text ?? '',
        modelVersion: response.modelVersion,
        finishReason: response.candidates?.[0]?.finishReason,
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
