import { useEffect, useRef, useState } from 'react';
import { Select } from './components/ui/select';
import type {
  Appeal,
  ChecklistVersion,
  Criterion,
  CriterionAnswer,
  DecisionInput,
  Evaluation,
  ScoreResponse,
} from '../../shared/contracts.js';
import { api, appealErrorMessage } from './api';
import { answerLabel, appealStatusLabel, scoreLabel } from './review-format';
import { buildDecision, buildPreviewRequest } from './appeal-preview';
import { ActionButton } from './ActionButton';

type History = { status: 'loading' | 'error' } | { status: 'ready'; items: Appeal[] };

export function useEvaluationAppeals(evaluationId: string) {
  const [history, setHistory] = useState<History>({ status: 'loading' });
  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    api.appeals(signal, evaluationId).then(
      (items) => {
        if (!signal.aborted) setHistory({ status: 'ready', items: items.toReversed() });
      },
      () => {
        if (!signal.aborted) setHistory({ status: 'error' });
      },
    );
    return () => controller.abort();
  }, [evaluationId, loadKey]);

  function reload() {
    setHistory({ status: 'loading' });
    setLoadKey((key) => key + 1);
  }

  return { history, reload };
}

function useAppealAction(action: 'submit' | 'resolve') {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  async function run<T>(send: (signal: AbortSignal) => Promise<T>, onDone: (result: T) => void) {
    if (request.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    request.current = controller;
    setBusy(true);
    setError(null);
    try {
      const result = await send(signal);
      if (!signal.aborted) onDone(result);
    } catch (error) {
      if (!signal.aborted) setError(appealErrorMessage(error, action));
    } finally {
      request.current = null;
      if (!signal.aborted) setBusy(false);
    }
  }

  return { busy, error, run };
}

export function AppealForm({
  evaluationId,
  criterion,
  onCreated,
  onClose,
}: {
  evaluationId: string;
  criterion: Criterion;
  onCreated: (appeal: Appeal) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [comment, setComment] = useState('');
  const action = useAppealAction('submit');

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  function close() {
    dialog.current?.close();
    onClose();
  }
  return (
    <dialog
      className="appeal-dialog"
      ref={dialog}
      aria-labelledby="appeal-form-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!action.busy) close();
      }}
    >
      <h2 id="appeal-form-heading">Подать апелляцию</h2>
      <p className="muted">{criterion.title}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!comment.trim()) return;
          void action.run(
            (signal) =>
              api.submitAppeal(
                { evaluationId, criterionId: criterion.id, comment: comment.trim() },
                signal,
              ),
            (appeal) => {
              dialog.current?.close();
              onCreated(appeal);
            },
          );
        }}
      >
        <label className="field-label" htmlFor="appeal-comment">
          Комментарий к критерию
        </label>
        <textarea
          id="appeal-comment"
          className="field"
          rows={4}
          maxLength={10000}
          required
          autoFocus
          value={comment}
          disabled={action.busy}
          onChange={(event) => setComment(event.currentTarget.value)}
        />
        {action.error && (
          <p className="form-error" role="alert">
            {action.error}
          </p>
        )}
        <div className="form-actions">
          <button className="button secondary" type="button" disabled={action.busy} onClick={close}>
            Отмена
          </button>
          <ActionButton
            icon="appeals"
            variant="primary"
            type="submit"
            disabled={action.busy || !comment.trim()}
          >
            {action.busy ? 'Отправляем…' : 'Отправить апелляцию'}
          </ActionButton>
        </div>
      </form>
    </dialog>
  );
}

