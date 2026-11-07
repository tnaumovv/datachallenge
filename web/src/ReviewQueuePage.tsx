import { useEffect, useState } from 'react';
import type {
  ChecklistVersion,
  Conversation,
  CriterionAnswer,
  Evaluation,
} from '../../shared/contracts.js';
import type { CandidateOutput, ReviewItem } from '../../shared/evaluation-policy.js';
import { post, request, RequestError } from './api';
import { Transcript } from './Transcript';
type ReviewDetail = {
  decisions?: { id: string; revision: number; createdAt: string; action: string; reason: string }[];
  item: ReviewItem;
  evaluation: Evaluation;
  conversation: Conversation;
  checklist: ChecklistVersion;
  runs: { id: string; stage: string; output: CandidateOutput | null }[];
};
const labels: Record<string, string> = {
  gross_violation: 'Грубое нарушение',
  unresolved: 'Недостаточно данных',
  verifier_disagreement: 'Модели не согласны',
  verifier_unavailable: 'Перепроверка недоступна',
  budget_exhausted: 'Лимит проверки исчерпан',
};
export function ReviewQueuePage() {
  const [items, setItems] = useState<ReviewItem[] | null>(null),
    [selected, setSelected] = useState(''),
    [detail, setDetail] = useState<ReviewDetail | null>(null),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  useEffect(() => {
    const c = new AbortController();
    setError('');
    request<ReviewItem[]>('/review-items?status=' + status + '&limit=100&offset=' + offset, {
      signal: c.signal,
    }).then(
      (x) => {
        if (!c.signal.aborted) setItems(x);
      },
      () => {
        if (!c.signal.aborted) setError('Не удалось загрузить очередь.');
      },
    );
    return () => c.abort();
  }, [refresh, status, offset]);
  useEffect(() => {
    setDetail(null);
    if (!selected) return;
    const c = new AbortController();
    request<ReviewDetail>(`/review-items/${encodeURIComponent(selected)}`, {
      signal: c.signal,
    }).then(
      (x) => {
        if (!c.signal.aborted) setDetail(x);
      },
      () => {
        if (!c.signal.aborted) setError('Не удалось загрузить материалы проверки.');
      },
    );
    return () => c.abort();
  }, [selected, refresh]);
  return (
    <main id="main-content" className="page-content" tabIndex={-1}>
      <header className="page-heading">
        <div>
          <h1>Очередь проверки</h1>
          <p className="muted">Предварительные ответы не входят в итоговые баллы.</p>
        </div>
        <button className="button secondary" onClick={() => setRefresh((n) => n + 1)}>
          Обновить
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {!items && !error && <p>Загрузка…</p>}
      {items?.filter((i) => i.status === status).length === 0 && (
        <div className="panel empty-state">В выбранном списке проверок нет.</div>
      )}
      <label>
        Состояние
        <select
          className="field"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as 'open' | 'resolved');
            setOffset(0);
            setSelected('');
          }}
        >
          <option value="open">Открытые</option>
          <option value="resolved">Завершённые</option>
        </select>
      </label>
      <div className="review-items">
        {items
          ?.filter((i) => i.status === status)
          .map((i) => (
            <button
              className="button secondary"
              aria-pressed={selected === i.id}
              key={i.id}
              onClick={() => setSelected(i.id)}
            >
              {i.reasons.map((r) => labels[r] ?? r).join(' · ')} · {i.createdAt}
            </button>
          ))}
      </div>
      <nav className="button-row" aria-label="Страницы очереди">
        <button
          className="button secondary"
          disabled={!offset}
          onClick={() => {
            setSelected('');
            setOffset((n) => Math.max(0, n - 100));
          }}
        >
          Назад
        </button>
        <span>Страница {Math.floor(offset / 100) + 1}</span>
        <button
          className="button secondary"
          disabled={!items || items.length < 100}
          onClick={() => {
            setSelected('');
            setOffset((n) => n + 100);
          }}
        >
          Далее
        </button>
      </nav>
      {selected && !detail && !error && <p>Загрузка материалов…</p>}
      {detail && (
        <div className="human-review-grid">
          <Transcript
            key={detail.conversation.id}
            conversation={detail.conversation}
            selectedMessageId={null}
          />
          <div>
            <HumanDecision
              key={`${detail.item.id}-${detail.item.revision}`}
              detail={detail}
              onSaved={() => {
                setSelected('');
                setRefresh((n) => n + 1);
              }}
            />
            {detail.item.status === 'resolved' && <ApprovePrecedent detail={detail} />}
          </div>
        </div>
      )}
    </main>
  );
}
export function HumanDecision({ detail, onSaved }: { detail: ReviewDetail; onSaved: () => void }) {
  const d = detail;
  const candidate = [...d.runs].reverse().find((r) => r.stage !== 'verifier' && r.output)?.output;
  const [answers, setAnswers] = useState<Record<string, CriterionAnswer>>(() =>
    Object.fromEntries(
      (
        candidate?.assessments.flatMap((a) => (a.status === 'resolved' ? [a.answer] : [])) ??
        d.evaluation.effectiveAnswers
      ).map((a) => [a.criterionId, structuredClone(a)]),
    ),
  );
  const [chosen, setChosen] = useState(() => new Set(Object.keys(answers)));
  const [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const ids = (text: string) => text.split(/[\s,]+/).filter(Boolean);
  function change(id: string, patch: Partial<CriterionAnswer>) {
    if (patch.value !== undefined) setChosen((current) => new Set([...current, id]));
    setAnswers((prev) => ({
      ...prev,
      [id]: Object.assign(
        {
          criterionId: id,
          value: false,
          explanation: '',
          evidenceMessageIds: [],
          checkedSpanMessageIds: [],
          naReason: null,
        },
        prev[id] ?? {},
        patch,
      ),
    }));
  }
  async function submit(action: 'resolve' | 'defer') {
    setBusy(true);
    setError('');
    try {
      await post(`/review-items/${encodeURIComponent(d.item.id)}/decisions`, {
        expectedRevision: d.evaluation.revision ?? 0,
        idempotencyKey,
        action,
        reason,
        ...(action === 'resolve'
          ? { answers: d.checklist.criteria.map((c) => answers[c.id]) }
          : {}),
      });
      onSaved();
    } catch (e) {
      setError(
        e instanceof RequestError && e.status === 409
          ? 'Результат изменился. Обновите очередь перед решением.'
          : 'Решение не сохранено. Проверьте ответы, причины и ссылки на реплики.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="evaluation-panel" className="panel human-decision">
      <h2>Решение проверяющего</h2>
      <p>Проверьте каждый ответ и его доказательства. N/A допустим только по правилу критерия.</p>
      {d.item.status === 'resolved' ? (
        <p>Проверка уже завершена.</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit('resolve');
          }}
        >
          {d.checklist.criteria.map((c) => {
            const a = answers[c.id];
            const unresolved = candidate?.assessments.find(
              (x) => x.status === 'unresolved' && x.criterionId === c.id,
            );
            return (
              <fieldset key={c.id} disabled={busy}>
                <legend>{c.title}</legend>
                <p className="muted">{c.instruction}</p>
                {unresolved?.status === 'unresolved' && (
                  <p className="notice">Не определено: {unresolved.explanation}</p>
                )}
                <label>
                  Ответ
                  <select
                    className="field"
                    required
                    value={a && chosen.has(c.id) ? String(a.value) : ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      change(c.id, {
                        value:
                          v === 'NA'
                            ? 'NA'
                            : v === 'true'
                              ? true
                              : v === 'false'
                                ? false
                                : Number(v),
                        naReason: v === 'NA' ? (a?.naReason ?? '') : null,
                      });
                    }}
                  >
                    <option value="" disabled>
                      Выберите ответ
                    </option>
                    {(c.answerType === 'binary' ? [true, false] : c.levels).map((v) => (
                      <option key={String(v)} value={String(v)}>
                        {typeof v === 'boolean' ? (v ? 'Да' : 'Нет') : v}
                      </option>
                    ))}
                    {c.allowNA && <option value="NA">N/A</option>}
                  </select>
                </label>
                <label>
                  Обоснование
                  <textarea
                    className="field"
                    required
                    value={a?.explanation ?? ''}
                    onChange={(e) => change(c.id, { explanation: e.target.value })}
                  />
                </label>
                <label>
                  Доказательства · ID реплик через пробел
                  <input
                    className="field"
                    defaultValue={a?.evidenceMessageIds.join(' ') ?? ''}
                    onChange={(e) => change(c.id, { evidenceMessageIds: ids(e.target.value) })}
                  />
                </label>
                <label>
                  Проверенный участок · ID реплик через пробел
                  <input
                    className="field"
                    defaultValue={a?.checkedSpanMessageIds.join(' ') ?? ''}
                    onChange={(e) => change(c.id, { checkedSpanMessageIds: ids(e.target.value) })}
                  />
                </label>
                {a?.value === 'NA' && (
                  <label>
                    Причина N/A · {c.naRule}
                    <textarea
                      className="field"
                      required
                      value={a.naReason ?? ''}
                      onChange={(e) => change(c.id, { naReason: e.target.value })}
                    />
                  </label>
                )}
              </fieldset>
            );
          })}
          <label>
            Причина решения
            <textarea
              className="field"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="button-row">
            <button
              className="button primary"
              disabled={
                busy ||
                !reason.trim() ||
                d.checklist.criteria.some((c) => !answers[c.id] || !chosen.has(c.id))
              }
            >
              {busy ? 'Сохраняем…' : 'Подтвердить проверенные ответы'}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy || !reason.trim()}
              onClick={() => void submit('defer')}
            >
              Отложить с причиной
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function ApprovePrecedent({ detail }: { detail: ReviewDetail }) {
  const [criterionId, setCriterionId] = useState(detail.checklist.criteria[0]?.id ?? ''),
    [example, setExample] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const decision = [...(detail.decisions ?? [])].reverse().find((d) => d.action === 'resolve');
  if (!decision) return null;
  async function approve() {
    setBusy(true);
    setMessage('');
    try {
      await post('/precedents', {
        decisionId: decision!.id,
        criterionId,
        example,
        actor: 'demo-reviewer',
      });
      setMessage(
        'Пример утверждён. Он будет доступен только при явно включённом использовании примеров.',
      );
    } catch {
      setMessage('Пример не сохранён. Проверьте обезличивание и наличие предыдущего утверждения.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="panel human-decision">
      <summary>Утвердить обучающий пример</summary>
      <p>
        Напишите короткий обезличенный пример. Не копируйте персональные данные и исходный диалог.
      </p>
      <label>
        Критерий
        <select
          className="field"
          value={criterionId}
          onChange={(e) => setCriterionId(e.target.value)}
        >
          {detail.checklist.criteria.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Обезличенный пример
        <textarea
          className="field"
          maxLength={1000}
          minLength={10}
          value={example}
          onChange={(e) => setExample(e.target.value)}
        />
      </label>
      <button
        className="button secondary"
        disabled={busy || example.trim().length < 10}
        onClick={() => void approve()}
      >
        Утвердить пример
      </button>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
