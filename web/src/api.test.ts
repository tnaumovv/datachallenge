import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, importErrorMessage, startErrorMessage } from './api';

afterEach(() => vi.unstubAllGlobals());
describe('API contract integration', () => {
  it('imports organizer records without moving access URLs or keys into the browser', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          groupId: 'CONTROL',
          imported: 2,
          existing: 0,
          conversationIds: ['a', 'b'],
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    await api.importRecords(
      { source: 'organizer', groupId: 'CONTROL' },
      new AbortController().signal,
    );
    expect(fetcher.mock.calls[0][0]).toBe('/api/import');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      source: 'organizer',
      groupId: 'CONTROL',
    });
  });
  it('creates a new checklist version rather than updating an old one', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetcher);
    await api.createChecklistVersion(
      'chat/list',
      { title: 'Новая', sections: [], criteria: [] },
      new AbortController().signal,
    );
    expect(fetcher.mock.calls[0][0]).toBe('/api/checklists/chat%2Flist/versions');
    expect(fetcher.mock.calls[0][1].method).toBe('POST');
  });
  it('keeps a missing model a visible failure and never turns it into a score', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'AI_NOT_CONFIGURED', message: 'private diagnostics' },
          }),
          { status: 503 },
        ),
      ),
    );
    const error = await api
      .start({ conversationIds: ['a'], checklistVersionId: 'v1' }, new AbortController().signal)
      .catch((error) => error);
    expect(startErrorMessage(error)).toMatch(/недоступен/);
    expect(startErrorMessage(error)).not.toContain('private');
  });
  it('maps organizer and non-JSON failures without claiming a successful empty import', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('upstream private response', { status: 502 })),
    );
    const error = await api
      .importRecords({ source: 'organizer', groupId: 'DEV' }, new AbortController().signal)
      .catch((error) => error);
    expect(importErrorMessage(error)).toMatch(/Не удалось/);
    expect(importErrorMessage(error)).not.toContain('private');
  });
});
