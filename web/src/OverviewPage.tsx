import { useEffect, useState } from 'react';
import type { ChecklistVersion } from '../../shared/contracts.js';
import { request } from './api';
type Overview = {
  grossViolations: number;
  losses: { criterionId: string; points: number; count: number }[];
  selection: { evaluationIds: string[] };
  coverage: {
    conversations: number;
    selected: number;
    unassessedConversations: number;
    completed: number;
    failed: number;
    queued: number;
    running: number;
    reviewRequired: number;
  };
  original: { average: number | null; denominator: number };
  effective: { average: number | null; denominator: number };
};
export function OverviewPage({ checklists }: { checklists: ChecklistVersion[] }) {
  const [version, setVersion] = useState(checklists[0]?.id ?? ''),
    [data, setData] = useState<Overview | null>(null),
    [error, setError] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setError(false);
    request<Overview>(
      `/overview?${new URLSearchParams(version ? { checklistVersionId: version } : {})}`,
      { signal: c.signal },
    ).then(
      (x) => {
        if (!c.signal.aborted) setData(x);
      },
      () => {
        if (!c.signal.aborted) setError(true);
      },
    );
    return () => c.abort();
  }, [version, refresh]);
  return (
    <main id="main-content" className="page-content" tabIndex={-1}>
      <header className="page-heading">
        <div>
          <h1>Обзор качества</h1>
          <p className="muted">Последняя оценка каждого диалога по выбранной версии.</p>
        </div>
        <button className="button secondary" onClick={() => setRefresh((n) => n + 1)}>
          Обновить
        </button>
      </header>
      <label>
        Версия чек-листа
        <select className="field" value={version} onChange={(e) => setVersion(e.target.value)}>
          {checklists.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title} · v{v.version}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">Не удалось загрузить обзор.</p>}
      {!data && !error && <p>Загрузка…</p>}
      {data && (
        <>
          <div className="overview-cards">
            {[
              ['Диалогов', data.coverage.conversations],
              ['Завершено', data.coverage.completed],
              ['Нужна проверка', data.coverage.reviewRequired],
              ['Грубые нарушения', data.grossViolations],
              ['Без оценки', data.coverage.unassessedConversations],
              ['Исходный средний балл', data.original.average?.toFixed(1) ?? '—'],
              ['Итоговый средний балл', data.effective.average?.toFixed(1) ?? '—'],
            ].map(([label, value]) => (
              <section className="panel metric-card" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </section>
            ))}
          </div>
          <p>
            Средний итог рассчитан по {data.effective.denominator} завершённым оценкам. Ошибки и
            обязательная проверка не считаются нулём.
          </p>
          <p>
            В очереди: {data.coverage.queued}. Выполняется: {data.coverage.running}. Не завершены:{' '}
            {data.coverage.failed}.
          </p>
          <section className="panel profiles-panel">
            <h2>Основные причины потерь</h2>
            {data.losses.length ? (
              <ol>
                {data.losses.map((loss) => (
                  <li key={loss.criterionId}>
                    {checklists
                      .find((v) => v.id === version)
                      ?.criteria.find((c) => c.id === loss.criterionId)?.title ?? loss.criterionId}
                    : {loss.points.toFixed(1)} балла суммарно · {loss.count} оценок
                  </li>
                ))}
              </ol>
            ) : (
              <p>В завершённых оценках потерь нет.</p>
            )}
          </section>
          <div className="button-row">
            <a className="button primary" href="/review">
              Проверить спорные оценки
            </a>
            <a className="button secondary" href="/dialogs">
              Открыть диалоги
            </a>
          </div>
        </>
      )}
    </main>
  );
}
