// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScoreResponse } from '../../shared/contracts.js';
import { demoImport } from '../../shared/fixtures.js';
import { scoreEvaluation } from '../../server/src/evaluations/scoring.js';
import { App } from './App';
import { api, RequestError } from './api';
import { EvaluationPanel } from './EvaluationPanel';
import { AppealReview } from './EvaluationAppeals';
import { ImportDialog } from './ImportDialog';
import { appeal, conversation, evaluation, version } from '../tests/fixtures';

beforeEach(() => {
  window.history.replaceState(null, '', '/dialogs');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
  vi.spyOn(api, 'profiles').mockResolvedValue([
    {
      id: 'legacy',
      title: 'Legacy',
      checklistId: version.checklistId,
      channels: ['agent chat', 'voice call'],
      activeVersionId: version.id,
      revision: 1,
    },
  ]);
  vi.spyOn(api, 'conversations').mockResolvedValue([structuredClone(conversation)]);
  vi.spyOn(api, 'checklists').mockResolvedValue([structuredClone(version)]);
  vi.spyOn(api, 'evaluations').mockResolvedValue([]);
  vi.spyOn(api, 'appeals').mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('working frontend flows', () => {
  it('clears the previous evaluation, appeal and message when switching conversations', async () => {
    const next = {
      ...conversation,
      id: 'kz/id',
      sourceConversationId: 'KZ-002',
      language: 'KZ' as const,
    };
    vi.mocked(api.conversations).mockResolvedValue([conversation, next]);
    vi.mocked(api.evaluations).mockImplementation(async (id) =>
      id === conversation.id ? [structuredClone(evaluation)] : [],
    );
    const start = vi.spyOn(api, 'start');
    window.history.replaceState(
      null,
      '',
      `/dialogs/${conversation.id}?evaluation=${evaluation.id}&appeal=old-appeal#m0002`,
    );
    render(<App />);
    const picker = await screen.findByRole('combobox', { name: 'Выбрать диалог' });
    await userEvent.click(picker);
    await userEvent.click(screen.getByRole('option', { name: /KZ-002/ }));
    expect(window.location.pathname).toBe('/dialogs/kz%2Fid');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
    expect(await screen.findByRole('button', { name: 'Запустить оценку' })).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'Выбранная реплика' })).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it('pairs a quote with its transcript message and restores the selection from the URL', async () => {
    vi.mocked(api.evaluations).mockResolvedValue([structuredClone(evaluation)]);
    const start = vi.spyOn(api, 'start');
    window.history.replaceState(null, '', '/dialogs/' + conversation.id);
    const { unmount } = render(<App />);
    const criterion = (await screen.findByText('Установление контакта')).closest('details')!;
    const quote = await within(criterion).findByRole('button', { name: /00:04/ });
    await userEvent.click(quote);
    const selected = screen.getByRole('article', { name: 'Выбранная реплика' });
    expect(document.activeElement).toBe(selected);
    expect(quote.getAttribute('aria-current')).toBe('true');
    expect(quote.getAttribute('aria-controls')).toBe(selected.id);
    expect(window.location.hash).toBe('#m0002');
    unmount();
    render(<App />);
    expect((await screen.findByRole('article', { name: 'Выбранная реплика' })).id).toBe('m0002');
    expect(start).not.toHaveBeenCalled();
  });

  it('opens original evidence from a deep link after a human correction clears effective pointers', async () => {
    const revised = structuredClone(evaluation);
    const answer = revised.effectiveAnswers.find((item) => item.criterionId === 'consultation')!;
    Object.assign(answer, {
      value: 20,
      explanation: 'Решение проверяющего.',
      evidenceMessageIds: [],
      checkedSpanMessageIds: [],
    });
    revised.finalScore = scoreEvaluation(version.criteria, revised.effectiveAnswers);
    vi.mocked(api.evaluations).mockResolvedValue([revised]);
    window.history.replaceState(
      null,
      '',
      `/dialogs/${conversation.id}?evaluation=${evaluation.id}#m0002`,
    );
    render(<App />);
    const criterion = (await screen.findByText('Качество консультации')).closest('details')!;
    expect(criterion.open).toBe(true);
    expect(within(criterion).getByText('Исходные доказательства')).toBeTruthy();
    expect(within(criterion).getByText(/Исходный ответ.*15 \/ 20/)).toBeTruthy();
    const quote = within(criterion).getByRole('button', { name: /00:04/ });
    expect(quote.getAttribute('aria-current')).toBe('true');
    expect(quote.getAttribute('aria-controls')).toBe('m0002');
  });

  it.each([false, true])(
    'shows the gross flag (%s) without a weighted points ratio',
    async (triggered) => {
      const flagged = structuredClone(evaluation);
      for (const answers of [flagged.originalAnswers, flagged.effectiveAnswers]) {
        answers.find((answer) => answer.criterionId === 'gross')!.value = triggered;
      }
      flagged.originalScore = flagged.finalScore = scoreEvaluation(
        version.criteria,
        flagged.effectiveAnswers,
      );
      vi.mocked(api.evaluations).mockResolvedValue([flagged]);
      window.history.replaceState(null, '', '/dialogs/' + conversation.id);
      render(<App />);
      const criterion = (
        await screen.findByText('Грубое нарушение', { selector: '.criterion-name' })
      ).closest('details')!;
      expect(criterion.textContent).toContain(triggered ? 'Нарушение' : 'Без нарушения');
      expect(criterion.textContent).not.toContain('0 / 0');
      expect(criterion.textContent).not.toContain('Вес:');
    },
  );

  it('shows genuine API records, filters them and opens a separate review route', async () => {
    render(<App />);
    const user = userEvent.setup();
    const row = await screen.findByRole('button', { name: conversation.messages[0].text });
    await user.type(screen.getByRole('searchbox', { name: 'Найти диалог' }), 'не совпадает');
    expect(screen.getByRole('heading', { name: 'Диалоги не найдены' })).toBeTruthy();
    await user.clear(screen.getByRole('searchbox', { name: 'Найти диалог' }));
    await user.click(screen.getByRole('button', { name: conversation.messages[0].text }));
    expect(window.location.pathname).toBe('/dialogs/' + conversation.id);
    expect(await screen.findByRole('heading', { name: 'Содержание диалога' })).toBeTruthy();
    expect(row).toBeTruthy();
  });
  it('renders unavailable data as an error rather than a successful empty list', async () => {
    vi.mocked(api.conversations).mockRejectedValue(new Error('network'));
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Не удалось загрузить данные' }),
    ).toBeTruthy();
    expect(screen.queryByText('Пока нет диалогов')).toBeNull();
  });
  it('keeps missing-model failure visible after an explicit evaluation request', async () => {
    const start = vi
      .spyOn(api, 'start')
      .mockRejectedValue(new RequestError('AI_NOT_CONFIGURED', 503));
    window.history.replaceState(null, '', '/dialogs/' + conversation.id);
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Запустить оценку' }));
    expect(await screen.findByText(/Запуск оценки недоступен/)).toBeTruthy();
    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('85,38')).toBeNull();
  });
  it('does not start a model on opening saved results and sends force=true only after a new-run action', async () => {
    vi.mocked(api.evaluations).mockResolvedValue([structuredClone(evaluation)]);
    const start = vi
      .spyOn(api, 'start')
      .mockRejectedValue(new RequestError('AI_NOT_CONFIGURED', 503));
    render(
      <EvaluationPanel
        conversation={conversation}
        checklists={[version]}
        requestedId={evaluation.id}
        selectedAppealId={null}
        onSelect={vi.fn()}
        onSelectAppeal={vi.fn()}
        onEvidence={vi.fn()}
      />,
    );
    const button = await screen.findByRole('button', { name: 'Оценить заново' });
    expect(screen.getByText('Вес: 10')).toBeTruthy();
    expect(screen.getByText('Вес: 20 · не учитывается')).toBeTruthy();
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByText(/Сохранено/)).toBeTruthy();
    await userEvent.click(button);
    expect(start).toHaveBeenCalledWith(
      { conversationIds: [conversation.id], checklistVersionId: version.id, force: true },
      expect.any(AbortSignal),
    );
  });
  it('loads the editor independently, creates a new version and preserves the original', async () => {
    window.history.replaceState(null, '', '/checklists');
    const create = vi
      .spyOn(api, 'createChecklistVersion')
      .mockImplementation(async (_id, input) => ({
        ...input,
        id: 'v2',
        checklistId: 'default',
        version: 2,
        createdAt: '2026-11-07T11:00:00Z',
      }));
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Новая версия' }));
    expect(api.conversations).not.toHaveBeenCalled();
    const title = screen.getByRole('textbox', { name: 'Название чек-листа' });
    await user.clear(title);
    await user.type(title, 'Мои правила');
    await user.click(screen.getByRole('button', { name: 'Сохранить версию' }));
    expect(await screen.findByText(/Версия 2 сохранена/)).toBeTruthy();
    expect(create).toHaveBeenCalledTimes(1);
    expect(version.title).not.toBe('Мои правила');
    expect(screen.getByRole('combobox', { name: 'Версия для просмотра' }).textContent).toContain(
      'Мои правила',
    );
  });
  it('retains a dirty checklist after save failure and guards navigation', async () => {
    window.history.replaceState(null, '', '/checklists');
    vi.spyOn(api, 'createChecklistVersion').mockRejectedValue(new Error('network'));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Новая версия' }));
    const title = screen.getByRole('textbox', { name: 'Название чек-листа' });
    await user.clear(title);
    await user.type(title, 'Не терять');
    await user.click(screen.getByRole('button', { name: 'Сохранить версию' }));
    expect(await screen.findByText(/Не удалось подтвердить сохранение/)).toBeTruthy();
    expect(
      (screen.getByRole('textbox', { name: 'Название чек-листа' }) as HTMLInputElement).value,
    ).toBe('Не терять');
    await user.click(screen.getByRole('link', { name: 'Диалоги' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(window.location.pathname).toBe('/checklists');
  });
  it('validates JSON before importing and submits actual parsed records once', async () => {
    const imported = vi.fn();
    const send = vi
      .spyOn(api, 'importRecords')
      .mockResolvedValue({ groupId: 'DEV', imported: 1, existing: 0, conversationIds: ['x'] });
    render(<ImportDialog onClose={vi.fn()} onImported={imported} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Источник' }));
    await user.click(screen.getByRole('option', { name: 'JSON-файл или текст' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Записи JSON' }), {
      target: { value: 'not json' },
    });
    await user.click(screen.getByRole('button', { name: 'Импортировать' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    if (demoImport.source !== 'json') throw new Error('Test data missing');
    fireEvent.change(screen.getByRole('textbox', { name: 'Записи JSON' }), {
      target: { value: JSON.stringify(demoImport.records) },
    });
    await user.click(screen.getByRole('button', { name: 'Импортировать' }));
    await waitFor(() => expect(imported).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toMatchObject({
      source: 'json',
      groupId: 'DEV',
      records: demoImport.records,
    });
  });
  it('ignores a late score preview after the selected replacement has changed', async () => {
    const resolvers: Array<(value: ScoreResponse) => void> = [];
    const preview = vi
      .spyOn(api, 'scorePreview')
      .mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    const criterion = version.criteria.find((item) => item.id === appeal.criterionId)!;
    render(
      <AppealReview
        appeal={appeal}
        criterion={criterion}
        evaluation={evaluation}
        onResolved={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Изменить ответ' }));
    await user.click(screen.getByRole('combobox', { name: 'Новое значение' }));
    await user.click(screen.getByRole('option', { name: 'Не применимо' }));
    await user.type(screen.getByRole('textbox', { name: 'Причина решения' }), 'Есть инструкция');
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('combobox', { name: 'Новое значение' }));
    await user.click(screen.getByRole('option', { name: '0 / 20' }));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolvers[1]({ ...evaluation.finalScore!, checklistVersionId: version.id, total: 60 });
    });
    expect(screen.getByText('60 / 100')).toBeTruthy();
    await act(async () => {
      resolvers[0]({ ...evaluation.finalScore!, checklistVersionId: version.id, total: 99 });
    });
    expect(screen.getByText('60 / 100')).toBeTruthy();
    expect(screen.queryByText('99 / 100')).toBeNull();
  });
});
