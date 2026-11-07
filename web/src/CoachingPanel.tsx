import { useEffect, useState } from 'react';
import type { Evaluation } from '../../shared/contracts.js';
import type { CoachingResult } from '../../shared/coaching.js';
import { api } from './api';
import { KnowledgeSources } from './KnowledgeSources';
import './knowledge.css';
export function CoachingPanel({
  evaluation,
  onEvidence,
}: {
  evaluation: Evaluation;
  onEvidence: (id: string) => void;
}) {
  const [result, setResult] = useState<CoachingResult | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError(false);
    api.coaching(evaluation.id, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setResult(value);
      },
      () => {
        if (!controller.signal.aborted) setError(true);
      },
    );
    return () => controller.abort();
  }, [evaluation.id, reload]);
  return (
    <section className="coaching-panel" aria-labelledby="coaching-heading">
      <h3 id="coaching-heading">Рекомендации оператору</h3>
      <p className="muted">
        Шаги по текущим оценкам критериев. При спорной оценке сначала проверьте обоснование; примеры
        фраз адаптируйте к ситуации.
      </p>
      {error ? (
        <div role="alert" className="notice notice-error">
          Не удалось загрузить рекомендации.{' '}
          <button className="button secondary" onClick={() => setReload((x) => x + 1)}>
            Повторить
          </button>
        </div>
      ) : !result ? (
        <p role="status">Загружаем рекомендации…</p>
      ) : !result.items.length ? (
        <p>По применимым критериям замечаний нет.</p>
      ) : (
        result.items.map((item) => (
          <article className="coaching-item" key={item.criterionId}>
            <h4>
              {item.title}
              {item.priority === 'high' ? ' · требует внимания руководителя' : ''}
            </h4>
            <p className="muted">Основание оценки: {item.basis}</p>
            <p>{item.action}</p>
            {item.example && (
              <div className="coaching-example">
                <strong>Пример формулировки</strong>
                <p>{item.example}</p>
              </div>
            )}
            {item.evidence.map((m) => (
              <button className="coaching-quote" key={m.id} onClick={() => onEvidence(m.id)}>
                <span>{m.timestamp} · к реплике</span>
                <q>{m.text}</q>
              </button>
            ))}
            {item.knowledgeReferences.length > 0 && (
              <p className="muted">
                Правила: {item.knowledgeReferences.map((r) => '[' + r + ']').join(', ')} — см.
                выдержки ниже.
              </p>
            )}
          </article>
        ))
      )}
      <details className="knowledge-context">
        <summary>Регламенты для этой оценки</summary>
        <KnowledgeSources snapshot={evaluation.knowledge} />
      </details>
    </section>
  );
}
