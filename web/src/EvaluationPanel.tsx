import { useProfiles } from './use-profiles';
import { Diagnostics, EvaluationComparisonView } from './OperationsPage';
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
import { AppealForm, AppealHistory, AppealReview, useEvaluationAppeals } from './EvaluationAppeals';
import { answerLabel, answerTone, numbers } from './review-format';
import { ActionButton } from './ActionButton';
import { Icon } from './Icon';

const evaluationLabel: Record<Evaluation['status'], string> = {
  queued: 'В очереди',
  running: 'Оценка выполняется',
  completed: 'Оценка готова',
  failed: 'Ошибка оценки',
};

function points(value: number | null, maximum: number | null) {
  return value !== null && maximum !== null
    ? `${numbers.format(value)} / ${numbers.format(maximum)}`
    : null;
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
  selectedMessageId = null,
  selectedAppealId,
  onSelectAppeal,
  onSelect,
  onEvidence,
}: {
  conversation: Conversation;
  checklists: ChecklistVersion[];
  requestedId: string | null;
  selectedMessageId?: string | null;
  selectedAppealId: string | null;
  onSelectAppeal: (evaluationId: string, appealId: string | null) => void;
  onSelect: (id: string | null) => void;
  onEvidence: (messageId: string, evaluationId: string) => void;
}) {
  const profiles = useProfiles();
  const activeProfile = profiles.profiles.find((p) => p.channels.includes(conversation.channel));
  const [preferredVersion, setPreferredVersion] = useState<string | null>(null);
  const review = useEvaluation(conversation.id, requestedId, preferredVersion, onSelect);
  const evaluation = review.current;
  const checklistId =
    evaluation?.checklistVersionId ??
    preferredVersion ??
    (profiles.status === 'ready' ? activeProfile?.activeVersionId : undefined);
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
      {evaluation &&
        activeProfile &&
        evaluation.checklistVersionId !== activeProfile.activeVersionId && (
          <p className="notice">
            Оценка по предыдущей версии. Для актуального результата выберите активный чек-лист и
            запустите новую оценку.
          </p>
        )}
      {profiles.status === 'loading' && <p role="status">Загружаем активный чек-лист…</p>}
      {profiles.status === 'error' && (
        <div className="notice notice-error" role="alert">
          Не удалось загрузить активный чек-лист. Выберите версию явно или повторите загрузку.{' '}
          <button className="button secondary" onClick={profiles.reload}>
            Повторить загрузку профилей
          </button>
        </div>
      )}
      <div className="panel-header evaluation-header">
        <div className="title-row">
          <h2 id="evaluation-heading">Оценка</h2>
          {evaluation && (
            <span className={`status status-${evaluation.status}`} role="status">
              {evaluation.error?.code === 'REVIEW_REQUIRED'
                ? 'Нужна проверка'
                : evaluationLabel[evaluation.status]}
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
              {!checklist && <option value={checklistId ?? ''}>Выберите версию явно</option>}
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
        {evaluation && (
          <p className="saved-evaluation-date">
            Сохранено{' '}
            {new Intl.DateTimeFormat('ru-RU', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Almaty',
            }).format(new Date(evaluation.createdAt))}
          </p>
        )}
        {completed && checklist && (
          <ActionButton
            icon="refresh"
            className="rerun-button"
            disabled={review.submitting}
            onClick={() => void review.run(checklist.id, undefined, true)}
          >
            {review.submitting ? 'Запускаем новую оценку…' : 'Оценить заново'}
          </ActionButton>
        )}
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
                <ActionButton
                  icon="play"
                  variant="primary"
                  disabled={review.submitting}
                  onClick={() => void review.run(checklist.id)}
                >
                  {review.submitting ? 'Запускаем оценку…' : 'Запустить оценку'}
                </ActionButton>
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
            {evaluation?.error?.code === 'REVIEW_REQUIRED' && (
              <div className="notice">
                <p>Результат предварительный. Итог появится после проверки доказательств.</p>
                <a href="/review" className="button secondary">
                  Открыть очередь проверки
                </a>
              </div>
            )}
            {evaluation?.status === 'failed' &&
              evaluation.error?.code !== 'REVIEW_REQUIRED' &&
              checklist && (
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
            {checklist &&
              !missingEvaluation &&
              (completed && evaluation.finalScore ? (
                <CompletedReview
                  key={evaluation.id}
                  evaluation={evaluation}
                  score={evaluation.finalScore}
                  selectedMessageId={selectedMessageId}
                  checklist={checklist}
                  selectedAppealId={selectedAppealId}
                  onSelectAppeal={(id) => onSelectAppeal(evaluation.id, id)}
                  onEvaluationChanged={review.update}
                  onRefresh={review.reload}
                  onEvidence={(messageId) => onEvidence(messageId, evaluation.id)}
                />
              ) : (
                <Criteria key={checklist.id} checklist={checklist} onEvidence={() => {}} />
              ))}
          </>
        )}
        {evaluation && (
          <>
            <Diagnostics evaluation={evaluation} />
            <EvaluationComparisonView evaluation={evaluation} items={review.items} />
          </>
        )}
      </div>
    </section>
  );
}

