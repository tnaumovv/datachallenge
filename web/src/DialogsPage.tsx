import { useEffect, useRef, useState } from 'react';
import type { ChecklistVersion, Conversation, Evaluation } from '../../shared/contracts.js';
import { api, startErrorMessage } from './api';
import { channelName } from './Transcript';
import { numbers } from './review-format';
import { ImportDialog } from './ImportDialog';
import { ActionButton } from './ActionButton';
import { Icon } from './Icon';

export const evaluationLabel: Record<Evaluation['status'], string> = {
  queued: 'В очереди',
  running: 'Оценивается',
  completed: 'Завершено',
  failed: 'Ошибка',
};
export function conversationTitle(conversation: Conversation) {
  return (
    conversation.messages.find((message) => message.speaker === 'client')?.text ||
    conversation.messages[0]?.text ||
    conversation.sourceConversationId
  );
}
export function latestEvaluations(items: Evaluation[]) {
  const latest = new Map<string, Evaluation>();
  for (const item of items) {
    const previous = latest.get(item.conversationId);
    if (!previous || item.createdAt > previous.createdAt) latest.set(item.conversationId, item);
  }
  return latest;
}

export function DialogsPage({
  conversations,
  checklists,
  onOpen,
  onRefresh,
}: {
  conversations: Conversation[];
  checklists: ChecklistVersion[];
  onOpen: (id: string, evaluationId?: string) => void;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [language, setLanguage] = useState('');
  const [channel, setChannel] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [version, setVersion] = useState('');
  const [items, setItems] = useState<Evaluation[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadKey, setLoadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    async function load() {
      try {
        const next = await api.evaluations(null, controller.signal);
        if (controller.signal.aborted) return;
        setItems(next);
        setStatus('ready');
        if (next.some((item) => item.status === 'queued' || item.status === 'running'))
          timer = window.setTimeout(load, 2000);
      } catch {
        if (!controller.signal.aborted) setStatus('error');
      }
    }
    void load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [loadKey]);
  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => {
    const ids = new Set(conversations.map((item) => item.id));
    setSelected((current) => new Set([...current].filter((id) => ids.has(id))));
  }, [conversations]);
  const latest = latestEvaluations(items);
  const versions = [...checklists].sort(
    (a, b) => a.checklistId.localeCompare(b.checklistId) || b.version - a.version,
  );
  const versionId = versions.some((item) => item.id === version) ? version : versions[0]?.id;
  const needle = query.trim().toLocaleLowerCase();
  const matches = conversations.filter(
    (item) =>
      (!group || item.groupId === group) &&
      (!language || item.language === language) &&
      (!channel || item.channel === channel) &&
      (!needle ||
        [item.sourceConversationId, item.groupId, conversationTitle(item)].some((text) =>
          text.toLocaleLowerCase().includes(needle),
        )),
  );
  const pageSize = 15;
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = matches.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  function filter(update: () => void) {
    update();
    setPage(0);
    setSelected(new Set());
  }
  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 100) next.add(id);
      return next;
    });
  }
  async function run(retry?: Evaluation) {
    if (mutation.current || !versionId) return;
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const result = retry
        ? await api.retry(retry.id, controller.signal)
        : await api.start(
            { conversationIds: [...selected], checklistVersionId: versionId },
            controller.signal,
          );
      if (controller.signal.aborted) return;
      if (!result.evaluationIds.length) throw new Error('Empty enqueue result');
      setSelected(new Set());
      setLoadKey((key) => key + 1);
      setNotice(
        `Оценка запрошена для диалогов: ${result.evaluationIds.length}. Сохранённые результаты можно открыть сразу.`,
      );
      if (retry) onOpen(retry.conversationId, result.evaluationIds[0]);
    } catch (cause) {
      if (!controller.signal.aborted) setError(startErrorMessage(cause));
    } finally {
      mutation.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <main id="main-content" className="page-content" tabIndex={-1}>
      <header className="page-heading">
        <div>
          <h1>Диалоги</h1>
        </div>
        <div className="heading-actions">
          <ActionButton
            icon="refresh"
            onClick={() => {
              onRefresh();
              setLoadKey((key) => key + 1);
            }}
          >
            Обновить
          </ActionButton>
          <ActionButton icon="upload" variant="primary" onClick={() => setImporting(true)}>
            Импортировать
          </ActionButton>
        </div>
      </header>
      <section className="panel conversations-panel" aria-label="Список диалогов">
        <div className="list-toolbar">
          <label className="search-control">
            <Icon name="search" />
            <input
              type="search"
              aria-label="Найти диалог"
              placeholder="Найти диалог…"
              value={query}
              onChange={(e) => filter(() => setQuery(e.target.value))}
            />
          </label>
          <select
            className="field"
            aria-label="Группа диалогов"
            value={group}
            onChange={(e) => filter(() => setGroup(e.target.value))}
          >
            <option value="">Все группы</option>
            {[...new Set(conversations.map((item) => item.groupId))].sort().map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            className="field"
            aria-label="Язык диалогов"
            value={language}
            onChange={(e) => filter(() => setLanguage(e.target.value))}
          >
            <option value="">Все языки</option>
            <option>RU</option>
            <option>KZ</option>
            <option>EN</option>
          </select>
          <select
            className="field"
            aria-label="Канал диалогов"
            value={channel}
            onChange={(e) => filter(() => setChannel(e.target.value))}
          >
            <option value="">Все каналы</option>
            <option value="agent chat">Чат</option>
            <option value="voice call">Звонок</option>
          </select>
        </div>
        <div className="evaluation-toolbar">
          <label className="version-control">
            <span>Чек-лист для оценки</span>
            <select
              className="field"
              aria-label="Чек-лист для оценки"
              value={versionId ?? ''}
              onChange={(e) => setVersion(e.target.value)}
              disabled={busy || !versions.length}
            >
              {!versions.length && <option value="">Нет доступных версий</option>}
              {versions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · v{item.version}
                </option>
              ))}
            </select>
          </label>
          <ActionButton
            icon="play"
            variant="primary"
            disabled={busy || !selected.size || !versionId}
            onClick={() => void run()}
          >
            {busy ? 'Запускаем…' : `Оценить выбранные${selected.size ? ` (${selected.size})` : ''}`}
          </ActionButton>
          <span className="muted small">До 100 диалогов за запуск</span>
        </div>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {status === 'error' && (
          <div className="notice notice-error" role="alert">
            Не удалось загрузить оценки. Диалоги доступны.
            <button
              className="button secondary"
              onClick={() => {
                setStatus('loading');
                setLoadKey((key) => key + 1);
              }}
            >
              Повторить загрузку оценок
            </button>
          </div>
        )}
        {status === 'loading' && (
          <p className="table-note muted" role="status">
            Загружаем результаты…
          </p>
        )}
        {!matches.length ? (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">
              ▤
            </span>
            <h2>{conversations.length ? 'Диалоги не найдены' : 'Пока нет диалогов'}</h2>
            <p>
              {conversations.length
                ? 'Измените поиск или фильтры.'
                : 'Импортируйте записи, чтобы начать проверку.'}
            </p>
            {!conversations.length && (
              <button className="button secondary" onClick={() => setImporting(true)}>
                Импортировать диалоги
              </button>
            )}
          </div>
        ) : (
          <div className="table-scroll" tabIndex={0} aria-label="Таблица диалогов">
            <table className="conversation-table">
              <thead>
                <tr>
                  <th className="selection-cell">
                    <label className="checkbox-hitbox">
                      <input
                        type="checkbox"
                        aria-label="Выбрать диалоги на странице"
                        checked={
                          visible.length > 0 && visible.every((item) => selected.has(item.id))
                        }
                        disabled={busy}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelected((current) => {
                            const next = new Set(current);
                            for (const item of visible) {
                              if (checked && next.size < 100) next.add(item.id);
                              else if (!checked) next.delete(item.id);
                            }
                            return next;
                          });
                        }}
                      />
                    </label>
                  </th>
                  <th>Диалог</th>
                  <th>Канал</th>
                  <th>Язык</th>
                  <th>Оценка</th>
                  <th>Статус</th>
                  <th>
                    <span className="sr-only">Действия</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => {
                  const evaluation = status === 'ready' ? latest.get(item.id) : undefined;
                  return (
                    <tr key={item.id} className={selected.has(item.id) ? 'selected-row' : ''}>
                      <td>
                        <label className="checkbox-hitbox">
                          <input
                            type="checkbox"
                            aria-label={`Выбрать ${item.sourceConversationId}`}
                            checked={selected.has(item.id)}
                            disabled={busy || (!selected.has(item.id) && selected.size >= 100)}
                            onChange={() => toggle(item.id)}
                          />
                        </label>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="conversation-title"
                          onClick={() => onOpen(item.id)}
                        >
                          {conversationTitle(item)}
                        </button>
                        <span className="conversation-reference">
                          {item.sourceConversationId} <span aria-hidden="true">·</span>{' '}
                          {item.groupId}
                        </span>
                      </td>
                      <td>
                        <span className="channel-label">{channelName[item.channel]}</span>
                      </td>
                      <td>
                        <span className="language-chip">{item.language}</span>
                      </td>
                      <td className="table-score">
                        {evaluation?.status === 'completed' && evaluation.finalScore?.total != null
                          ? numbers.format(evaluation.finalScore.total)
                          : '—'}
                      </td>
                      <td>
                        <span
                          className={`status ${evaluation ? `status-${evaluation.status}` : 'status-neutral'}`}
                        >
                          {status === 'error'
                            ? 'Недоступно'
                            : evaluation
                              ? evaluationLabel[evaluation.status]
                              : status === 'loading'
                                ? 'Загрузка…'
                                : 'Не оценён'}
                        </span>
                      </td>
                      <td className="row-action">
                        {evaluation?.status === 'failed' ? (
                          <button
                            className="button secondary small-button"
                            disabled={busy}
                            onClick={() => void run(evaluation)}
                          >
                            Повторить
                          </button>
                        ) : (
                          <ActionButton
                            icon="next"
                            className="small-button"
                            onClick={() => onOpen(item.id)}
                          >
                            Открыть
                          </ActionButton>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <footer className="table-footer">
          <span>
            {matches.length
              ? `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, matches.length)} из ${matches.length} диалогов`
              : '0 диалогов'}
            {selected.size ? ` · выбрано ${selected.size}` : ''}
          </span>
          <div className="pagination">
            <button
              className="button secondary"
              aria-label="Предыдущая страница"
              disabled={!currentPage}
              onClick={() => setPage(currentPage - 1)}
            >
              ←
            </button>
            <span>
              {currentPage + 1} / {pages}
            </span>
            <button
              className="button secondary"
              aria-label="Следующая страница"
              disabled={currentPage + 1 >= pages}
              onClick={() => setPage(currentPage + 1)}
            >
              →
            </button>
          </div>
        </footer>
      </section>
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImported={(result) => {
            setImporting(false);
            setNotice(`Добавлено: ${result.imported}. Уже были в группе: ${result.existing}.`);
            onRefresh();
            setLoadKey((key) => key + 1);
          }}
        />
      )}
    </main>
  );
}
