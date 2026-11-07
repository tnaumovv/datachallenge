import { useEffect, useState } from 'react';
import type { Appeal, ChecklistVersion, Conversation, Evaluation } from '../../shared/contracts.js';
import { api } from './api';
import { answerLabel, appealStatusLabel, scoreLabel } from './review-format';
import { AppealReview } from './EvaluationAppeals';
import { conversationTitle } from './DialogsPage';

type Queue =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; appeals: Appeal[]; evaluations: Evaluation[] };

export function AppealsPage({
  conversations,
  checklists,
  onOpen,
  selectedId,
  onSelect,
}: {
  conversations: Conversation[];
  checklists: ChecklistVersion[];
  onOpen: (evaluation: Evaluation, appealId: string) => void;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Appeal['status']>('pending');
  const [queue, setQueue] = useState<Queue>({ status: 'loading' });
  const [loadKey, setLoadKey] = useState(0);
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([api.appeals(controller.signal), api.evaluations(null, controller.signal)]).then(
      ([appeals, evaluations]) => {
        if (!controller.signal.aborted) setQueue({ status: 'ready', appeals, evaluations });
      },
      () => {
        if (!controller.signal.aborted) setQueue({ status: 'error' });
      },
    );
    return () => controller.abort();
  }, [loadKey]);
  function reload() {
    setQueue({ status: 'loading' });
    setLoadKey((key) => key + 1);
  }
  const all =
    queue.status === 'ready'
      ? [...queue.appeals].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : [];
  const items = all.filter((item) => item.status === filter);
  const selected = all.find((item) => item.id === (selectedId ?? localSelected)) ?? items[0];
  const evaluation =
    selected && queue.status === 'ready'
      ? queue.evaluations.find((item) => item.id === selected.evaluationId)
      : undefined;
  const conversation =
    evaluation && conversations.find((item) => item.id === evaluation.conversationId);
  const checklist =
    evaluation && checklists.find((item) => item.id === evaluation.checklistVersionId);
  const criterion =
    selected && checklist?.criteria.find((item) => item.id === selected.criterionId);
  const original =
    selected &&
    evaluation?.originalAnswers.find((item) => item.criterionId === selected.criterionId);
  const evidence =
    selected && evaluation?.evidence.find((item) => item.criterionId === selected.criterionId);
  const quotes = [
    ...new Map(
      [...(evidence?.evidence ?? []), ...(evidence?.checkedSpan ?? [])].map((message) => [
        message.id,
        message,
      ]),
    ).values(),
  ];
  return (
    <main id="main-content" className="page-content queue" tabIndex={-1}>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Проверка решений</p>
          <h1>Апелляции</h1>
          <p className="page-description">Обращения, доказательства и история пересмотра.</p>
        </div>
        <button className="button secondary" disabled={queue.status === 'loading'} onClick={reload}>
          Обновить
        </button>
      </header>
      <div className="appeals-workspace">
        <section className="panel" aria-labelledby="appeal-queue-heading">
          <div className="panel-header queue-header">
            <h2 id="appeal-queue-heading">Обращения</h2>
            <div className="queue-filters" role="group" aria-label="Статус апелляций">
              <button
                type="button"
                className="button secondary"
                aria-pressed={filter === 'pending'}
                onClick={() => {
                  setFilter('pending');
                  setLocalSelected(null);
                  onSelect?.('');
                }}
              >
                На рассмотрении
              </button>
              <button
                type="button"
                className="button secondary"
                aria-pressed={filter === 'resolved'}
                onClick={() => {
                  setFilter('resolved');
                  setLocalSelected(null);
                  onSelect?.('');
                }}
              >
                Рассмотрены
              </button>
            </div>
          </div>
          {queue.status === 'loading' && (
            <p className="queue-note" role="status">
              Загружаем апелляции…
            </p>
          )}
          {queue.status === 'error' && (
            <div className="queue-note" role="alert">
              <p>Не удалось загрузить апелляции.</p>
              <button className="button secondary" onClick={reload}>
                Повторить
              </button>
            </div>
          )}
          {queue.status === 'ready' && !items.length && (
            <div className="queue-note">
              <p>Апелляций с таким статусом пока нет.</p>
            </div>
          )}
          {!!items.length && (
            <ul className="appeal-case-list">
              {items.map((appeal) => {
                const assessment =
                  queue.status === 'ready'
                    ? queue.evaluations.find((item) => item.id === appeal.evaluationId)
                    : undefined;
                const dialog =
                  assessment && conversations.find((item) => item.id === assessment.conversationId);
                const rule =
                  assessment &&
                  checklists
                    .find((item) => item.id === assessment.checklistVersionId)
                    ?.criteria.find((item) => item.id === appeal.criterionId);
                return (
                  <li key={appeal.id}>
                    <button
                      type="button"
                      aria-pressed={selected?.id === appeal.id}
                      onClick={() => {
                        setLocalSelected(appeal.id);
                        onSelect?.(appeal.id);
                      }}
                    >
                      <strong>{dialog ? conversationTitle(dialog) : 'Диалог недоступен'}</strong>
                      <span className="muted small">{rule?.title ?? 'Критерий недоступен'}</span>
                      <span className={'status appeal-' + appeal.status}>
                        {appealStatusLabel[appeal.status]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {selected && evaluation && criterion ? (
          <section className="panel appeal-case-detail" aria-label="Рассмотрение апелляции">
            <header>
              <h2>{conversation ? conversationTitle(conversation) : 'Рассмотрение апелляции'}</h2>
              <p className="page-description">
                {criterion.title} · чек-лист v{checklist?.version}
              </p>
            </header>
            <div className="original-score">
              <span>Исходная AI-оценка</span>
              <strong>
                {original ? answerLabel(criterion, original.value) : '—'} ·{' '}
                {scoreLabel(evaluation.originalScore)}
              </strong>
            </div>
            {quotes.length > 0 && (
              <section className="original-evidence">
                <h3>Исходные доказательства AI</h3>
                {quotes.map((message) => (
                  <blockquote key={message.id}>
                    {message.text}
                    <footer>
                      {message.speaker === 'operator'
                        ? 'Оператор'
                        : message.speaker === 'client'
                          ? 'Клиент'
                          : message.speaker === 'bot'
                            ? 'Бот'
                            : 'Система'}{' '}
                      · {message.timestamp}
                    </footer>
                  </blockquote>
                ))}
              </section>
            )}
            <div>
              <button className="text-button" onClick={() => onOpen(evaluation, selected.id)}>
                Открыть диалог и транскрипт ↗
              </button>
            </div>
            <AppealReview
              key={selected.id}
              appeal={selected}
              criterion={criterion}
              evaluation={evaluation}
              onReload={reload}
              onResolved={() => reload()}
            />
          </section>
        ) : (
          queue.status === 'ready' && (
            <section className="panel empty-state">
              <span className="empty-icon" aria-hidden="true">
                ↗
              </span>
              <h2>{selected ? 'Данные оценки недоступны' : 'Выберите обращение'}</h2>
              <p>
                {selected
                  ? 'Обновите данные или откройте другой диалог.'
                  : 'Откройте обращение из списка. Новую апелляцию можно подать из оценки диалога.'}
              </p>
            </section>
          )
        )}
      </div>
    </main>
  );
}