function CompletedReview({
  evaluation,
  score,
  checklist,
  selectedAppealId,
  selectedMessageId,
  onSelectAppeal,
  onEvaluationChanged,
  onRefresh,
  onEvidence,
}: {
  evaluation: Evaluation;
  score: ScoreSummary;
  checklist: ChecklistVersion;
  selectedAppealId: string | null;
  selectedMessageId: string | null;
  onSelectAppeal: (id: string | null) => void;
  onEvaluationChanged: (evaluation: Evaluation) => void;
  onRefresh: () => void;
  onEvidence: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Criterion | null>(null);
  const appeals = useEvaluationAppeals(evaluation.id);
  const items = appeals.history.status === 'ready' ? appeals.history.items : [];
  const pending = new Map(
    items
      .filter((appeal) => appeal.status === 'pending')
      .map((appeal) => [appeal.criterionId, appeal]),
  );
  const selected = items.find((appeal) => appeal.id === selectedAppealId);
  const criterion =
    selected && checklist.criteria.find((criterion) => criterion.id === selected.criterionId);

  return (
    <>
      <ScoreCard evaluation={evaluation} score={score} />
      <section className="loss-reasons">
        <h3>Причины снижения</h3>
        {score.contributions.filter(
          (c) => c.points !== null && c.maxPoints !== null && c.maxPoints > c.points,
        ).length === 0 ? (
          <p className="muted">Снижения по применимым критериям нет.</p>
        ) : (
          <ul>
            {score.contributions
              .filter((c) => c.points !== null && c.maxPoints !== null && c.maxPoints > c.points)
              .sort((a, b) => b.maxPoints! - b.points! - (a.maxPoints! - a.points!))
              .map((c) => {
                const answer = evaluation.effectiveAnswers.find(
                  (a) => a.criterionId === c.criterionId,
                );
                return (
                  <li key={c.criterionId}>
                    <strong>{checklist.criteria.find((x) => x.id === c.criterionId)?.title}</strong>{' '}
                    · −{numbers.format(c.maxPoints! - c.points!)}
                    <p>{answer?.explanation}</p>
                    {[
                      ...new Set([
                        ...(answer?.evidenceMessageIds ?? []),
                        ...(answer?.checkedSpanMessageIds ?? []),
                      ]),
                    ].map((id) => (
                      <button className="button secondary" key={id} onClick={() => onEvidence(id)}>
                        Реплика {id}
                      </button>
                    ))}
                  </li>
                );
              })}
          </ul>
        )}
      </section>
      {selected && criterion && (
        <AppealReview
          key={selected.id}
          appeal={selected}
          criterion={criterion}
          evaluation={evaluation}
          onClose={() => {
            onSelectAppeal(null);
            document.getElementById(`appeal-entry-${selected.id}`)?.focus();
          }}
          onReload={onRefresh}
          onResolved={(next) => {
            onEvaluationChanged(next);
            appeals.reload();
          }}
        />
      )}
      <Criteria
        checklist={checklist}
        evaluation={evaluation}
        selectedMessageId={selectedMessageId}
        onEvidence={onEvidence}
        pendingCriteria={new Set(pending.keys())}
        onAppeal={
          appeals.history.status === 'ready'
            ? (criterion) => {
                const active = pending.get(criterion.id);
                if (active) onSelectAppeal(active.id);
                else setDraft(criterion);
              }
            : undefined
        }
      />
      <AppealHistory
        history={appeals.history}
        checklist={checklist}
        selectedId={selectedAppealId}
        onSelect={onSelectAppeal}
        onReload={appeals.reload}
      />
      {draft && (
        <AppealForm
          evaluationId={evaluation.id}
          criterion={draft}
          onClose={() => setDraft(null)}
          onCreated={(appeal) => {
            setDraft(null);
            onSelectAppeal(appeal.id);
            appeals.reload();
          }}
        />
      )}
    </>
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
      {evaluation.evaluationSource === 'human_review' && (
        <p>Итог принят проверяющим; исходного полного балла модели нет.</p>
      )}
      {score.total !== null ? (
        <div className="score-number">
          {numbers.format(score.total)}
          <span>/ 100</span>
        </div>
      ) : (
        <p className="score-empty">Нет применимых критериев</p>
      )}
      {revised && original !== undefined && (
        <p className="muted">
          Исходный балл {original === null ? '—' : `${numbers.format(original)} / 100`}
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
  selectedMessageId = null,
  onEvidence,
  pendingCriteria,
  onAppeal,
}: {
  checklist: ChecklistVersion;
  evaluation?: Evaluation;
  selectedMessageId?: string | null;
  onEvidence: (id: string) => void;
  pendingCriteria?: Set<string>;
  onAppeal?: (criterion: Criterion) => void;
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
                selectedMessageId={selectedMessageId}
                appealPending={pendingCriteria?.has(criterion.id)}
                onAppeal={onAppeal ? () => onAppeal(criterion) : undefined}
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
  selectedMessageId,
  appealPending,
  onAppeal,
}: {
  criterion: Criterion;
  answer?: CriterionAnswer;
  original?: CriterionAnswer;
  evidence?: CriterionEvidence;
  contribution?: ScoreSummary['contributions'][number];
  open: boolean;
  onEvidence: (id: string) => void;
  selectedMessageId: string | null;
  appealPending?: boolean;
  onAppeal?: () => void;
}) {
  const revised = isRevised(original, answer);
  const awarded =
    criterion.scoringMode === 'weighted' && answer?.value !== 'NA' && contribution
      ? points(contribution.points, contribution.maxPoints)
      : null;
  const tone = answerTone(criterion, answer?.value);
  const directQuotes =
    evidence?.evidence.filter((message) => answer?.evidenceMessageIds.includes(message.id)) ?? [];
  const checked =
    evidence?.checkedSpan.filter((message) => answer?.checkedSpanMessageIds.includes(message.id)) ??
    [];
  const originalQuotes =
    revised && evidence
      ? [
          ...new Map(
            [...evidence.evidence, ...evidence.checkedSpan].map((message) => [message.id, message]),
          ).values(),
        ]
      : [];
  const hasSelectedEvidence = [...directQuotes, ...checked, ...originalQuotes].some(
    (message) => message.id === selectedMessageId,
  );

  return (
    <details
      className={`criterion criterion-${tone}${hasSelectedEvidence ? ' criterion-evidence-active' : ''}`}
      open={open || hasSelectedEvidence}
    >
      <summary className="criterion-summary">
        <span className="criterion-indicator" aria-hidden="true">
          <Icon
            name={
              tone === 'positive'
                ? 'check'
                : tone === 'attention' || tone === 'violation'
                  ? 'warning'
                  : 'minus'
            }
            size={14}
          />
        </span>
        <span className="criterion-name">
          {criterion.title}
          {criterion.scoringMode === 'weighted' && (
            <small className="criterion-weight">
              Вес: {numbers.format(criterion.weight)}
              {answer?.value === 'NA' ? ' · не учитывается' : ''}
            </small>
          )}
        </span>
        {answer && (
          <span className={`answer answer-${tone}`}>{answerLabel(criterion, answer.value)}</span>
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
            <Quotes
              title="Цитата из диалога"
              messages={directQuotes}
              onSelect={onEvidence}
              selectedMessageId={selectedMessageId}
            />
            <Quotes
              title="Проверенный фрагмент"
              messages={checked}
              onSelect={onEvidence}
              selectedMessageId={selectedMessageId}
            />
            {onAppeal && (
              <button
                className="button secondary criterion-appeal"
                type="button"
                onClick={onAppeal}
              >
                {appealPending ? 'Открыть апелляцию' : 'Подать апелляцию'}
              </button>
            )}
            {revised && evidence && (
              <Quotes
                title="Исходные доказательства"
                messages={originalQuotes}
                onSelect={onEvidence}
                selectedMessageId={selectedMessageId}
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
  selectedMessageId,
}: {
  title: string;
  messages: Message[];
  onSelect: (id: string) => void;
  selectedMessageId: string | null;
}) {
  if (messages.length === 0) return null;

  return (
    <div className="quotes">
      <p className="quote-heading">{title}</p>
      {messages.map((message) => (
        <button
          key={message.id}
          className="quote-button"
          aria-current={selectedMessageId === message.id ? 'true' : undefined}
          aria-controls={message.id}
          onClick={() => onSelect(message.id)}
        >
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
