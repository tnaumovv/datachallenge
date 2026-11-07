import {
  ChecklistInputSchema,
  type ChecklistInput,
  type Criterion,
} from '../../shared/contracts.js';

export type LevelDraft = { key: string; value: string; description: string };
export type CriterionDraft = Omit<Criterion, 'weight' | 'levels' | 'levelDescriptions'> & {
  weight: string;
  levels: LevelDraft[];
};
export type ChecklistDraft = Omit<ChecklistInput, 'criteria'> & { criteria: CriterionDraft[] };
export type DraftError = { path: string; message: string };

export function toChecklistDraft(input: ChecklistInput): ChecklistDraft {
  return {
    title: input.title,
    sections: input.sections.map((section) => ({ ...section })),
    criteria: input.criteria.map(({ levels, levelDescriptions, weight, ...criterion }) => ({
      ...criterion,
      weight: String(weight),
      levels: levels.map((level, index) => ({
        key: `${criterion.id}-${index}`,
        value: String(level),
        description: levelDescriptions[String(level)] ?? '',
      })),
    })),
  };
}

export function newCriterion(id: string, sectionId: string): CriterionDraft {
  return {
    id,
    sectionId,
    title: '',
    instruction: '',
    answerType: 'binary',
    scoringMode: 'weighted',
    weight: '10',
    levels: [],
    allowNA: false,
    naRule: null,
  };
}

function numeric(value: string): number {
  return value.trim() ? Number(value) : Number.NaN;
}

export function validateChecklistDraft(
  draft: ChecklistDraft,
): { input: ChecklistInput; errors: [] } | { input: null; errors: DraftError[] } {
  const candidate: ChecklistInput = {
    title: draft.title.trim(),
    sections: draft.sections.map((section) => ({ ...section })),
    criteria: draft.criteria.map(({ weight, levels, ...criterion }) => ({
      ...criterion,
      title: criterion.title.trim(),
      instruction: criterion.instruction.trim(),
      weight: numeric(weight),
      levels: criterion.answerType === 'scale' ? levels.map((level) => numeric(level.value)) : [],
      levelDescriptions:
        criterion.answerType === 'scale'
          ? Object.fromEntries(
              levels
                .filter((level) => level.description.trim())
                .map((level) => [String(numeric(level.value)), level.description.trim()]),
            )
          : {},
      naRule: criterion.allowNA ? (criterion.naRule?.trim() ?? '') : null,
    })),
  };
  const result = ChecklistInputSchema.safeParse(candidate);
  if (result.success) return { input: result.data, errors: [] };

  const errors = result.error.issues.map((issue): DraftError => {
    let path = issue.path.join('.');
    if (path === 'title') return { path, message: 'Введите название чек-листа.' };
    const index = issue.path[0] === 'criteria' ? Number(issue.path[1]) : -1;
    const criterion = candidate.criteria[index];
    if (!criterion) return { path: 'form', message: 'Проверьте разделы и состав критериев.' };
    const prefix = `Критерий ${index + 1}: `;
    const field = issue.path[2];
    if (field === 'title') return { path, message: `${prefix}введите название.` };
    if (field === 'instruction')
      return { path, message: `${prefix}добавьте формулировку проверки.` };
    if (field === 'weight')
      return { path, message: `${prefix}вес должен быть числом от 0 до 10 000.` };
    if (field === 'levels') {
      if (typeof issue.path[3] === 'number') path += '.value';
      return { path, message: `${prefix}уровни должны быть неотрицательными числами.` };
    }
    if (criterion.allowNA && !criterion.naRule?.trim()) {
      return {
        path: `criteria.${index}.naRule`,
        message: `${prefix}опишите, когда критерий неприменим.`,
      };
    }
    if (criterion.scoringMode === 'flag') {
      return {
        path: `criteria.${index}.answerType`,
        message: `${prefix}отдельная отметка допускает только «Да / Нет», нулевой вес и не допускает N/A.`,
      };
    }
    return {
      path: `criteria.${index}.levels`,
      message: `${prefix}укажите минимум два разных уровня, включая 0 и положительный максимум.`,
    };
  });
  return { input: null, errors: [...new Map(errors.map((error) => [error.path, error])).values()] };
}
