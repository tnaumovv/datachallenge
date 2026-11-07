import { useEffect, useRef, useState } from 'react';
import { ImportRequestSchema, type ImportResult } from '../../shared/contracts.js';
import { api, importErrorMessage } from './api';

export function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (result: ImportResult) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [source, setSource] = useState<'organizer' | 'json'>('organizer');
  const [group, setGroup] = useState('DEV');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => {
      request.current?.abort();
      node?.close();
    };
  }, []);
  async function submit() {
    if (request.current) return;
    setError(null);
    let records: unknown;
    if (source === 'json') {
      try {
        const parsed: unknown = JSON.parse(text);
        records = Array.isArray(parsed)
          ? parsed
          : (parsed as { records?: unknown } | null)?.records;
      } catch {
        setError('Не удалось прочитать JSON. Проверьте скобки, кавычки и формат файла.');
        return;
      }
    }
    const checked = ImportRequestSchema.safeParse(
      source === 'organizer' ? { source, groupId: group } : { source, groupId: group, records },
    );
    if (!checked.success) {
      setError(
        'Укажите группу и корректные записи: conversation_id, channel, language и transcript.',
      );
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const result = await api.importRecords(checked.data, controller.signal);
      if (!controller.signal.aborted) onImported(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(importErrorMessage(cause));
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <dialog
      className="appeal-dialog import-dialog"
      ref={dialog}
      aria-labelledby="import-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="import-heading">Импорт диалогов</h2>
      <p className="muted">Загрузите записи из источника или выберите JSON-файл.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy} className="import-fields">
          <legend className="sr-only">Источник диалогов</legend>
          <label className="field-label" htmlFor="import-source">
            Источник
          </label>
          <select
            className="field"
            id="import-source"
            value={source}
            onChange={(e) => {
              setSource(e.target.value as typeof source);
              setError(null);
            }}
          >
            <option value="organizer">Источник организаторов</option>
            <option value="json">JSON-файл или текст</option>
          </select>
          <label className="field-label" htmlFor="import-group">
            Группа
          </label>
          <input
            className="field"
            id="import-group"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            required
            maxLength={100}
          />
          {source === 'json' && (
            <>
              <label className="field-label" htmlFor="import-file">
                Файл JSON · до 10 МБ
              </label>
              <input
                className="field"
                id="import-file"
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 10 * 1024 * 1024) {
                    setError('Файл больше 10 МБ. Разделите записи на несколько файлов.');
                    return;
                  }
                  try {
                    setText(await file.text());
                    setError(null);
                  } catch {
                    setError('Не удалось прочитать файл. Выберите его ещё раз.');
                  }
                }}
              />
              <label className="field-label" htmlFor="import-json">
                Записи JSON
              </label>
              <textarea
                className="field code-input"
                id="import-json"
                rows={7}
                value={text}
                onChange={(e) => setText(e.target.value)}
                required
                spellCheck={false}
              />
              <p className="muted small">
                Принимается массив диалогов или объект с массивом records. Группа берётся из поля
                выше.
              </p>
            </>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="notice notice-error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={busy || !group.trim() || (source === 'json' && !text.trim())}
          >
            {busy ? 'Импортируем…' : 'Импортировать'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
