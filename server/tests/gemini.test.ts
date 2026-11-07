import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../src/evaluations/gemini.js';
import { providerFromEnv } from '../src/evaluations/config.js';
import { defaultChecklist } from '../src/checklists/default.js';
import { scoreExampleAnswers } from '../../shared/fixtures.js';
import type { ChecklistVersion, Conversation } from '../../shared/contracts.js';
const conversation: Conversation = {
  id: 'c1',
  sourceConversationId: 'source1',
  groupId: 'DEV',
  transcriptHash: 'hash',
  channel: 'agent chat',
  language: 'RU',
  audioUrl: null,
  importedAt: 'now',
  messages: [{ id: 'm0001', speaker: 'operator', timestamp: '00:01', text: 'Здравствуйте!' }],
};
const checklist: ChecklistVersion = {
  ...defaultChecklist,
  id: 'v1',
  version: 1,
  checklistId: 'default',
  createdAt: 'now',
};
afterEach(() => vi.unstubAllEnvs());
describe('Gemini adapter through actual SDK', () => {
  it('uses evidence-first facts by default and explicitly preserves the frozen legacy protocol', async () => {
    let body: any;
    const fake: typeof fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { role: 'model', parts: [{ text: '{}' }] }, finishReason: 'STOP' },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    };
    const current = new GeminiProvider({ apiKey: 'test-key', modelId: 'test-model' }, fake);
    await current.generate({ conversation, checklist, signal: new AbortController().signal });
    expect(current.outputFormat).toBe('rubric-v7');
    expect(current.promptVersion).toBe('cqa-evaluator-v7.2');
    expect(
      body.generationConfig.responseJsonSchema.properties.answers.properties.contact.properties
        .facts,
    ).toBeDefined();
    const legacy = new GeminiProvider(
      { apiKey: 'test-key', modelId: 'test-model', outputFormat: 'answers-v4' },
      fake,
    );
    await legacy.generate({ conversation, checklist, signal: new AbortController().signal });
    expect(legacy.promptVersion).toBe('cqa-evaluator-v4');
    expect(
      body.generationConfig.responseJsonSchema.properties.answers.items.anyOf[0].properties.value,
    ).toBeDefined();
    expect(current.configurationId).not.toBe(legacy.configurationId);
  });
  it('passes an explicitly configured thinking level to Gemini', async () => {
    let body: any;
    const fake: typeof fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { role: 'model', parts: [{ text: '{}' }] }, finishReason: 'STOP' },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    };
    const p = new GeminiProvider(
      { apiKey: 'test-key', modelId: 'test-model', thinkingLevel: 'low' },
      fake,
    );
    await p.generate({ conversation, checklist, signal: new AbortController().signal });
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  });

  it('separates cached evaluations when the thinking configuration changes', () => {
    const base = { apiKey: 'test-key', modelId: 'test-model' };
    expect(new GeminiProvider({ ...base, thinkingLevel: 'low' }).configurationId).not.toBe(
      new GeminiProvider(base).configurationId,
    );
  });

  it('validates the optional thinking setting from the environment', () => {
    const env = { AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'test-model' };
    expect(() => providerFromEnv({ ...env, GEMINI_THINKING_LEVEL: 'unbounded' })).toThrow();
    expect(providerFromEnv({ ...env, GEMINI_THINKING_LEVEL: 'low' })?.configurationId).not.toBe(
      providerFromEnv(env)?.configurationId,
    );
  });

  it.each(['GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_GENAI_USE_ENTERPRISE'])(
    'pins the Developer API despite inherited %s and endpoint overrides',
    async (flag) => {
      vi.stubEnv('GOOGLE_GENAI_USE_VERTEXAI', undefined);
      vi.stubEnv('GOOGLE_GENAI_USE_ENTERPRISE', undefined);
      vi.stubEnv(flag, 'true');
      vi.stubEnv('GOOGLE_GEMINI_BASE_URL', 'https://wrong-gemini.example/');
      vi.stubEnv('GOOGLE_VERTEX_BASE_URL', 'https://wrong-vertex.example/');
      let requested = '';
      const fake: typeof fetch = async (url) => {
        requested = String(url);
        return new Response(
          JSON.stringify({
            candidates: [
              { content: { role: 'model', parts: [{ text: '{}' }] }, finishReason: 'STOP' },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      };
      const p = new GeminiProvider({ apiKey: 'test-key', modelId: 'test-model' }, fake);
      await p.generate({ conversation, checklist, signal: new AbortController().signal });
      const url = new URL(requested);
      expect(url.origin).toBe('https://generativelanguage.googleapis.com');
      expect(url.pathname).toBe('/v1beta/models/test-model:generateContent');
    },
  );
  it('sends structured JSON and separates system instructions from data; retains actual usage', async () => {
    let body: any;
    let calls = 0;
    const fake: typeof fetch = async (_url, init) => {
      calls++;
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: JSON.stringify({ answers: scoreExampleAnswers }) }],
              },
              finishReason: 'STOP',
            },
          ],
          modelVersion: 'test-resolved-model',
          usageMetadata: {
            promptTokenCount: 110,
            candidatesTokenCount: 40,
            thoughtsTokenCount: 20,
            totalTokenCount: 170,
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    };
    const p = new GeminiProvider({ apiKey: 'test-key', modelId: 'test-model' }, fake);
    const result = await p.generate({
      conversation,
      checklist,
      signal: new AbortController().signal,
    });
    expect(calls).toBe(1);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseJsonSchema.properties.answers).toBeDefined();
    expect(JSON.parse(body.contents[0].parts[0].text).conversation.messages[0].text).toBe(
      'Здравствуйте!',
    );
    expect(body.systemInstruction).toBeDefined();
    expect(result.usage).toEqual({
      inputTokens: 110,
      outputTokens: 40,
      thinkingTokens: 20,
      totalTokens: 170,
    });
    expect(result.modelVersion).toBe('test-resolved-model');
  });
  it('does not perform hidden SDK retries; propagates Retry-After without exposing secrets', async () => {
    let calls = 0;
    const fake: typeof fetch = async () => {
      calls++;
      return new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: 'secret-key sensitive provider error',
            status: 'RESOURCE_EXHAUSTED',
          },
        }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '2' } },
      );
    };
    const p = new GeminiProvider({ apiKey: 'test-key', modelId: 'test-model' }, fake);
    let error: any;
    try {
      await p.generate({ conversation, checklist, signal: new AbortController().signal });
    } catch (e) {
      error = e;
    }
    expect(calls).toBe(1);
    expect(error).toMatchObject({ code: 'RATE_LIMIT', retryable: true, retryAfterMs: 2000 });
    expect(String(error)).not.toContain('secret');
  });
  it('does not auto-continue a truncated generation with extra untracked calls', async () => {
    let calls = 0;
    const fake: typeof fetch = async () => {
      calls++;
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { role: 'model', parts: [{ text: '{}' }] }, finishReason: 'CONTINUATION' },
          ],
          continuationToken: 'token',
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    };
    const p = new GeminiProvider({ apiKey: 'test-key', modelId: 'test-model' }, fake);
    const result = await p.generate({
      conversation,
      checklist,
      signal: new AbortController().signal,
    });
    expect(calls).toBe(1);
    expect(result.finishReason).toBe('CONTINUATION');
  });
  it('does not configure a fake evaluator when credentials are absent', () => {
    expect(providerFromEnv({})).toBeUndefined();
    expect(() => providerFromEnv({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'x' })).toThrow();
    expect(() => providerFromEnv({ AI_PROVIDER: 'unknown' })).toThrow();
  });
});
