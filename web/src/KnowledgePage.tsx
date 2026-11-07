import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  KnowledgeInputSchema,
  type KnowledgeDocument,
  type KnowledgeInput,
  type KnowledgeSnapshot,
} from '../../shared/knowledge.js';
import { api, RequestError } from './api';
import { KnowledgeSources } from './KnowledgeSources';
import { Select } from './components/ui/select';
import './knowledge.css';
const empty: KnowledgeInput = {
  documentKey: '',
  title: '',
  source: '',
  version: '',
  language: 'RU',
  text: '',
  keywords: '',
  effectiveFrom: null,
  effectiveTo: null,
  active: false,
  demo: false,
};
const example: KnowledgeInput = {
  ...empty,
  documentKey: 'training-example',
  title: 'Учебный пример: история операций',
  source: 'Вымышленный документ для знакомства с интерфейсом',
  version: 'example-1',
  text: 'Учебный пример, не правило банка. В вымышленном приложении историю операций можно посмотреть в разделе «Операции».',
  keywords: 'история операций transaction history операциялар тарихы',
  demo: true,
};
function errorText(error: unknown) {
  if (error instanceof RequestError) {
    if (error.code === 'KNOWLEDGE_VERSION_EXISTS')
      return 'Такая версия уже сохранена. Укажите новый номер версии.';
    if (error.code === 'KNOWLEDGE_OVERLAP')
      return 'Сроки активных версий этого документа пересекаются. Отключите предыдущую версию или укажите непересекающиеся даты.';
  }
  return 'Не удалось сохранить изменения. Проверьте данные и повторите попытку.';
}
export function KnowledgePage({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [documents, setDocuments] = useState<KnowledgeDocument[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [form, setForm] = useState<KnowledgeInput>(empty);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [date, setDate] = useState('');
  const [search, setSearch] = useState<KnowledgeSnapshot | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const controller = useRef(new AbortController());
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const c = new AbortController();
    setLoadError(false);
    api.knowledge(c.signal).then(
      (d) => {
        if (!c.signal.aborted) setDocuments(d);
      },
      () => {
        if (!c.signal.aborted) setLoadError(true);
      },
    );
    return () => c.abort();
  }, [reload]);
  function change<K extends keyof KnowledgeInput>(key: K, value: KnowledgeInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setMessage('');
    setError('');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    const parsed = KnowledgeInputSchema.safeParse(form);
    if (!parsed.success) {
      setError(
        'Заполните название, код, источник, версию и текст (от 20 символов). Проверьте порядок дат.',
      );
      return;
    }
    setSaving(true);
    try {
      const doc = await api.createKnowledge(parsed.data, controller.current.signal);
      setDocuments((d) => [doc, ...(d ?? [])]);
      setDirty(false);
      setForm(empty);
      setMessage('Документ сохранён.');
      setSearch(null);
    } catch (e) {
      if (!controller.current.signal.aborted) setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  async function toggle(doc: KnowledgeDocument) {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const changed = await api.activateKnowledge(doc.id, !doc.active, controller.current.signal);
      setDocuments((d) => d?.map((v) => (v.id === doc.id ? changed : v)) ?? null);
      setSearch(null);
      setMessage(
        changed.active
          ? 'Документ включён для новых оценок.'
          : 'Документ отключён. Сохранённые оценки не изменились.',
      );
    } catch (e) {
      if (!controller.current.signal.aborted) setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  async function runSearch(e: FormEvent) {
    e.preventDefault();
    setSearching(true);
    setSearch(null);
    setSearchError('');
    try {
      setSearch(
        await api.searchKnowledge({ query, ...(date ? { date } : {}) }, controller.current.signal),
      );
    } catch {
      if (!controller.current.signal.aborted)
        setSearchError('Не удалось выполнить поиск. Повторите попытку.');
    } finally {
      setSearching(false);
    }
  }
  return (
    <main id="main-content" className="page-content knowledge-page" tabIndex={-1}>
      <header className="page-heading">
        <div>
          <h1>База знаний</h1>
          <p className="page-description">
            Регламенты помогают проверить, соответствует ли консультация правилам банка. Добавляйте
            документы с источником и версией.
          </p>
        </div>
      </header>
      <div className="knowledge-layout">
        <section className="panel knowledge-editor">
          <h2>Добавить регламент</h2>
          <p className="muted">
            Вставьте текст или откройте файл TXT / Markdown. Содержимое сохраняется как новая
            неизменяемая версия.
          </p>
          <form onSubmit={save}>
            <fieldset disabled={saving} className="knowledge-fields">
              <label className="field-label">
                Название
                <input
                  className="field"
                  required
                  maxLength={200}
                  value={form.title}
                  onChange={(e) => change('title', e.target.value)}
                />
              </label>
              <div className="knowledge-pair">
                <label className="field-label">
                  Код документа
                  <input
                    className="field"
                    required
                    maxLength={100}
                    placeholder="Например, transfers"
                    value={form.documentKey}
                    onChange={(e) => change('documentKey', e.target.value)}
                  />
                </label>
                <label className="field-label">
                  Версия
                  <input
                    className="field"
                    required
                    maxLength={80}
                    value={form.version}
                    onChange={(e) => change('version', e.target.value)}
                  />
                </label>
              </div>
              <label className="field-label">
                Источник
                <input
                  className="field"
                  required
                  maxLength={500}
                  placeholder="Название справочника или ссылка на оригинал"
                  value={form.source}
                  onChange={(e) => change('source', e.target.value)}
                />
              </label>
              <div className="knowledge-pair">
                <label className="field-label">
                  Действует с
                  <input
                    className="field"
                    type="date"
                    value={form.effectiveFrom ?? ''}
                    onChange={(e) => change('effectiveFrom', e.target.value || null)}
                  />
                </label>
                <label className="field-label">
                  Действует по
                  <input
                    className="field"
                    type="date"
                    value={form.effectiveTo ?? ''}
                    onChange={(e) => change('effectiveTo', e.target.value || null)}
                  />
                </label>
              </div>
              <p className="muted">
                Оставьте даты пустыми только для правил без ограничения срока. Если дата диалога
                неизвестна, документы с датами не используются.
              </p>
              <label className="field-label">
                Язык документа
                <Select
                  className="field"
                  aria-label="Язык документа"
                  value={form.language}
                  onValueChange={(value) => change('language', value as KnowledgeInput['language'])}
                  options={[
                    { value: 'RU', label: 'Русский' },
                    { value: 'KZ', label: 'Казахский' },
                    { value: 'EN', label: 'Английский' },
                    { value: 'MULTI', label: 'Несколько языков' },
                  ]}
                />
              </label>
              <label className="field-label">
                Ключевые слова
                <input
                  className="field"
                  maxLength={1000}
                  value={form.keywords}
                  onChange={(e) => change('keywords', e.target.value)}
                />
                <span className="muted">
                  Добавьте варианты терминов на языках диалогов, чтобы документ легче находился.
                </span>
              </label>
              <label className="field-label">
                Загрузить текстовый файл
                <input
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 300000 || !/\.(txt|md)$/i.test(file.name)) {
                      setError('Выберите TXT или Markdown до 300 КБ.');
                      return;
                    }
                    try {
                      const text = await file.text();
                      if (text.length > 100000) {
                        setError('Текст должен содержать не более 100 000 символов.');
                        return;
                      }
                      change('text', text);
                    } catch {
                      setError('Не удалось прочитать файл. Вставьте текст вручную.');
                    }
                  }}
                />
              </label>
              <label className="field-label">
                Текст регламента
                <textarea
                  className="field"
                  required
                  minLength={20}
                  maxLength={100000}
                  rows={9}
                  value={form.text}
                  onChange={(e) => change('text', e.target.value)}
                />
              </label>
              {form.demo && (
                <p className="notice">Учебный пример. Он не участвует в оценке диалогов.</p>
              )}
              <label className="knowledge-check">
                <input
                  type="checkbox"
                  disabled={form.demo}
                  checked={form.active}
                  onChange={(e) => change('active', e.target.checked)}
                />
                Использовать при новых оценках
              </label>
              <div className="knowledge-actions">
                <button className="button primary" type="submit">
                  {saving ? 'Сохраняем…' : 'Сохранить документ'}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => {
                    if (dirty && !window.confirm('Заменить несохранённый текст учебным примером?'))
                      return;
                    setForm({ ...example, version: 'example-' + Date.now() });
                    setDirty(true);
                    setError('');
                  }}
                >
                  Посмотреть учебный пример
                </button>
                {form.demo && (
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => {
                      setForm(empty);
                      setDirty(false);
                    }}
                  >
                    Новый регламент
                  </button>
                )}
              </div>
            </fieldset>
          </form>
          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
        </section>
        <div className="knowledge-aside">
          <section className="panel">
            <h2>Документы</h2>
            {loadError ? (
              <div role="alert">
                Не удалось загрузить документы.{' '}
                <button className="button secondary" onClick={() => setReload((n) => n + 1)}>
                  Повторить загрузку
                </button>
              </div>
            ) : documents === null ? (
              <p role="status">Загружаем документы…</p>
            ) : !documents.length ? (
              <p className="muted">Регламенты пока не добавлены</p>
            ) : (
              documents.map((doc) => (
                <article className="knowledge-document" key={doc.id}>
                  <h3>{doc.title}</h3>
                  <p className="muted">
                    {doc.documentKey} · версия {doc.version} ·{' '}
                    {doc.demo ? 'Учебный пример' : doc.active ? 'Используется' : 'Отключён'}
                  </p>
                  <p className="muted">{doc.source}</p>
                  <details>
                    <summary>Текст документа</summary>
                    <p className="knowledge-text">{doc.text}</p>
                  </details>
                  <div className="knowledge-actions">
                    <button
                      className="button secondary"
                      disabled={saving || doc.demo}
                      onClick={() => void toggle(doc)}
                    >
                      {doc.active ? 'Отключить' : 'Включить'}
                    </button>
                    {!doc.demo && (
                      <button
                        className="button secondary"
                        disabled={saving}
                        onClick={() => {
                          if (
                            dirty &&
                            !window.confirm('Заменить несохранённый текст выбранным документом?')
                          )
                            return;
                          setForm(
                            KnowledgeInputSchema.parse({
                              ...Object.fromEntries(
                                Object.entries(doc).filter(
                                  ([key]) => !['id', 'createdAt', 'contentHash'].includes(key),
                                ),
                              ),
                              version: 'draft',
                              active: false,
                            }),
                          );
                          setForm((f) => ({ ...f, version: '' }));
                          setDirty(true);
                          document
                            .querySelector<HTMLInputElement>('.knowledge-editor input')
                            ?.focus();
                        }}
                      >
                        Новая версия
                      </button>
                    )}
                  </div>
                </article>
              ))
            )}
          </section>
          <section className="panel">
            <h2>Проверить поиск</h2>
            <p className="muted">
              Поиск по словам и их началу среди активных документов. Учебные примеры исключены.
            </p>
            <form onSubmit={runSearch} className="knowledge-fields">
              <label className="field-label">
                Запрос клиента
                <input
                  className="field"
                  required
                  maxLength={20000}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSearch(null);
                  }}
                />
              </label>
              <label className="field-label">
                Дата диалога
                <input
                  className="field"
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setSearch(null);
                  }}
                />
              </label>
              <button className="button secondary" disabled={searching}>
                {searching ? 'Ищем…' : 'Найти выдержки'}
              </button>
            </form>
            {searchError && <p role="alert">{searchError}</p>}
            {search && <KnowledgeSources snapshot={search} preview />}
          </section>
        </div>
      </div>
    </main>
  );
}
