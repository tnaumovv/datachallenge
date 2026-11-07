import { describe, expect, it } from 'vitest';
import type { ChecklistVersion, Conversation } from '../../shared/contracts.js';
import { defaultChecklist } from '../src/checklists/default.js';
import { CompatibleProvider } from '../src/evaluations/compatible.js';
import { providerFromEnv } from '../src/evaluations/config.js';

const conversation: Conversation = {
  id: 'c',
  sourceConversationId: 'source',
  groupId: 'DEV',
  transcriptHash: 'hash',
  language: 'RU',
  channel: 'agent chat',
  audioUrl: null,
  importedAt: 'now',
  messages: [{ id: 'm0001', speaker: 'operator', timestamp: '00:01', text: 'Здравствуйте!' }],
};
const checklist: ChecklistVersion = {
  ...defaultChecklist,
  id: 'v',
  checklistId: 'default',
  version: 1,
  createdAt: 'now',
};
const input = () => ({ conversation, checklist, signal: new AbortController().signal });
const completion = (patch: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      model: 'actual-snapshot',
      choices: [{ message: { content: '{"answers":[]}' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 30,
        completion_tokens_details: { reasoning_tokens: 10 },
        total_tokens: 130,
      },
      ...patch,
    }),
    { headers: { 'content-type': 'application/json' } },
  );

describe('OpenAI-compatible evaluation providers', () => {
  it.each([
    ['groq', 'https://api.groq.com/openai/v1/chat/completions'],
    ['openai', 'https://api.openai.com/v1/chat/completions'],
    ['deepseek', 'https://api.deepseek.com/chat/completions'],
    ['ollama', 'http://127.0.0.1:11434/v1/chat/completions'],
  ] as const)('uses the explicit %s endpoint and makes one request', async (kind, endpoint) => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const provider = new CompatibleProvider(
      { kind, apiKey: 'test-secret', modelId: 'test-model' },
      async (url, init) => {
        requests.push({ url: String(url), init });
        return completion();
      },
    );
    const result = await provider.generate(input());
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(endpoint);
    expect(requests[0].init?.redirect).toBe('error');
    const body = JSON.parse(String(requests[0].init?.body));
    expect(body.model).toBe('test-model');
    expect(body.messages[0].role).toBe('system');
    expect(JSON.parse(body.messages[1].content).conversation.messages[0].text).toBe(
      'Здравствуйте!',
    );
    expect(body).not.toHaveProperty('tools');
    if (kind === 'deepseek') {
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.thinking).toEqual({ type: 'disabled' });
    } else {
      expect(body.response_format.type).toBe('json_schema');
      expect(body.response_format.json_schema.strict).toBe(true);
      expect(body.response_format.json_schema.schema.properties.answers.required).toEqual(
        checklist.criteria.map((c) => c.id),
      );
      expect(
        body.response_format.json_schema.schema.properties.answers.properties.contact.properties
          .facts,
      ).toBeDefined();
    }
    if (kind === 'openai' || kind === 'groq') expect(body.max_completion_tokens).toBe(8192);
    else expect(body.max_tokens).toBe(8192);
    if (kind === 'openai') expect(body).not.toHaveProperty('temperature');
    expect(result).toMatchObject({
      text: '{"answers":[]}',
      modelVersion: 'actual-snapshot',
      finishReason: 'STOP',
      usage: { inputTokens: 100, outputTokens: 20, thinkingTokens: 10, totalTokens: 130 },
    });
  });

  it('retains usage and marks truncation instead of declaring a successful finish', async () => {
    const provider = new CompatibleProvider(
      { kind: 'groq', apiKey: 'key', modelId: 'model' },
      async () =>
        completion({
          choices: [{ message: { content: '{' }, finish_reason: 'length' }],
        }),
    );
    expect(await provider.generate(input())).toMatchObject({
      finishReason: 'MAX_TOKENS',
      usage: { totalTokens: 130 },
    });
  });

  it('marks explicit refusals and content filters without leaking refusal prose', async () => {
    for (const choice of [
      { message: { content: null, refusal: 'sensitive prose' }, finish_reason: 'stop' },
      { message: { content: null }, finish_reason: 'content_filter' },
    ]) {
      const provider = new CompatibleProvider(
        { kind: 'openai', apiKey: 'key', modelId: 'model' },
        async () => completion({ choices: [choice] }),
      );
      const result = await provider.generate(input());
      expect(result.blockReason).toBeTruthy();
      expect(JSON.stringify(result)).not.toContain('sensitive prose');
    }
  });

  it.each([
    [400, 'INVALID_PROVIDER_REQUEST', false],
    [401, 'AUTH_FAILED', false],
    [402, 'BILLING_REQUIRED', false],
    [403, 'AUTH_FAILED', false],
    [404, 'MODEL_UNAVAILABLE', false],
    [429, 'RATE_LIMIT', true],
    [503, 'PROVIDER_FAILED', true],
    [302, 'PROVIDER_FAILED', false],
  ])('maps HTTP %i to a safe non-leaking failure', async (status, code, retryable) => {
    let calls = 0;
    const provider = new CompatibleProvider(
      { kind: 'groq', apiKey: 'test-secret', modelId: 'model' },
      async () => {
        calls++;
        return new Response('test-secret transcript contents', {
          status: Number(status),
          headers: { 'retry-after': '2' },
        });
      },
    );
    await expect(provider.generate(input())).rejects.toMatchObject({
      message: code,
      code,
      retryable,
    });
    expect(calls).toBe(1);
  });

  it('honors a retry delay and passes the abort signal to the single HTTP request', async () => {
    const request = input();
    const provider = new CompatibleProvider(
      { kind: 'groq', apiKey: 'key', modelId: 'model' },
      async (_url, init) => {
        expect(init?.signal).toBe(request.signal);
        return new Response('{}', { status: 429, headers: { 'retry-after': '65' } });
      },
    );
    await expect(provider.generate(request)).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      retryAfterMs: 65000,
    });
  });

  it('does not invent missing usage or silently accept a response without a choice', async () => {
    const provider = new CompatibleProvider(
      { kind: 'groq', apiKey: 'key', modelId: 'model' },
      async () => completion({ choices: [], usage: undefined }),
    );
    expect(await provider.generate(input())).toMatchObject({
      finishReason: 'MALFORMED_RESPONSE',
      text: '',
      usage: { inputTokens: null, outputTokens: null, thinkingTokens: null, totalTokens: null },
    });
  });

  it.each([
    'https://remote.example/v1',
    'http://127.0.0.1.evil.example/v1',
    'http://user:secret@127.0.0.1:11434/v1',
    'http://127.0.0.1:11434/v1?key=secret',
  ])('rejects a nonlocal or credential-bearing Ollama endpoint %s', (baseUrl) => {
    expect(
      () => new CompatibleProvider({ kind: 'ollama', modelId: 'local-model', baseUrl }),
    ).toThrow();
  });

  it('rejects cloud-routed Ollama models in the local provider', () => {
    for (const modelId of ['qwen:cloud', 'gpt-oss:20b-cloud'])
      expect(() => new CompatibleProvider({ kind: 'ollama', modelId })).toThrow(/local/i);
  });

  it('separates caches for providers, endpoints and generation options, but not API keys', () => {
    const config = { kind: 'groq' as const, apiKey: 'key', modelId: 'model' };
    const first = new CompatibleProvider(config).configurationId;
    expect(new CompatibleProvider({ ...config, apiKey: 'another-key' }).configurationId).toBe(
      first,
    );
    expect(new CompatibleProvider({ ...config, kind: 'openai' }).configurationId).not.toBe(first);
    expect(new CompatibleProvider({ ...config, maxOutputTokens: 4096 }).configurationId).not.toBe(
      first,
    );
    expect(new CompatibleProvider({ ...config, reasoningEffort: 'low' }).configurationId).not.toBe(
      first,
    );
    expect(
      new CompatibleProvider({
        kind: 'ollama',
        modelId: 'local',
        baseUrl: 'http://localhost:11435/v1',
      }).configurationId,
    ).not.toBe(new CompatibleProvider({ kind: 'ollama', modelId: 'local' }).configurationId);
  });

  it('selects providers from validated env settings without implicit models or credentials', () => {
    expect(
      providerFromEnv({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'key', GROQ_MODEL: 'model' })?.id,
    ).toBe('groq');
    expect(providerFromEnv({ AI_PROVIDER: 'ollama', OLLAMA_MODEL: 'local' })?.id).toBe('ollama');
    expect(
      providerFromEnv({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'key', OPENAI_MODEL: 'model' })?.id,
    ).toBe('openai');
    expect(
      providerFromEnv({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'key', DEEPSEEK_MODEL: 'model' })
        ?.id,
    ).toBe('deepseek');
    expect(() => providerFromEnv({ AI_PROVIDER: 'groq', GROQ_MODEL: 'model' })).toThrow();
    expect(() => providerFromEnv({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'key' })).toThrow();
  });
});

