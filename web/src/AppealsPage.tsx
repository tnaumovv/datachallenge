import { useEffect, useState } from 'react';
import type { Appeal, ChecklistVersion, Conversation, Evaluation } from '../../shared/contracts.js';
import { api } from './api';
import { appealStatusLabel } from './review-format';

type Queue =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; appeals: Appeal[]; evaluations: Evaluation[] };

export function AppealsPage({
  conversations,
  checklists,
  onOpen,
}: {
  conversations: Conversation[];
  checklists: ChecklistVersion[];
  onOpen: (evaluation: Evaluation, appealId: string) => void;
}) {
  const [filter, setFilter] = useState<Appeal['status']>('pending');
  const [queue, setQueue] = useState<Queue>({ status: 'loading' });
  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([api.appeals(signal), api.evaluations(null, signal)]).then(
      ([appeals, evaluations]) => {
        if (!signal.aborted) setQueue({ status: 'ready', appeals, evaluations });
      },
      () => {
        if (!signal.aborted) setQueue({ status: 'error' });
      },
    );
    return () => controller.abort();
  }, [loadKey]);

  function reload() {
    setQueue({ status: 'loading' });
    setLoadKey((key) => key + 1);
  }

  const items =
    queue.status === 'ready'
      ? queue.appeals.filter((appeal) => appeal.status === filter).toReversed()
      : [];
  const evaluations = new Map(
    queue.status === 'ready'
      ? queue.evaluations.map((evaluation) => [evaluation.id, evaluation])
      : [],
  );
  const dialogs = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const versions = new Map(checklists.map((checklist) => [checklist.id, checklist]));

  return (
    <main className="queue">
      <section className="panel" aria-labelledby="appeal-queue-heading">
        <div className="panel-header queue-header">
          <div className="title-row">
            <h2 id="appeal-queue-heading">Апелляции</h2>
            <button
              type="button"
              className="button secondary"
              disabled={queue.status === 'loading'}
              onClick={reload}
            >
              Обновить
            </button>
          </div>
          <div className="queue-filters" role="group" aria-label="Статус апелляций">
            <button
              type="button"
              className="button secondary"
              aria-pressed={filter === 'pending'}
              onClick={() => setFilter('pending')}
            >
              На рассмотрении
            </button>
            <button
              type="button"
              className="button secondary"
              aria-pressed={filter === 'resolved'}
              onClick={() => setFilter('resolved')}
            >
              Решённые
            </button>
          </div>
        </div>
        {queue.status === 'loading' && (
          <p className="queue-note" role="status">
            Загружаем апелляции…
          </p>
        )}
        {queue.status === 'error' && (
          <p className="queue-note" role="alert">
            Не удалось загрузить апелляции. Обновите список.
          </p>
        )}
        {queue.status === 'ready' && items.length === 0 && (
          <p className="queue-note">Апелляций с таким статусом пока нет.</p>
        )}
        {items.length > 0 && (
          <ul className="queue-list">
            {items.map((appeal) => {
              const evaluation = evaluations.get(appeal.evaluationId);
              const dialog = evaluation && dialogs.get(evaluation.conversationId);
              const criterion =
                evaluation &&
                versions
                  .get(evaluation.checklistVersionId)
                  ?.criteria.find((criterion) => criterion.id === appeal.criterionId);
              return (
                <li className="queue-item" key={appeal.id}>
                  <div className="queue-item-main">
                    <h3>{criterion?.title ?? 'Критерий недоступен'}</h3>
                    {dialog && <p className="muted">{dialog.sourceConversationId}</p>}
                    <p className="queue-comment">{appeal.comment}</p>
                  </div>
                  <div className="queue-item-actions">
                    <span className={`status appeal-${appeal.status}`}>
                      {appealStatusLabel[appeal.status]}
                    </span>
                    {evaluation && dialog ? (
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => onOpen(evaluation, appeal.id)}
                      >
                        Открыть
                      </button>
                    ) : (
                      <span className="muted">Диалог недоступен</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
