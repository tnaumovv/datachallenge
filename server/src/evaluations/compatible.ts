import { createHash } from 'node:crypto';
import { buildEvaluationPrompt } from './prompt.js';
import { buildModelJsonSchema } from './generation-schema.js';
import {
  ProviderError,
  type EvaluationProvider,
  type ProviderInput,
  type ProviderResult,
} from './provider.js';

export type CompatibleKind = 'groq' | 'ollama' | 'openai' | 'deepseek';
const ENDPOINTS = {
  groq: 'https://api.groq.com/openai/v1',
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
};
type Config = {
  kind: CompatibleKind;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  maxOutputTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
};
const tokens = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

export class CompatibleProvider implements EvaluationProvider {
  readonly id: CompatibleKind;
  readonly modelId: string;
  readonly configurationId: string;
  private readonly endpoint: string;
  private readonly maxOutputTokens: number;
  constructor(
    private readonly config: Config,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.id = config.kind;
    this.modelId = config.modelId.trim();
    if (!this.modelId || (config.kind !== 'ollama' && !config.apiKey?.trim()))
      throw new Error('Explicit model and provider credentials are required');
    this.maxOutputTokens = config.maxOutputTokens ?? 8192;
    if (
      !Number.isInteger(this.maxOutputTokens) ||
      this.maxOutputTokens < 1024 ||
      this.maxOutputTokens > 32768
    )
      throw new Error('Invalid output token limit');
    if (config.kind === 'ollama') {
      const url = new URL(config.baseUrl ?? 'http://127.0.0.1:11434/v1');
      if (
        url.protocol !== 'http:' ||
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !['/', '/v1', '/v1/'].includes(url.pathname) ||
        /(?:^|[-:])cloud(?:$|[/:])/i.test(this.modelId)
      )
        throw new Error('Ollama requires a local HTTP endpoint and local model');
      this.endpoint = url.origin + '/v1/chat/completions';
    } else {
      if (config.baseUrl) throw new Error('Cloud endpoints are fixed for each provider');
      this.endpoint = ENDPOINTS[config.kind] + '/chat/completions';
    }
    this.configurationId = createHash('sha256')
      .update(
        JSON.stringify({
          adapter: 'compatible-v3',
          provider: this.id,
          endpoint: this.endpoint,
          maxOutputTokens: this.maxOutputTokens,
          reasoningEffort: config.reasoningEffort ?? null,
        }),
      )
      .digest('hex');
  }

  async generate(input: ProviderInput): Promise<ProviderResult> {
    const prompt = buildEvaluationPrompt(input.conversation, input.checklist, input.repair);
    const schema = buildModelJsonSchema(input.conversation, input.checklist);
    const jsonMode = this.id === 'deepseek';
    const body = {
      model: this.modelId,
      messages: [
        {
          role: 'system',
          content: prompt.system + (jsonMode ? '\nJSON Schema: ' + JSON.stringify(schema) : ''),
        },
        { role: 'user', content: prompt.user },
      ],
      stream: false,
      response_format: jsonMode
        ? { type: 'json_object' }
        : { type: 'json_schema', json_schema: { name: 'cqa_evaluation', strict: true, schema } },
      ...(this.id === 'openai' || this.id === 'groq'
        ? { max_completion_tokens: this.maxOutputTokens }
        : { max_tokens: this.maxOutputTokens }),
      ...(this.id === 'deepseek' ? { thinking: { type: 'disabled' }, temperature: 0 } : {}),
      ...(this.id === 'ollama' ? { temperature: 0 } : {}),
      ...((this.id === 'openai' || this.id === 'groq') && this.config.reasoningEffort
        ? { reasoning_effort: this.config.reasoningEffort }
        : {}),
    };
    try {
      const response = await this.fetcher(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: input.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.id !== 'ollama' ? { Authorization: 'Bearer ' + this.config.apiKey } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const header = response.headers.get('retry-after');
        const delay =
          header === null
            ? NaN
            : /^\d+(?:\.\d+)?$/.test(header)
              ? Number(header) * 1000
              : Date.parse(header) - Date.now();
        const retryAfterMs = Number.isFinite(delay) ? Math.max(0, delay) : undefined;
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403)
          throw new ProviderError('AUTH_FAILED', false);
        if (response.status === 402) throw new ProviderError('BILLING_REQUIRED', false);
        if (response.status === 404) throw new ProviderError('MODEL_UNAVAILABLE', false);
        if (response.status === 400 || response.status === 422)
          throw new ProviderError('INVALID_PROVIDER_REQUEST', false);
        if (response.status === 429) throw new ProviderError('RATE_LIMIT', true, retryAfterMs);
        throw new ProviderError(
          'PROVIDER_FAILED',
          response.status === 408 || response.status >= 500,
          retryAfterMs,
        );
      }
      const data = await response.json();
      const choice = data?.choices?.[0];
      const usage = data?.usage;
      const totalOutput = tokens(usage?.completion_tokens);
      const thinking = tokens(
        usage?.completion_tokens_details?.reasoning_tokens ??
          usage?.completion_tokens_details?.reasoning_tokens_count,
      );
      const finish = typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined;
      return {
        text: typeof choice?.message?.content === 'string' ? choice.message.content : '',
        modelVersion: typeof data?.model === 'string' ? data.model : undefined,
        finishReason:
          finish === 'stop'
            ? 'STOP'
            : finish === 'length'
              ? 'MAX_TOKENS'
              : (finish?.toUpperCase() ?? 'MALFORMED_RESPONSE'),
        blockReason: choice?.message?.refusal
          ? 'REFUSAL'
          : finish === 'content_filter'
            ? 'CONTENT_FILTER'
            : undefined,
        usage: {
          inputTokens: tokens(usage?.prompt_tokens),
          outputTokens:
            totalOutput !== null && thinking !== null
              ? Math.max(0, totalOutput - thinking)
              : totalOutput,
          thinkingTokens: thinking,
          totalTokens: tokens(usage?.total_tokens),
        },
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (input.signal.aborted) throw new ProviderError('INTERRUPTED', false);
      // HTTP/SDK prose can contain credentials or customer text. Only fixed codes cross this boundary.
      throw new ProviderError('PROVIDER_FAILED', true);
    }
  }
}