describe('explicit inexpensive OpenAI reasoning configuration', () => {
  it('passes none through configuration and gives it a distinct cache identity', async () => {
    const provider = providerFromEnv({
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'test',
      OPENAI_MODEL: 'gpt-6-luna',
      AI_REASONING_EFFORT: 'none',
    });
    expect(provider).toBeDefined();
    let body: any;
    const candidate = new CompatibleProvider(
      { kind: 'openai', apiKey: 'test', modelId: 'gpt-6-luna', reasoningEffort: 'none' },
      async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return completion();
      },
    );
    await candidate.generate(input());
    expect(body.reasoning_effort).toBe('none');
    expect(candidate.configurationId).not.toBe(
      new CompatibleProvider({
        kind: 'openai',
        apiKey: 'test',
        modelId: 'gpt-6-luna',
        reasoningEffort: 'low',
      }).configurationId,
    );
  });
});

it('classifies exhausted quota without retrying or exposing provider text', async () => {
  const provider = new CompatibleProvider(
    { kind: 'openai', apiKey: 'secret', modelId: 'test' },
    async () =>
      new Response(JSON.stringify({ error: { type: 'insufficient_quota', message: 'private' } }), {
        status: 429,
      }),
  );
  await expect(provider.generate(input())).rejects.toMatchObject({
    code: 'BILLING_REQUIRED',
    retryable: false,
  });
});
