import { useState } from 'react';
import type {
  ChecklistVersion,
  Conversation,
  Criterion,
  CriterionAnswer,
  CriterionEvidence,
  Evaluation,
  Message,
  ScoreSummary,
} from '../../shared/contracts.js';
import { useEvaluation } from './use-evaluation';

const evaluationLabel: Record<Evaluation['status'], string> = {
  queued: 'В очереди',
  running: 'Оценка выполняется',
  completed: 'Оценка готова',
  failed: 'Ошибка оценки',
};

const numbers = new Intl.NumberFormat('ru', { maximumFractionDigits: 2 });

function points(value: number | null, maximum: number | null) {
  return value !== null && maximum !== null
    ? `${numbers.format(value)} / ${numbers.format(maximum)}`
    : null;
}

function answerLabel(criterion: Criterion, value: CriterionAnswer['value']) {
  if (value === 'NA') return 'Не применимо';
  if (criterion.scoringMode === 'flag') return value ? 'Нарушение' : 'Без нарушения';
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  return numbers.format(value);
}

function isRevised(original?: CriterionAnswer, current?: CriterionAnswer) {
  return (
    original &&
    current &&
    (original.value !== current.value ||
      original.explanation !== current.explanation ||
      original.naReason !== current.naReason)
  );
}

