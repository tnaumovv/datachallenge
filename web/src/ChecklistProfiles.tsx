import { useEffect, useState } from 'react';
import type { ChecklistVersion } from '../../shared/contracts.js';
import type { ChecklistProfile, ChecklistDiff } from '../../shared/checklist-profiles.js';
import { request, post } from './api';
export function ChecklistProfiles({ versions }: { versions: ChecklistVersion[] }) {
  const [profiles, setProfiles] = useState<ChecklistProfile[]>([]),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    request<ChecklistProfile[]>('/checklist-profiles', { signal: c.signal }).then(
      (p) => {
        if (!c.signal.aborted) {
          setProfiles(p);
          setError('');
        }
      },
      () => {
        if (!c.signal.aborted) setError('Не удалось загрузить активные профили.');
      },
    );
    return () => c.abort();
  }, [refresh, versions]);
  return (
    <section className="panel profiles-panel">
      <h2>Активные версии</h2>
      <p className="muted">
        Сохранение создаёт новую версию. Для новых оценок активируйте её отдельно.
      </p>
      {error && (
        <p role="alert">
          {error}{' '}
          <button className="button secondary" onClick={() => setRefresh((n) => n + 1)}>
            Повторить
          </button>
        </p>
      )}
      {profiles.map((p) => (
        <Profile
          key={`${p.id}-${p.revision}`}
          profile={p}
          versions={versions}
          onSaved={() => setRefresh((n) => n + 1)}
        />
      ))}
    </section>
  );
}
function Profile({
  profile: p,
  versions,
  onSaved,
}: {
  profile: ChecklistProfile;
  versions: ChecklistVersion[];
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState(p.activeVersionId),
    [diff, setDiff] = useState<ChecklistDiff | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setDiff(null);
    if (selected === p.activeVersionId) return;
    const c = new AbortController();
    request<ChecklistDiff>(
      `/checklist-diff?${new URLSearchParams({ left: p.activeVersionId, right: selected })}`,
      { signal: c.signal },
    ).then(
      (d) => {
        if (!c.signal.aborted) setDiff(d);
      },
      () => {
        if (!c.signal.aborted) setError('Не удалось загрузить изменения.');
      },
    );
    return () => c.abort();
  }, [selected, p.activeVersionId]);
  async function activate() {
    setBusy(true);
    setError('');
    try {
      await post(`/checklist-profiles/${encodeURIComponent(p.id)}/activations`, {
        versionId: selected,
        expectedActiveVersionId: p.activeVersionId,
      });
      onSaved();
    } catch {
      setError('Не удалось активировать. Обновите профиль: его мог изменить другой проверяющий.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="profile-row">
      <h3>
        {p.title} · {p.channels.map((c) => (c === 'agent chat' ? 'Чат' : 'Звонок')).join(', ')}
      </h3>
      <label>
        Версия
        <select
          className="field"
          value={selected}
          disabled={busy}
          onChange={(e) => setSelected(e.target.value)}
        >
          {versions
            .filter((v) => v.checklistId === p.checklistId)
            .map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} · {v.title}
                {v.id === p.activeVersionId ? ' · активна' : ''}
              </option>
            ))}
        </select>
      </label>
      {diff && (
        <>
          <p>
            {diff.weightOnly
              ? 'Изменились только веса. Предпросмотр пересчёта не является новой AI-оценкой.'
              : 'Изменились правила: для актуального результата нужна полная новая оценка.'}
          </p>
          <ul>
            {diff.changes.map((c) => (
              <li key={`${c.criterionId}-${c.field}`}>
                {c.criterionId} · {c.field}: {JSON.stringify(c.before)} → {JSON.stringify(c.after)}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        className="button secondary"
        disabled={busy || selected === p.activeVersionId || !diff}
        onClick={() => void activate()}
      >
        {busy ? 'Активируем…' : 'Активировать версию'}
      </button>
    </div>
  );
}
