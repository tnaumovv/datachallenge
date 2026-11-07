// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DialogsPage } from './DialogsPage';
import { EvaluationPanel } from './EvaluationPanel';
import { api } from './api';
import { conversation, version } from '../tests/fixtures';
const newer = { ...version, id: 'inactive-v2', version: 2 };
const profiles = [
  {
    id: 'legacy',
    title: 'Legacy',
    checklistId: 'default',
    channels: [conversation.channel],
    activeVersionId: version.id,
    revision: 1,
  },
];
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount(kind: string) {
  vi.spyOn(api, 'evaluations').mockResolvedValue([]);
  vi.spyOn(api, 'start').mockResolvedValue({ evaluationIds: ['new'] });
  if (kind === 'batch') {
    render(
      <DialogsPage
        conversations={[conversation]}
        checklists={[newer, version]}
        onOpen={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать UI-001' }));
  } else
    render(
      <EvaluationPanel
        conversation={conversation}
        checklists={[newer, version]}
        requestedId={null}
        selectedAppealId={null}
        onSelectAppeal={vi.fn()}
        onSelect={vi.fn()}
        onEvidence={vi.fn()}
      />,
    );
}
const picker = (kind: string) =>
  screen.getByRole('combobox', {
    name: kind === 'batch' ? 'Чек-лист для оценки' : 'Чек-лист',
  }) as HTMLSelectElement;
const run = (kind: string) =>
  screen.queryByRole('button', {
    name: kind === 'batch' ? /Оценить выбранные/ : 'Запустить оценку',
  }) as HTMLButtonElement | null;
it.each(['batch', 'individual'])(
  '%s waits for profiles and uses active v1 instead of saved v2',
  async (kind) => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            resolve = r;
          }),
      ),
    );
    mount(kind);
    await waitFor(() => expect(picker(kind).disabled).toBe(false));
    expect(picker(kind).value).toBe('');
    expect(!run(kind) || run(kind)!.disabled).toBe(true);
    expect(api.start).not.toHaveBeenCalled();
    await act(async () => resolve(new Response(JSON.stringify(profiles))));
    await waitFor(() => expect(picker(kind).value).toBe(version.id));
    fireEvent.click(run(kind)!);
    await waitFor(() =>
      expect(api.start).toHaveBeenCalledWith(
        expect.objectContaining({ checklistVersionId: version.id }),
        expect.any(AbortSignal),
      ),
    );
  },
);
it.each(['batch', 'individual'])(
  '%s recovers failed profiles and permits intentional explicit v2',
  async (kind) => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(new Response(JSON.stringify(profiles)));
    vi.stubGlobal('fetch', fetcher);
    mount(kind);
    await screen.findByText(/Не удалось загрузить активный чек-лист/);
    expect(picker(kind).value).toBe('');
    expect(!run(kind) || run(kind)!.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку профилей' }));
    await waitFor(() => expect(picker(kind).value).toBe(version.id));
    fireEvent.change(picker(kind), { target: { value: newer.id } });
    fireEvent.click(run(kind)!);
    await waitFor(() =>
      expect(api.start).toHaveBeenCalledWith(
        expect.objectContaining({ checklistVersionId: newer.id }),
        expect.any(AbortSignal),
      ),
    );
  },
);

it.each(['batch', 'individual'])(
  '%s allows an explicit saved version while profiles remain unavailable',
  async (kind) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    mount(kind);
    await screen.findByText(/Не удалось загрузить активный чек-лист/);
    await waitFor(() => expect(picker(kind).disabled).toBe(false));
    fireEvent.change(picker(kind), { target: { value: newer.id } });
    fireEvent.click(run(kind)!);
    await waitFor(() =>
      expect(api.start).toHaveBeenCalledWith(
        expect.objectContaining({ checklistVersionId: newer.id }),
        expect.any(AbortSignal),
      ),
    );
  },
);

it.each(['batch', 'individual'])(
  '%s does not infer an active version from an empty profile response',
  async (kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]')));
    mount(kind);
    await waitFor(() => expect(picker(kind).disabled).toBe(false));
    expect(picker(kind).value).toBe('');
    expect(!run(kind) || run(kind)!.disabled).toBe(true);
    expect(api.start).not.toHaveBeenCalled();
  },
);
