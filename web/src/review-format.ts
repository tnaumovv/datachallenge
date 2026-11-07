import type { Appeal, Criterion, CriterionAnswer, ScoreSummary } from '../../shared/contracts.js';

export const numbers = new Intl.NumberFormat('ru', { maximumFractionDigits: 2 });

export function answerLabel(criterion: Criterion, value: CriterionAnswer['value']) {
  if (value === 'NA') return 'Не применимо';
  if (criterion.scoringMode === 'flag') return value ? 'Нарушение' : 'Без нарушения';
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  return criterion.levels.length
    ? `${numbers.format(value)} / ${numbers.format(Math.max(...criterion.levels))}`
    : numbers.format(value);
}

export function scoreLabel(score: ScoreSummary | null) {
  return score?.total == null ? '—' : `${numbers.format(score.total)} / 100`;
}

export const appealStatusLabel: Record<Appeal['status'], string> = {
  pending: 'На рассмотрении',
  resolved: 'Решена',
};
