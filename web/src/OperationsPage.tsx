import { useEffect, useState } from 'react';
import type { Evaluation } from '../../shared/contracts.js';
import type { CostSummary, EvaluationComparison } from '../../shared/diagnostics.js';
import { api, request } from './api';
import { numbers } from './review-format';
export function Diagnostics({ evaluation }: { evaluation: Evaluation }) {
  const [data, setData] = useState<{ cost: CostSummary; cacheReceipts: unknown[] } | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(false);
    request<{ cost: CostSummary; cacheReceipts: unknown[] }>(
      `/evaluations/${encodeURIComponent(evaluation.id)}/diagnostics`,
      { signal: controller.signal },
    ).then(
      (d) => {
        if (!controller.signal.aborted) setData(d);
      },
      () => {
        if (!controller.signal.aborted) setError(true);
      },
    );
    return () => controller.abort();
  }, [evaluation.id, evaluation.status]);
  return (
    <details className="diagnostics">
      <summary>Диагностика оценки</summary>
      <dl className="metadata-grid">
        <dt>Модель</dt>
        <dd>
          {evaluation.providerId} / {evaluation.modelId}
        </dd>
        <dt>Промпт</dt>
        <dd>{evaluation.promptVersion}</dd>
        <dt>Вызовы</dt>
        <dd>{evaluation.attempts.length}</dd>
        <dt>Стоимость</dt>
        <dd>
          {data
            ? data.cost.complete && data.cost.total !== null
              ? `${data.cost.total.toFixed(6)} ${data.cost.currency ?? ''} · расчётная`
              : `Неизвестна полностью · ${data.cost.unknownAttempts} попыток без цены/usage`
            : error
              ? 'Не удалось загрузить'
              : 'Загрузка…'}
        </dd>
        <dt>Повторных использований</dt>
        <dd>{data?.cacheReceipts.length ?? '—'} · без нового вызова</dd>
      </dl>
      <ol>
        {evaluation.attempts.map((a) => (
          <li key={a.number}>
            #{a.number} · {a.status} ·{' '}
            {a.durationMs === null ? '—' : `${numbers.format(a.durationMs / 1000)} с`} ·{' '}
            {a.errorCode ?? a.finishReason ?? '—'}
            <br />
            <span className="muted">
              Вход {a.usage.inputTokens ?? '?'} · выход {a.usage.outputTokens ?? '?'} · reasoning{' '}
              {a.usage.thinkingTokens ?? '?'}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
export function EvaluationComparisonView({
  evaluation,
  items,
}: {
  evaluation: Evaluation;
  items: Evaluation[];
}) {
  const [right, setRight] = useState(''),
    [data, setData] = useState<EvaluationComparison | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    setData(null);
    setError(false);
    if (!right) return;
    const controller = new AbortController();
    request<EvaluationComparison>(
      `/evaluation-comparisons?${new URLSearchParams({ left: evaluation.id, right })}`,
      { signal: controller.signal },
    ).then(
      (d) => {
        if (!controller.signal.aborted) setData(d);
      },
      () => {
        if (!controller.signal.aborted) setError(true);
      },
    );
    return () => controller.abort();
  }, [evaluation.id, right]);
  return (
    <details className="diagnostics">
      <summary>Сравнить прогоны</summary>
      <label>
        Второй прогон
        <select className="field" value={right} onChange={(e) => setRight(e.target.value)}>
          <option value="">Выберите оценку</option>
          {items
            .filter((e) => e.id !== evaluation.id && e.conversationId === evaluation.conversationId)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.modelId} · {e.createdAt} · {e.status}
              </option>
            ))}
        </select>
      </label>
      {error && (
        <p role="alert">Не удалось сравнить оценки. Проверьте, что текст диалога совпадает.</p>
      )}
      {data && (
        <>
          <p>
            Разница итогов: {data.effective.totalDelta ?? 'нет двух итоговых баллов'}.{' '}
            {!data.sameChecklistVersion &&
              'Разные версии чек-листа: баллы не полностью сопоставимы.'}
          </p>
          {(['original', 'effective'] as const).map((kind) => (
            <section key={kind}>
              <h3>{kind === 'original' ? 'Исходные ответы модели' : 'Ответы после решений'}</h3>
              <ul>
                {data[kind].answers
                  .filter((a) => a.changed)
                  .map((a) => (
                    <li key={a.criterionId}>
                      {a.criterionId}: {String(a.left?.value ?? 'нет')} →{' '}
                      {String(a.right?.value ?? 'нет')}
                    </li>
                  ))}
              </ul>
              {!data[kind].answers.some((a) => a.changed) && <p>Различий нет.</p>}
            </section>
          ))}
        </>
      )}
    </details>
  );
}
export function OperationsPage() {
  const [items, setItems] = useState<Evaluation[] | null>(null),
    [error, setError] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setError(false);
    api.evaluations(null, c.signal).then(
      (x) => {
        if (!c.signal.aborted) setItems(x);
      },
      () => {
        if (!c.signal.aborted) setError(true);
      },
    );
    return () => c.abort();
  }, [refresh]);
  return (
    <main id="main-content" className="page-content" tabIndex={-1}>
      <header className="page-heading">
        <h1>Операции</h1>
        <button className="button secondary" onClick={() => setRefresh((n) => n + 1)}>
          Обновить
        </button>
      </header>
      <p className="muted">
        История вызовов и неполных расходов. Это расчёт по тарифам, а не счёт провайдера.
      </p>
      {error && <p role="alert">Не удалось загрузить задания.</p>}
      {!items && !error && <p>Загрузка…</p>}
      {items?.length === 0 && <div className="panel empty-state">Заданий пока нет.</div>}
      <div className="operations-list">
        {items?.slice(0, 100).map((e) => (
          <section className="panel" key={e.id}>
            <h2>
              <a
                href={`/dialogs/${encodeURIComponent(e.conversationId)}?evaluation=${encodeURIComponent(e.id)}`}
              >
                {e.error?.code === 'REVIEW_REQUIRED' ? 'Нужна проверка' : e.status} · {e.modelId}
              </a>
            </h2>
            <p className="muted">{e.createdAt}</p>
            <Diagnostics evaluation={e} />
          </section>
        ))}
      </div>
      {items && items.length > 100 && <p>Показаны последние 100 заданий.</p>}
    </main>
  );
}