export function EvaluationPanel({
  conversation,
  checklists,
  requestedId,
  onSelect,
  onEvidence,
}: {
  conversation: Conversation;
  checklists: ChecklistVersion[];
  requestedId: string | null;
  onSelect: (id: string | null) => void;
  onEvidence: (messageId: string, evaluationId: string) => void;
}) {
  const [preferredVersion, setPreferredVersion] = useState<string | null>(null);
  const review = useEvaluation(conversation.id, requestedId, preferredVersion, onSelect);
  const evaluation = review.current;
  const checklistId =
    evaluation?.checklistVersionId ??
    preferredVersion ??
    (checklists.find((checklist) => checklist.checklistId === 'default') ?? checklists[0])?.id;
  const checklist = checklists.find((checklist) => checklist.id === checklistId);
  const attempts = review.items.filter((item) => item.checklistVersionId === checklistId);
  const retry =
    evaluation?.status === 'failed'
      ? attempts.find((item) => item.retryOfId === evaluation.id && item.status !== 'failed')
      : undefined;
  const missingEvaluation = review.history === 'ready' && requestedId && !evaluation;
  const completed = evaluation?.status === 'completed';

  function selectEvaluation(id: string | null) {
    review.clearStartError();
    onSelect(id);
  }

  return (
    <section
      id="evaluation-panel"
      className="panel evaluation-panel"
      aria-labelledby="evaluation-heading"
    >
      <div className="panel-header evaluation-header">
        <div className="title-row">
          <h2 id="evaluation-heading">Проверка</h2>
          {evaluation && (
            <span className={`status status-${evaluation.status}`} role="status">
              {evaluationLabel[evaluation.status]}
            </span>
          )}
        </div>
        {checklists.length > 0 && (
          <div className="field-label">
            <label htmlFor="checklist-version">Чек-лист</label>
            <select
              id="checklist-version"
              className="field"
              value={checklistId ?? ''}
              disabled={review.history !== 'ready' || review.submitting}
              onChange={(event) => {
                setPreferredVersion(event.currentTarget.value);
                selectEvaluation(null);
              }}
            >
              {!checklist && <option value={checklistId}>Версия недоступна</option>}
              {checklists.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · версия {item.version}
                </option>
              ))}
            </select>
          </div>
        )}
        {attempts.length > 1 && evaluation && (
          <div className="field-label">
            <label htmlFor="saved-evaluation">Сохранённая оценка</label>
            <select
              id="saved-evaluation"
              className="field"
              value={evaluation.id}
              disabled={review.submitting}
              onChange={(event) => selectEvaluation(event.currentTarget.value)}
            >
              {attempts.map((item, index) => (
                <option key={item.id} value={item.id}>
                  {attempts.length - index} · {evaluationLabel[item.status]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="panel-scroll evaluation-scroll">
        {review.history === 'loading' && (
          <p className="muted panel-note" role="status">
            Загружаем оценку…
          </p>
        )}
        {review.history === 'error' && (
          <div className="notice" role="alert">
            <p>Не удалось загрузить оценки диалога.</p>
            <button className="button secondary" onClick={review.reload}>
              Повторить
            </button>
          </div>
        )}
        {review.history === 'ready' && (
          <>
            {review.startError && (
              <p className="notice notice-error" role="alert">
                {review.startError}
              </p>
            )}
            {missingEvaluation && (
              <div className="notice" role="alert">
                <p>Сохранённая оценка не найдена для этого диалога.</p>
                <button className="button secondary" onClick={() => selectEvaluation(null)}>
                  Открыть последнюю
                </button>
              </div>
            )}
            {!checklist && <p className="notice">Чек-лист для проверки недоступен.</p>}
            {!missingEvaluation && !evaluation && checklist && (
              <div className="run-card">
                <p>Диалог ещё не оценён.</p>
                <button
                  className="button primary"
                  disabled={review.submitting}
                  onClick={() => void review.run(checklist.id)}
                >
                  {review.submitting ? 'Запускаем оценку…' : 'Запустить оценку'}
                </button>
              </div>
            )}
            {review.pollBlocked && (
              <div className="notice" role="alert">
                <p>Не удалось обновить статус оценки.</p>
                <button className="button secondary" onClick={review.resumePoll}>
                  Проверить статус
                </button>
              </div>
            )}
            {evaluation?.status === 'failed' && checklist && (
              <div className="notice notice-error">
                <p>Оценка не завершилась.</p>
                {retry ? (
                  <button className="button secondary" onClick={() => selectEvaluation(retry.id)}>
                    Открыть повторную оценку
                  </button>
                ) : (
                  <button
                    className="button secondary"
                    disabled={review.submitting}
                    onClick={() => void review.run(checklist.id, evaluation.id)}
                  >
                    {review.submitting ? 'Запускаем оценку…' : 'Повторить оценку'}
                  </button>
                )}
              </div>
            )}
            {completed && evaluation.finalScore && (
              <ScoreCard evaluation={evaluation} score={evaluation.finalScore} />
            )}
            {checklist && !missingEvaluation && (
              <Criteria
                key={`${checklist.id}:${evaluation?.id ?? ''}:${completed}`}
                checklist={checklist}
                evaluation={completed ? evaluation : undefined}
                onEvidence={(messageId) => {
                  if (evaluation) onEvidence(messageId, evaluation.id);
                }}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}

function ScoreCard({ evaluation, score }: { evaluation: Evaluation; score: ScoreSummary }) {
  const revised = evaluation.effectiveAnswers.some((answer) =>
    isRevised(
      evaluation.originalAnswers.find((original) => original.criterionId === answer.criterionId),
      answer,
    ),
  );
  const original = evaluation.originalScore?.total;

  return (
    <div className="score-card">
      <div className="score-heading">Итоговый балл</div>
      {score.total !== null ? (
        <div className="score-number">
          {numbers.format(score.total)}
          <span>%</span>
        </div>
      ) : (
        <p className="score-empty">Нет применимых критериев</p>
      )}
      {revised && original !== undefined && (
        <p className="muted">
          Исходный балл {original === null ? '—' : `${numbers.format(original)}%`}
        </p>
      )}
      {score.grossViolation && (
        <p className="violation" role="status">
          Грубое нарушение
        </p>
      )}
    </div>
  );
}

function Criteria({
  checklist,
  evaluation,
  onEvidence,
}: {
  checklist: ChecklistVersion;
  evaluation?: Evaluation;
  onEvidence: (id: string) => void;
}) {
  const score = evaluation?.finalScore;

  return (
    <div className="criteria">
      {checklist.sections.map((section, sectionIndex) => {
        const criteria = checklist.criteria.filter(
          (criterion) => criterion.sectionId === section.id,
        );
        const contribution = score?.sections.find((entry) => entry.sectionId === section.id);
        const sectionPoints = contribution
          ? points(contribution.points, contribution.maxPoints)
          : null;

        return (
          <section className="criteria-section" key={section.id}>
            <div className="criteria-heading">
              <h3>{section.title}</h3>
              {sectionPoints && <span title="Баллы по разделу">{sectionPoints}</span>}
            </div>
            {criteria.map((criterion, index) => (
              <CriterionRow
                key={criterion.id}
                criterion={criterion}
                answer={evaluation?.effectiveAnswers.find(
                  (answer) => answer.criterionId === criterion.id,
                )}
                original={evaluation?.originalAnswers.find(
                  (answer) => answer.criterionId === criterion.id,
                )}
                evidence={evaluation?.evidence.find((entry) => entry.criterionId === criterion.id)}
                contribution={score?.contributions.find(
                  (entry) => entry.criterionId === criterion.id,
                )}
                open={Boolean(evaluation) && sectionIndex === 0 && index === 0}
                onEvidence={onEvidence}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function CriterionRow({
  criterion,
  answer,
  original,
  evidence,
  contribution,
  open,
  onEvidence,
}: {
  criterion: Criterion;
  answer?: CriterionAnswer;
  original?: CriterionAnswer;
  evidence?: CriterionEvidence;
  contribution?: ScoreSummary['contributions'][number];
  open: boolean;
  onEvidence: (id: string) => void;
}) {
  const revised = isRevised(original, answer);
  const awarded = contribution && points(contribution.points, contribution.maxPoints);
  const isNegative = answer?.value === (criterion.scoringMode === 'flag' ? true : false);
  const directQuotes =
    evidence?.evidence.filter((message) => answer?.evidenceMessageIds.includes(message.id)) ?? [];
  const checked =
    evidence?.checkedSpan.filter((message) => answer?.checkedSpanMessageIds.includes(message.id)) ??
    [];

  return (
    <details className="criterion" open={open}>
      <summary className="criterion-summary">
        <span className="criterion-name">{criterion.title}</span>
        {answer ? (
          <span className={`answer${isNegative ? ' answer-negative' : ''}`}>
            {answerLabel(criterion, answer.value)}
          </span>
        ) : (
          criterion.scoringMode === 'weighted' && (
            <span className="weight">{numbers.format(criterion.weight)} б.</span>
          )
        )}
      </summary>
      <div className="criterion-detail">
        {answer ? (
          <>
            {awarded && <p className="criterion-points">{awarded} баллов</p>}
            {revised && original && (
              <p className="muted">Исходный ответ · {answerLabel(criterion, original.value)}</p>
            )}
            <p>{answer.explanation}</p>
            {answer.naReason && answer.naReason !== answer.explanation && (
              <p className="muted">{answer.naReason}</p>
            )}
            <Quotes title="Цитата из диалога" messages={directQuotes} onSelect={onEvidence} />
            <Quotes title="Проверенный фрагмент" messages={checked} onSelect={onEvidence} />
            {revised && evidence && (
              <Quotes
                title="Исходные доказательства"
                messages={[
                  ...new Map(
                    [...evidence.evidence, ...evidence.checkedSpan].map((message) => [
                      message.id,
                      message,
                    ]),
                  ).values(),
                ]}
                onSelect={onEvidence}
              />
            )}
          </>
        ) : (
          <>
            <p>{criterion.instruction}</p>
            {criterion.naRule && <p className="muted">{criterion.naRule}</p>}
          </>
        )}
      </div>
    </details>
  );
}

function Quotes({
  title,
  messages,
  onSelect,
}: {
  title: string;
  messages: Message[];
  onSelect: (id: string) => void;
}) {
  if (messages.length === 0) return null;

  return (
    <div className="quotes">
      <p className="quote-heading">{title}</p>
      {messages.map((message) => (
        <button key={message.id} className="quote-button" onClick={() => onSelect(message.id)}>
          <span className="quote-time">{message.timestamp}</span>
          <span className="quote-text">{message.text}</span>
          <span className="quote-arrow" aria-hidden="true">
            ↗
          </span>
        </button>
      ))}
    </div>
  );
}