export function AppealHistory({
  history,
  checklist,
  selectedId,
  onSelect,
  onReload,
}: {
  history: History;
  checklist: ChecklistVersion;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onReload: () => void;
}) {
  if (history.status === 'loading') return null;
  if (history.status === 'error') {
    return (
      <div className="notice" role="alert">
        <p>Не удалось загрузить историю апелляций.</p>
        <button className="button secondary" type="button" onClick={onReload}>
          Повторить
        </button>
      </div>
    );
  }
  if (history.status !== 'ready') return null;
  const { items } = history;

  return (
    <>
      {selectedId && !items.some((appeal) => appeal.id === selectedId) && (
        <p className="notice" role="alert">
          Апелляция для этой оценки не найдена.
        </p>
      )}
      {items.length > 0 && (
        <section className="appeal-history" aria-labelledby="appeal-history-heading">
          <h3 id="appeal-history-heading">История апелляций</h3>
          <ul>
            {items.map((appeal) => (
              <li key={appeal.id}>
                <button
                  id={`appeal-entry-${appeal.id}`}
                  className="appeal-history-row"
                  type="button"
                  aria-pressed={selectedId === appeal.id}
                  onClick={() => onSelect(selectedId === appeal.id ? null : appeal.id)}
                >
                  <span>
                    {checklist.criteria.find((criterion) => criterion.id === appeal.criterionId)
                      ?.title ?? 'Критерий недоступен'}
                  </span>
                  <span className={`status appeal-${appeal.status}`}>
                    {appealStatusLabel[appeal.status]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function AppealReview({
  appeal,
  criterion,
  evaluation,
  onResolved,
  onClose,
  onReload,
}: {
  appeal: Appeal;
  criterion: Criterion;
  evaluation?: Evaluation;
  onResolved: (evaluation: Evaluation) => void;
  onClose?: () => void;
  onReload: () => void;
}) {
  const review = useRef<HTMLElement>(null);

  useEffect(() => {
    review.current?.focus({ preventScroll: true });
    review.current?.scrollIntoView({ block: 'nearest' });
  }, [appeal.id]);

  return (
    <section
      className="appeal-review"
      aria-labelledby="appeal-review-heading"
      tabIndex={-1}
      ref={review}
    >
      <div className="title-row">
        <h3 id="appeal-review-heading">Апелляция</h3>
        {onClose && (
          <button type="button" className="button secondary" onClick={onClose}>
            Свернуть
          </button>
        )}
      </div>
      <p className="appeal-criterion">{criterion.title}</p>
      <p className="appeal-comment">{appeal.comment}</p>
      {appeal.status === 'pending' ? (
        <>
          <p className="muted">
            Ответ по критерию · {answerLabel(criterion, appeal.beforeAnswer.value)}
          </p>
          <DecisionForm
            appeal={appeal}
            criterion={criterion}
            evaluation={evaluation}
            onResolved={onResolved}
            onReload={onReload}
          />
        </>
      ) : (
        <>
          <p className="appeal-criterion">
            {appeal.decision === 'change' ? 'Ответ изменён' : 'Ответ подтверждён'}
          </p>
          <p className="appeal-comment">{appeal.reason}</p>
          <dl className="appeal-result">
            <div>
              <dt>До решения</dt>
              <dd>{scoreLabel(appeal.scoreBefore)}</dd>
              <dd>{answerLabel(criterion, appeal.beforeAnswer.value)}</dd>
            </div>
            <div>
              <dt>После решения</dt>
              <dd>{scoreLabel(appeal.scoreAfter)}</dd>
              <dd>{appeal.afterAnswer ? answerLabel(criterion, appeal.afterAnswer.value) : '—'}</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}

function DecisionForm({
  appeal,
  criterion,
  evaluation,
  onResolved,
  onReload,
}: {
  appeal: Appeal;
  criterion: Criterion;
  evaluation?: Evaluation;
  onResolved: (evaluation: Evaluation) => void;
  onReload: () => void;
}) {
  const [decision, setDecision] = useState<DecisionInput['decision']>('confirm');
  const [replacement, setReplacement] = useState(0);
  const [evidenceIds, setEvidenceIds] = useState('');
  const [checkedIds, setCheckedIds] = useState('');
  const [reason, setReason] = useState('');
  const action = useAppealAction('resolve');
  const values: CriterionAnswer['value'][] =
    criterion.answerType === 'binary' ? [true, false] : [...criterion.levels];
  if (criterion.allowNA) values.push('NA');
  const replacements = values.filter((value) => value !== appeal.beforeAnswer.value);
  const body = buildDecision(criterion, decision, replacements[replacement], reason);
  const previewKey = JSON.stringify([
    evaluation?.id,
    decision,
    replacements[replacement],
    reason.trim(),
    evaluation?.effectiveAnswers,
  ]);
  const [preview, setPreview] = useState<{
    key: string;
    status: 'loading' | 'ready' | 'error';
    score?: ScoreResponse;
  } | null>(null);
  useEffect(() => {
    if (!evaluation || decision !== 'change' || !body) return;
    const controller = new AbortController();
    setPreview({ key: previewKey, status: 'loading' });
    const timer = window.setTimeout(() => {
      api
        .scorePreview(buildPreviewRequest(evaluation, appeal.criterionId, body), controller.signal)
        .then(
          (score) => {
            if (!controller.signal.aborted) setPreview({ key: previewKey, status: 'ready', score });
          },
          () => {
            if (!controller.signal.aborted) setPreview({ key: previewKey, status: 'error' });
          },
        );
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [previewKey]);

  return (
    <form
      className="decision-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!body) return;
        const payload: DecisionInput = evaluation?.policyVersion
          ? {
              ...body,
              expectedRevision: evaluation.revision ?? 0,
              ...(body.decision === 'change'
                ? {
                    replacementAnswer: {
                      criterionId: criterion.id,
                      value: body.replacementValue,
                      explanation: reason,
                      evidenceMessageIds: evidenceIds.split(/[\s,]+/).filter(Boolean),
                      checkedSpanMessageIds: checkedIds.split(/[\s,]+/).filter(Boolean),
                      naReason: body.replacementValue === 'NA' ? reason : null,
                    },
                  }
                : {}),
            }
          : body;
        void action.run((signal) => api.resolveAppeal(appeal.id, payload, signal), onResolved);
      }}
    >
      <fieldset disabled={action.busy}>
        <legend>Решение проверяющего</legend>
        <label>
          <input
            type="radio"
            name="appeal-decision"
            checked={decision === 'confirm'}
            onChange={() => setDecision('confirm')}
          />{' '}
          Оставить ответ
        </label>
        <label>
          <input
            type="radio"
            name="appeal-decision"
            checked={decision === 'change'}
            onChange={() => setDecision('change')}
          />{' '}
          Изменить ответ
        </label>
      </fieldset>
      {decision === 'change' && (
        <>
          <label className="field-label" htmlFor="replacement-answer">
            Новое значение
          </label>
          <Select
            id="replacement-answer"
            className="field"
            value={String(replacement)}
            disabled={action.busy}
            onValueChange={(value) => setReplacement(Number(value))}
            options={replacements.map((value, index) => ({
              value: String(index),
              label: answerLabel(criterion, value),
            }))}
          />
        </>
      )}
      {decision === 'change' && evaluation?.policyVersion && (
        <>
          <label className="field-label">
            Доказательства · ID реплик
            <input
              className="field"
              value={evidenceIds}
              onChange={(e) => setEvidenceIds(e.target.value)}
            />
          </label>
          <label className="field-label">
            Проверенный участок · ID реплик
            <input
              className="field"
              value={checkedIds}
              onChange={(e) => setCheckedIds(e.target.value)}
            />
          </label>
        </>
      )}
      <label className="field-label" htmlFor="appeal-reason">
        Причина решения
      </label>
      <textarea
        id="appeal-reason"
        className="field"
        rows={3}
        maxLength={10000}
        required
        value={reason}
        disabled={action.busy}
        onChange={(event) => setReason(event.currentTarget.value)}
      />
      {action.error && (
        <div className="form-error" role="alert">
          <p>{action.error}</p>
          <button className="button secondary" type="button" onClick={onReload}>
            Обновить историю
          </button>
        </div>
      )}
      {decision === 'change' && body && evaluation && (
        <div className="decision-preview" role="status">
          <span>Предпросмотр итога · ещё не сохранён</span>
          {preview?.key === previewKey && preview.status === 'ready' ? (
            <strong>{scoreLabel(preview.score ?? null)}</strong>
          ) : (
            <p>
              {preview?.key === previewKey && preview.status === 'error'
                ? 'Не удалось рассчитать предпросмотр. Решение можно сохранить без него.'
                : 'Рассчитываем итог…'}
            </p>
          )}
        </div>
      )}
      <div className="form-actions">
        <ActionButton icon="check" variant="primary" type="submit" disabled={action.busy || !body}>
          {action.busy ? 'Сохраняем…' : 'Сохранить решение'}
        </ActionButton>
      </div>
    </form>
  );
}
