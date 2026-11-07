import { lazy, Suspense, useEffect, useState } from 'react';
import type { ChecklistVersion } from '../../shared/contracts.js';
import { request } from './api';
import { useProfiles } from './use-profiles';
import { AnimatedNumber } from './AnimatedNumber';
import type { ChartPoint } from './components/ui/chart-line';
const ChartLine = lazy(() =>
  import('./components/ui/chart-line').then((module) => ({ default: module.ChartLine })),
);
import { Icon } from './Icon';
import { Select } from './components/ui/select';
import type { CSSProperties } from 'react';
type Overview = {
  channels?: { chats: number; calls: number };
  trend?: ChartPoint[];
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
  const profiles = useProfiles();
  const [selectedVersion, setVersion] = useState<string | null>(null),
    [data, setData] = useState<Overview | null>(null),
    [error, setError] = useState(false),
    [refresh, setRefresh] = useState(0);
  const activeProfile = profiles.profiles.find((p) => p.id === 'legacy');
  const version =
    selectedVersion ??
    (profiles.status === 'ready' && checklists.some((v) => v.id === activeProfile?.activeVersionId)
      ? activeProfile!.activeVersionId
      : '');
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setError(false);
    if (!version) return () => c.abort();
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
  const maximumLoss = Math.max(1, ...(data?.losses.map((loss) => loss.points) ?? []));
  const completed = data?.coverage.completed ?? 0;
  const total = data?.coverage.conversations ?? 0;
  const coverage = total ? Math.round((completed / total) * 100) : 0;
  const fillStyle = (percent: number) =>
    ({ '--fill': `${Math.max(0, Math.min(100, percent))}%` }) as CSSProperties;
  return (
    <main id="main-content" className="page-content overview-page" tabIndex={-1}>
      <header className="page-heading">
        <div>
          <h1>Обзор качества</h1>
          <p className="page-description">Последняя оценка каждого диалога по выбранной версии.</p>
        </div>
        <div className="overview-actions">
          <label className="overview-version">
            <span className="sr-only">Версия чек-листа</span>
            <Select
              className="field"
              aria-label="Версия чек-листа"
              placeholder="Выберите версию"
              value={version}
              onValueChange={setVersion}
              options={checklists.map((v) => ({
                value: v.id,
                label: `${v.title} · v${v.version}`,
              }))}
            />
          </label>
          <button className="button secondary" onClick={() => setRefresh((n) => n + 1)}>
            <Icon name="refresh" size={18} />
            Обновить
          </button>
        </div>
      </header>
      {profiles.status === 'error' && (
        <div className="notice notice-error" role="alert">
          Не удалось загрузить активный чек-лист. Выберите версию явно или повторите загрузку.{' '}
          <button className="button secondary" onClick={profiles.reload}>
            Повторить загрузку профилей
          </button>
        </div>
      )}
      {!version && profiles.status === 'ready' && (
        <p className="notice">Активный чек-лист не выбран. Выберите версию для обзора.</p>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          Не удалось загрузить обзор. Попробуйте обновить страницу.
        </div>
      )}
      {!data && !error && (version || profiles.status === 'loading') && (
        <div className="panel empty-state" role="status">
          <span className="loading-ring" aria-hidden="true" />
          Загрузка обзора…
        </div>
      )}
      {data && (
        <div className="overview-grid">
          <section className="panel overview-score">
            <div className="score-comparison">
              <div>
                <h2 className="metric-label">Итоговый средний балл</h2>
                <div className="overview-number">
                  <AnimatedNumber value={data.effective.average} decimals={1} />
                  <span className="metric-unit">/100</span>
                </div>
              </div>
              <div className="original-average">
                <h3 className="metric-label">Исходный средний балл</h3>
                <div className="original-number">
                  <AnimatedNumber value={data.original.average} decimals={1} />
                  <span className="metric-unit">/100</span>
                </div>
                <p className="muted">До решений проверяющего</p>
              </div>
            </div>
            <Suspense fallback={<div className="score-chart-empty">Загрузка графика…</div>}>
              <ChartLine data={data.trend ?? []} />
            </Suspense>
            <p className="score-explanation">
              Средний итог рассчитан по {data.effective.denominator} завершённым оценкам. Ошибки и
              обязательная проверка не считаются нулём.
            </p>
          </section>
          <section className="panel overview-coverage">
            <h2>Диалоги</h2>
            {data.channels && (
              <p className="channel-summary">
                <span>
                  <Icon name="dialogs" size={16} />
                  Чаты <strong>{data.channels.chats}</strong>
                </span>
                <span>
                  <Icon name="phone" size={16} />
                  Звонки <strong>{data.channels.calls}</strong>
                </span>
              </p>
            )}
            <dl className="coverage-list">
              <div>
                <dd>
                  <AnimatedNumber value={total} />
                </dd>
                <dt>всего диалогов</dt>
              </div>
              <div>
                <dd>
                  <AnimatedNumber value={completed} />
                </dd>
                <dt>
                  <i className="metric-dot success" />
                  Завершено
                </dt>
              </div>
              <div>
                <dd>
                  <AnimatedNumber value={data.coverage.reviewRequired} />
                </dd>
                <dt>
                  <i className="metric-dot warning" />
                  Нужна проверка
                </dt>
              </div>
              <div>
                <dd>
                  <AnimatedNumber value={data.grossViolations} />
                </dd>
                <dt>
                  <i className="metric-dot danger" />
                  Грубые нарушения
                </dt>
              </div>
              <div>
                <dd>
                  <AnimatedNumber value={data.coverage.unassessedConversations} />
                </dd>
                <dt>
                  <i className="metric-dot" />
                  Без оценки
                </dt>
              </div>
            </dl>
            <div className="coverage-footer">
              <div>
                <h3>Завершённые оценки</h3>
                <span>
                  <strong>{completed}</strong> / {total}
                </span>
              </div>
              <div
                className="meter-track"
                role="meter"
                aria-label="Доля завершённых оценок"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={coverage}
              >
                <span style={fillStyle(coverage)} />
              </div>
            </div>
          </section>
          <section className="panel overview-losses">
            <h2>Основные причины потерь</h2>
            <p className="muted">Суммарные потери по завершённым оценкам</p>
            {data.losses.length ? (
              <ol className="loss-chart">
                {data.losses.map((loss) => (
                  <li key={loss.criterionId}>
                    <div className="loss-label">
                      <span>
                        {checklists
                          .find((v) => v.id === version)
                          ?.criteria.find((c) => c.id === loss.criterionId)?.title ??
                          loss.criterionId}
                      </span>
                      <span className="muted">Оценок: {loss.count}</span>
                    </div>
                    <div className="loss-value">
                      <div className="meter-track" aria-hidden="true">
                        <span style={fillStyle((loss.points / maximumLoss) * 100)} />
                      </div>
                      <strong>
                        <AnimatedNumber value={loss.points} decimals={1} />
                        <small> балла</small>
                      </strong>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="overview-empty">
                <Icon name="check" size={24} />
                <p>В завершённых оценках потерь нет.</p>
              </div>
            )}
          </section>
          <section className="panel overview-attention">
            <h2>Требуют внимания</h2>
            <p className="muted">Проверка и состояние обработки</p>
            <a className="attention-row" href="/review">
              <span className="attention-icon">
                <Icon name="shield" />
              </span>
              <span>
                <strong>Обязательная проверка</strong>
                <small>Разобрать предварительные ответы</small>
              </span>
              <b>
                <AnimatedNumber value={data.coverage.reviewRequired} />
              </b>
              <Icon name="next" size={18} />
            </a>
            <dl className="processing-list">
              <div>
                <dt>В очереди</dt>
                <dd>{data.coverage.queued}</dd>
              </div>
              <div>
                <dt>Выполняется</dt>
                <dd>{data.coverage.running}</dd>
              </div>
              <div>
                <dt>Не завершены</dt>
                <dd>{data.coverage.failed}</dd>
              </div>
            </dl>
            <div className="overview-links">
              <a href="/review">
                Проверить спорные оценки <Icon name="next" size={16} />
              </a>
              <a href="/dialogs">
                Открыть диалоги <Icon name="next" size={16} />
              </a>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
