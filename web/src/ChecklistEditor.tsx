import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ChecklistInput, ChecklistVersion, Criterion } from '../../shared/contracts.js';
import {
  newCriterion,
  toChecklistDraft,
  validateChecklistDraft,
  type ChecklistDraft,
  type CriterionDraft,
  type DraftError,
} from './ChecklistEditor.model.js';
import './ChecklistEditor.css';

export type ChecklistEditorProps = {
  /** Canonical versions returned by GET /api/checklists. Keep prior data during refresh. */
  versions: ChecklistVersion[];
  /** Initial selection only. The component owns later browsing and draft state. */
  initialVersionId?: string;
  loading?: boolean;
  loadError?: boolean;
  /** The host owns loading/error state and catches refresh failures. Does not discard a draft. */
  onReload?: () => void;
  /** POST /api/checklists/:checklistId/versions; resolve with the created version (HTTP 201).
   * The host should also add it to its shared version list for the evaluation selector.
   * Do not invoke Gemini here. A rejected promise retains the draft and is never retried automatically.
   */
  onSaveVersion: (checklistId: string, input: ChecklistInput) => Promise<ChecklistVersion>;
  onDirtyChange?: (dirty: boolean) => void;
};

function Field({
  label,
  error,
  errorId,
  children,
}: {
  label: string;
  error?: string;
  errorId: string;
  children: ReactNode;
}) {
  return (
    <div className="ce-field">
      <label htmlFor={errorId.replace(/-error$/, '')}>{label}</label>
      {children}
      {error && (
        <span className="ce-field-error" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}

function CriterionView({ criterion }: { criterion: Criterion }) {
  return (
    <article className="ce-criterion-view">
      <div className="ce-row">
        <h4>{criterion.title}</h4>
        <span className="ce-badge">
          {criterion.scoringMode === 'flag' ? 'Отдельная отметка' : `Вес: ${criterion.weight}`}
        </span>
      </div>
      <p className="ce-instruction">{criterion.instruction}</p>
      <p className="ce-muted">
        {criterion.answerType === 'binary' ? 'Ответ: Да / Нет' : 'Ответ: значение из шкалы'} ·{' '}
        {criterion.allowNA ? 'Допускается N/A' : 'Без N/A'}
      </p>
      {criterion.answerType === 'scale' && (
        <dl className="ce-level-preview">
          {criterion.levels.map((level) => (
            <div key={level}>
              <dt>{level}</dt>
              <dd>{criterion.levelDescriptions[String(level)] || 'Описание не задано'}</dd>
            </div>
          ))}
        </dl>
      )}
      {criterion.allowNA && (
        <p className="ce-na-rule">
          <strong>Когда неприменим:</strong> {criterion.naRule}
        </p>
      )}
    </article>
  );
}

/** The host owns API access. Every save creates a version; existing versions are never edited. */
export function ChecklistEditor({
  versions,
  initialVersionId,
  loading = false,
  loadError = false,
  onReload,
  onSaveVersion,
  onDirtyChange,
}: ChecklistEditorProps) {
  const prefix = useId();
  const [selectedId, setSelectedId] = useState(initialVersionId ?? '');
  const [savedVersions, setSavedVersions] = useState<ChecklistVersion[]>([]);
  const [base, setBase] = useState<ChecklistVersion | null>(null);
  const [draft, setDraft] = useState<ChecklistDraft | null>(null);
  const [errors, setErrors] = useState<DraftError[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [success, setSuccess] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [activeCriterion, setActiveCriterion] = useState(0);
  const inFlight = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const allVersions = [
    ...new Map([...versions, ...savedVersions].map((version) => [version.id, version])).values(),
  ].sort((a, b) => a.checklistId.localeCompare(b.checklistId) || b.version - a.version);
  const selected = allVersions.find((version) => version.id === selectedId) ?? allVersions[0];
  const dirty = Boolean(
    draft && base && JSON.stringify(draft) !== JSON.stringify(toChecklistDraft(base)),
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  function fieldProps(path: string) {
    return {
      id: `${prefix}-${path}`,
      'aria-invalid': errors.some((error) => error.path === path) || undefined,
      'aria-describedby': errors.some((error) => error.path === path)
        ? `${prefix}-${path}-error`
        : undefined,
    };
  }
  function fieldError(path: string) {
    return errors.find((error) => error.path === path)?.message;
  }
  function field(label: string, path: string, children: ReactNode) {
    return (
      <Field label={label} error={fieldError(path)} errorId={`${prefix}-${path}-error`}>
        {children}
      </Field>
    );
  }
  function changeCriterion(index: number, patch: Partial<CriterionDraft>) {
    setDraft(
      (current) =>
        current && {
          ...current,
          criteria: current.criteria.map((criterion, i) =>
            i === index ? { ...criterion, ...patch } : criterion,
          ),
        },
    );
    setConfirmDiscard(false);
  }
  function startEditing() {
    if (!selected) return;
    setBase(selected);
    setDraft(toChecklistDraft(selected));
    setErrors([]);
    setSaveError(false);
    setSuccess('');
    setActiveCriterion(0);
    requestAnimationFrame(() => document.getElementById(`${prefix}-title`)?.focus());
  }
  function discard() {
    setDraft(null);
    setBase(null);
    setErrors([]);
    setSaveError(false);
    setConfirmDiscard(false);
    requestAnimationFrame(() => headingRef.current?.focus());
  }
  function addCriterion() {
    if (!draft) return;
    const index = draft.criteria.length;
    setActiveCriterion(index);
    setDraft({
      ...draft,
      criteria: [...draft.criteria, newCriterion(crypto.randomUUID(), draft.sections[0].id)],
    });
    requestAnimationFrame(() =>
      document.getElementById(`${prefix}-criteria.${index}.title`)?.focus(),
    );
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || !base || inFlight.current) return;
    const validation = validateChecklistDraft(draft);
    setErrors(validation.errors);
    setSaveError(false);
    if (!validation.input) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setConfirmDiscard(false);
    try {
      const created = await onSaveVersion(base.checklistId, validation.input);
      setSavedVersions((current) => [...current, created]);
      setSelectedId(created.id);
      setDraft(null);
      setBase(null);
      setSuccess(`Версия ${created.version} сохранена. Она доступна для новых оценок.`);
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setSaveError(true);
      requestAnimationFrame(() => summaryRef.current?.focus());
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="checklist-editor" aria-labelledby={`${prefix}-heading`}>
      <header className="ce-header">
        <div>
          <h2 id={`${prefix}-heading`} ref={headingRef} tabIndex={-1}>
            Версии чек-листа
          </h2>
          <p className="ce-muted">Настройте правила проверки и сохраните новую версию.</p>
        </div>
        {!draft && selected && (
          <button type="button" className="ce-button ce-primary" onClick={startEditing}>
            Создать новую версию
          </button>
        )}
      </header>
      <div className="ce-version-picker">
        <label htmlFor={`${prefix}-version`}>Версия для просмотра</label>
        <select
          id={`${prefix}-version`}
          value={selected?.id ?? ''}
          disabled={Boolean(draft) || !selected}
          onChange={(event) => {
            setSelectedId(event.target.value);
            setSuccess('');
          }}
        >
          {!selected && <option value="">Нет версий</option>}
          {allVersions.map((version) => (
            <option key={version.id} value={version.id}>
              {version.title} · версия {version.version}
            </option>
          ))}
        </select>
        {draft && (
          <p className="ce-muted">Чтобы выбрать другую версию, сохраните или отмените изменения.</p>
        )}
      </div>
      {loading && (
        <p role="status" className="ce-notice">
          Загрузка версий…
        </p>
      )}
      {loadError && (
        <div role="alert" className="ce-notice ce-error">
          Не удалось загрузить версии чек-листа.{' '}
          {onReload && (
            <button className="ce-button" type="button" onClick={onReload}>
              Загрузить снова
            </button>
          )}
        </div>
      )}
      {success && (
        <p role="status" className="ce-notice ce-success">
          {success}
        </p>
      )}
      {!selected && !loading && !loadError && (
        <p className="ce-notice">Чек-листов пока нет. Сначала добавьте исходный чек-лист.</p>
      )}

      {draft && base ? (
        <form
          id={`${prefix}-form`}
          tabIndex={-1}
          ref={formRef}
          onSubmit={save}
          noValidate
          aria-busy={saving}
        >
          <div className="ce-draft-heading">
            <span className="ce-badge">Новая версия</span>
            <p className="ce-muted">
              На основе версии {base.version}. Существующие оценки сохранят прежние правила.
            </p>
          </div>
          {(errors.length > 0 || saveError) && (
            <div className="ce-notice ce-error" role="alert" tabIndex={-1} ref={summaryRef}>
              {errors.length > 0 && (
                <>
                  <strong>Проверьте поля перед сохранением.</strong>
                  <ul>
                    {errors.map((error) => (
                      <li key={error.path}>
                        <a
                          href={`#${prefix}-${error.path}`}
                          onClick={(event) => {
                            event.preventDefault();
                            const criterionIndex = /^criteria\.(\d+)/.exec(error.path);
                            if (criterionIndex) setActiveCriterion(Number(criterionIndex[1]));
                            requestAnimationFrame(() =>
                              document.getElementById(`${prefix}-${error.path}`)?.focus(),
                            );
                          }}
                        >
                          {error.message}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {saveError && (
                <p>
                  Не удалось подтвердить сохранение. Черновик остался на экране.{' '}
                  {onReload
                    ? 'Обновите список версий перед повторной попыткой.'
                    : 'Проверьте список версий перед повторной попыткой.'}
                </p>
              )}
              {saveError && onReload && (
                <button className="ce-button" type="button" onClick={onReload}>
                  Обновить список версий
                </button>
              )}
            </div>
          )}
          <fieldset className="ce-form-body" disabled={saving}>
            <legend className="ce-sr-only">Правила новой версии</legend>
            {field(
              'Название чек-листа',
              'title',
              <input
                {...fieldProps('title')}
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                required
              />,
            )}
            <div className="ce-edit-layout">
              <aside className="ce-outline" aria-label="Критерии чек-листа">
                {draft.sections.map((section) => (
                  <div className="ce-outline-group" key={section.id}>
                    <h3>{section.title}</h3>
                    {draft.criteria.map(
                      (criterion, index) =>
                        criterion.sectionId === section.id && (
                          <button
                            type="button"
                            key={criterion.id}
                            aria-pressed={index === activeCriterion}
                            onClick={() => setActiveCriterion(index)}
                          >
                            <span>{criterion.title || 'Новый критерий'}</span>
                            <small>
                              {criterion.scoringMode === 'flag' ? 'Флаг' : criterion.weight}
                            </small>
                          </button>
                        ),
                    )}
                  </div>
                ))}
                <button className="ce-button" type="button" onClick={addCriterion}>
                  ＋ Добавить критерий
                </button>
              </aside>
              <div className="ce-definition">
                {draft.criteria.map((criterion, index) => {
                  const path = `criteria.${index}`;
                  const flag = criterion.scoringMode === 'flag';
                  return (
                    <fieldset
                      className="ce-criterion"
                      key={criterion.id}
                      hidden={index !== activeCriterion}
                    >
                      <legend>
                        {index + 1}. {criterion.title || 'Новый критерий'}
                      </legend>
                      <div className="ce-grid">
                        {field(
                          'Название критерия',
                          `${path}.title`,
                          <input
                            {...fieldProps(`${path}.title`)}
                            value={criterion.title}
                            onChange={(event) =>
                              changeCriterion(index, { title: event.target.value })
                            }
                            required
                          />,
                        )}
                        {field(
                          'Раздел',
                          `${path}.sectionId`,
                          <select
                            {...fieldProps(`${path}.sectionId`)}
                            value={criterion.sectionId}
                            onChange={(event) =>
                              changeCriterion(index, { sectionId: event.target.value })
                            }
                          >
                            {draft.sections.map((section) => (
                              <option key={section.id} value={section.id}>
                                {section.title}
                              </option>
                            ))}
                          </select>,
                        )}
                      </div>
                      {field(
                        'Формулировка проверки',
                        `${path}.instruction`,
                        <textarea
                          {...fieldProps(`${path}.instruction`)}
                          value={criterion.instruction}
                          onChange={(event) =>
                            changeCriterion(index, { instruction: event.target.value })
                          }
                          rows={3}
                          required
                        />,
                      )}
                      <div className="ce-grid">
                        {field(
                          'Тип ответа',
                          `${path}.answerType`,
                          <select
                            {...fieldProps(`${path}.answerType`)}
                            value={criterion.answerType}
                            disabled={flag}
                            onChange={(event) => {
                              const answerType = event.target.value as Criterion['answerType'];
                              changeCriterion(index, {
                                answerType,
                                levels:
                                  answerType === 'scale' && !criterion.levels.length
                                    ? [
                                        { key: crypto.randomUUID(), value: '0', description: '' },
                                        { key: crypto.randomUUID(), value: '10', description: '' },
                                      ]
                                    : criterion.levels,
                              });
                            }}
                          >
                            <option value="binary">Да / Нет</option>
                            <option value="scale">Дискретная шкала</option>
                          </select>,
                        )}
                        {field(
                          'Вес критерия',
                          `${path}.weight`,
                          <input
                            {...fieldProps(`${path}.weight`)}
                            type="number"
                            min="0"
                            max="10000"
                            step="any"
                            value={criterion.weight}
                            disabled={flag}
                            onChange={(event) =>
                              changeCriterion(index, { weight: event.target.value })
                            }
                            required
                          />,
                        )}
                      </div>
                      {flag && (
                        <p className="ce-muted">
                          Отдельная отметка: ответ «Да / Нет», нулевой вес, без N/A. Она
                          показывается отдельно от балла.
                        </p>
                      )}
                      {field(
                        'Учёт критерия',
                        `${path}.scoringMode`,
                        <select
                          {...fieldProps(`${path}.scoringMode`)}
                          value={criterion.scoringMode}
                          onChange={(event) =>
                            changeCriterion(
                              index,
                              event.target.value === 'flag'
                                ? {
                                    scoringMode: 'flag',
                                    answerType: 'binary',
                                    weight: '0',
                                    allowNA: false,
                                    naRule: null,
                                    levels: [],
                                  }
                                : { scoringMode: 'weighted' },
                            )
                          }
                        >
                          <option value="weighted">Участвует в балле</option>
                          <option value="flag">Отдельный флаг нарушения</option>
                        </select>,
                      )}
                      {criterion.answerType === 'scale' && (
                        <fieldset
                          className="ce-levels"
                          {...fieldProps(`${path}.levels`)}
                          tabIndex={-1}
                        >
                          <legend>Уровни шкалы</legend>
                          <p className="ce-muted">
                            Укажите разные значения, включая 0 и положительный максимум. Вес задаёт
                            вклад критерия в итог.
                          </p>
                          {criterion.levels.map((level, levelIndex) => (
                            <div className="ce-level-row" key={level.key}>
                              {field(
                                `Значение уровня ${levelIndex + 1}`,
                                `${path}.levels.${levelIndex}.value`,
                                <input
                                  {...fieldProps(`${path}.levels.${levelIndex}.value`)}
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={level.value}
                                  onChange={(event) =>
                                    changeCriterion(index, {
                                      levels: criterion.levels.map((item, i) =>
                                        i === levelIndex
                                          ? { ...item, value: event.target.value }
                                          : item,
                                      ),
                                    })
                                  }
                                  required
                                />,
                              )}
                              {field(
                                `Описание уровня ${levelIndex + 1}`,
                                `${path}.levels.${levelIndex}.description`,
                                <input
                                  {...fieldProps(`${path}.levels.${levelIndex}.description`)}
                                  value={level.description}
                                  onChange={(event) =>
                                    changeCriterion(index, {
                                      levels: criterion.levels.map((item, i) =>
                                        i === levelIndex
                                          ? { ...item, description: event.target.value }
                                          : item,
                                      ),
                                    })
                                  }
                                />,
                              )}
                              <button
                                className="ce-button ce-remove"
                                type="button"
                                aria-label={`Удалить уровень ${levelIndex + 1}`}
                                onClick={() =>
                                  changeCriterion(index, {
                                    levels: criterion.levels.filter((_, i) => i !== levelIndex),
                                  })
                                }
                              >
                                Удалить
                              </button>
                            </div>
                          ))}
                          {fieldError(`${path}.levels`) && (
                            <p className="ce-field-error" id={`${prefix}-${path}.levels-error`}>
                              {fieldError(`${path}.levels`)}
                            </p>
                          )}
                          <button
                            className="ce-button"
                            type="button"
                            onClick={() =>
                              changeCriterion(index, {
                                levels: [
                                  ...criterion.levels,
                                  { key: crypto.randomUUID(), value: '', description: '' },
                                ],
                              })
                            }
                          >
                            Добавить уровень
                          </button>
                        </fieldset>
                      )}
                      <label className="ce-checkbox">
                        <input
                          type="checkbox"
                          checked={criterion.allowNA}
                          disabled={flag}
                          onChange={(event) =>
                            changeCriterion(index, { allowNA: event.target.checked })
                          }
                        />
                        Разрешить N/A — критерий неприменим
                      </label>
                      {criterion.allowNA &&
                        field(
                          'Когда критерий неприменим',
                          `${path}.naRule`,
                          <textarea
                            {...fieldProps(`${path}.naRule`)}
                            value={criterion.naRule ?? ''}
                            rows={2}
                            onChange={(event) =>
                              changeCriterion(index, { naRule: event.target.value })
                            }
                            required
                          />,
                        )}
                      <button
                        className="ce-button ce-delete"
                        type="button"
                        disabled={draft.criteria.length <= 1}
                        onClick={() => {
                          setDraft({
                            ...draft,
                            criteria: draft.criteria.filter((_, i) => i !== index),
                          });
                          setActiveCriterion(Math.max(0, index - 1));
                        }}
                      >
                        Удалить критерий
                      </button>
                    </fieldset>
                  );
                })}
              </div>
            </div>
          </fieldset>
          {confirmDiscard && (
            <div className="ce-notice" role="alert">
              <p>Отменить несохранённые изменения?</p>
              <div className="ce-actions">
                <button
                  className="ce-button"
                  type="button"
                  onClick={() => setConfirmDiscard(false)}
                >
                  Продолжить редактирование
                </button>
                <button className="ce-button" type="button" onClick={discard}>
                  Отменить изменения
                </button>
              </div>
            </div>
          )}
          <footer className="ce-actions ce-save-bar">
            <button className="ce-button ce-primary" type="submit" disabled={saving}>
              {saving ? 'Сохранение…' : 'Сохранить новую версию'}
            </button>
            <button
              className="ce-button"
              type="button"
              disabled={saving}
              onClick={() => (dirty ? setConfirmDiscard(true) : discard())}
            >
              Отмена
            </button>
            {saving && (
              <span role="status" className="ce-muted">
                Сохраняем новую версию…
              </span>
            )}
          </footer>
        </form>
      ) : (
        selected && (
          <div className="ce-version-view">
            <div className="ce-row">
              <h3>{selected.title}</h3>
              <span className="ce-muted">
                Версия {selected.version} · критериев: {selected.criteria.length}
              </span>
            </div>
            {selected.sections.map((section) => (
              <section key={section.id} className="ce-section">
                <h3>{section.title}</h3>
                {selected.criteria
                  .filter((criterion) => criterion.sectionId === section.id)
                  .map((criterion) => (
                    <CriterionView criterion={criterion} key={criterion.id} />
                  ))}
              </section>
            ))}
          </div>
        )
      )}
    </section>
  );
}
