import type { KnowledgeSnapshot } from '../../shared/knowledge.js';
export function KnowledgeSources({
  snapshot,
  preview = false,
}: {
  snapshot?: KnowledgeSnapshot;
  preview?: boolean;
}) {
  if (!snapshot) return <p className="muted">Эта оценка выполнена без сохранённых регламентов.</p>;
  return (
    <div className="knowledge-sources">
      {!snapshot.sources.length && (
        <p className="muted">
          {snapshot.status === 'empty'
            ? preview
              ? 'Активных регламентов нет. Включите проверенный документ для поиска.'
              : 'Активных регламентов нет. Оценка опирается на диалог и чек-лист.'
            : snapshot.status === 'date_unknown'
              ? 'Дата диалога неизвестна: регламенты с ограниченным сроком действия не использованы.'
              : 'Подходящие выдержки не найдены. Факты о продукте могут требовать проверки.'}
        </p>
      )}
      {snapshot.sources.length > 0 && (
        <p className="muted">
          {preview
            ? 'Найденные выдержки для этого запроса. Поиск не запускает оценку диалога.'
            : 'Эти выдержки переданы оценщику. Ссылки вида [K1] в обосновании указывают на соответствующий источник.'}
        </p>
      )}
      {snapshot.datedRulesSkipped && snapshot.sources.length > 0 && (
        <p className="muted">
          Из-за неизвестной даты диалога документы с ограниченным сроком действия пропущены.
        </p>
      )}
      {snapshot.sources.map((s) => (
        <details key={s.reference} className="knowledge-source">
          <summary>
            [{s.reference}] {s.title} · версия {s.version}
          </summary>
          <p className="muted">
            {s.source} · {s.effectiveFrom ?? 'без начальной даты'} —{' '}
            {s.effectiveTo ?? 'без конечной даты'}
          </p>
          <blockquote>{s.text}</blockquote>
        </details>
      ))}
    </div>
  );
}
