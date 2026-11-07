import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../src/db.js';
import { ChecklistService } from '../src/checklists/service.js';
import { ConversationService } from '../src/conversations/service.js';
import { GeminiProvider } from '../src/evaluations/gemini.js';
import { ProviderError } from '../src/evaluations/provider.js';
import { EvaluationService } from '../src/evaluations/service.js';
import { demoImport } from '../../shared/fixtures.js';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const retryInfo = (retryDelay: unknown) => ({
  '@type': 'type.googleapis.com/google.rpc.RetryInfo',
  retryDelay,
});
const quotaError = (details: unknown) => ({
  error: {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    message: 'private-provider-body',
    details,
  },
});
function response(body: unknown, retryAfter?: string, status = 429) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(retryAfter === undefined ? {} : { 'Retry-After': retryAfter }),
    },
  });
}
function setup(fetcher: typeof fetch) {
  const db = createDatabase(':memory:');
  cleanups.push(() => db.close());
  const conversations = new ConversationService(db);
  const conversationId = conversations.importRecords(
    'TEST',
    demoImport.source === 'json' ? demoImport.records : [],
  ).conversationIds[0];
  const conversation = conversations.get(conversationId)!;
  const checklist = new ChecklistService(db).seed();
  const provider = new GeminiProvider({ apiKey: 'test-key', modelId: 'test-model' }, fetcher);
  return { db, conversation, checklist, provider };
}
async function generateError(body: unknown, retryAfter?: string, status = 429) {
  const fetcher = vi.fn<typeof fetch>(async () => response(body, retryAfter, status));
  const { provider, conversation, checklist } = setup(fetcher);
  const error: unknown = await provider
    .generate({ conversation, checklist, signal: new AbortController().signal })
    .catch((error: unknown) => error);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(error).toBeInstanceOf(ProviderError);
  expect(String(error)).not.toContain('private-provider-body');
  expect(JSON.stringify(error)).not.toContain('private-provider-body');
  return error as ProviderError;
}

describe('Gemini RetryInfo through actual SDK', () => {
  it('reads a daily quota delay without a Retry-After header', async () => {
    const error = await generateError(quotaError([retryInfo('79699.89039399s')]));
    expect(error).toMatchObject({
      code: 'RATE_LIMIT',
      retryable: true,
      retryAfterMs: 79_699_891,
    });
  });

  it.each([
    { header: '2', delays: ['120s', '3s'], expected: 120_000 },
    { header: '180', delays: ['120s', '3s'], expected: 180_000 },
    { header: 'invalid-date', delays: ['0s', '3s'], expected: 3000 },
    { header: undefined, delays: ['0s'], expected: 0 },
    { header: undefined, delays: ['0.000000001s'], expected: 1 },
    { header: undefined, delays: ['1.25s'], expected: 1250 },
  ])('uses the longest valid delay: $header / $delays', async ({ header, delays, expected }) => {
    const error = await generateError(quotaError(delays.map(retryInfo)), header);
    expect(error.retryAfterMs).toBe(expected);
  });

  it('compares a Retry-After HTTP date with the body delay', async () => {
    const now = Date.parse('2026-11-07T10:00:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const header = new Date(now + 180_000).toUTCString();
    expect((await generateError(quotaError([retryInfo('120s')]), header)).retryAfterMs).toBe(
      180_000,
    );
    expect((await generateError(quotaError([retryInfo('240s')]), header)).retryAfterMs).toBe(
      240_000,
    );
  });

  it.each([
    null,
    120,
    { seconds: '120' },
    '',
    '-1s',
    'NaNs',
    'Infinitys',
    '1e3s',
    '120ms',
    '22h8m19.89039399s',
    '1.0000000001s',
    '315576000001s',
  ])('ignores invalid retryDelay %j and preserves the safe error and header', async (delay) => {
    const error = await generateError(quotaError([retryInfo(delay)]), '2');
    expect(error).toMatchObject({ code: 'RATE_LIMIT', retryable: true, retryAfterMs: 2000 });
  });

  it.each([
    null,
    {},
    { error: null },
    quotaError(null),
    quotaError(retryInfo('120s')),
    quotaError([null, {}, 123, { '@type': 'google.rpc.RetryInfo', retryDelay: '120s' }]),
  ])('tolerates malformed error details %j without losing the HTTP error', async (body) => {
    const error = await generateError(body);
    expect(error).toMatchObject({ code: 'RATE_LIMIT', retryable: true });
    expect(error.retryAfterMs).toBeUndefined();
  });

  it('skips unrelated or malformed details while retaining valid RetryInfo', async () => {
    const error = await generateError(
      quotaError([
        retryInfo('bad'),
        { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', retryDelay: '999s' },
        null,
        retryInfo('2.5s'),
      ]),
    );
    expect(error.retryAfterMs).toBe(2500);
  });

  it('honors RetryInfo for retryable service failures too', async () => {
    const error = await generateError({ error: { details: [retryInfo('120s')] } }, '2', 503);
    expect(error).toMatchObject({
      code: 'PROVIDER_FAILED',
      retryable: true,
      retryAfterMs: 120_000,
    });
  });

  it.each(['79699.89039399s', '60.000000001s'])(
    'stops the queue after one request for delay %s and persists only safe RATE_LIMIT data',
    async (retryDelay) => {
      const fetcher = vi.fn<typeof fetch>(async () =>
        response(quotaError([retryInfo(retryDelay)])),
      );
      const { db, provider, conversation, checklist } = setup(fetcher);
      const service = new EvaluationService(db, provider, { retryDelayMs: 1 });
      cleanups.push(() => service.stop());
      const [id] = service.enqueue([conversation.id], checklist.id);
      service.start();
      await vi.waitFor(() => expect(service.get(id)?.status).toBe('failed'));
      const result = service.get(id)!;
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(result.usage.calls).toBe(1);
      expect(result.error?.code).toBe('RATE_LIMIT');
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0]).toMatchObject({
        errorCode: 'RATE_LIMIT',
        failureStage: 'provider',
        validationErrors: [],
      });
      await service.stop();
      expect(new EvaluationService(db).get(id)).toEqual(result);
      const stored = db.prepare('SELECT payload FROM evaluations WHERE id=?').get(id)!;
      expect(stored.payload).not.toContain('private-provider-body');
      expect(stored.payload).not.toContain('RetryInfo');
      expect(stored.payload).not.toContain('RESOURCE_EXHAUSTED');
    },
  );
});
