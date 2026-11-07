import { describe, expect, it } from 'vitest';
import type { ChecklistInput } from '../../shared/contracts.js';
import { newCriterion, toChecklistDraft, validateChecklistDraft } from './ChecklistEditor.model.js';

const input: ChecklistInput = {
  title: 'Проверка обслуживания',
  sections: [{ id: 'service', title: 'Обслуживание' }],
  criteria: [
    {
      id: 'help',
      sectionId: 'service',
      title: 'Помощь',
      instruction: 'Проверить ответ.',
      answerType: 'scale',
      scoringMode: 'weighted',
      weight: 20,
      levels: [0, 5, 10],
      levelDescriptions: { '0': 'Нет ответа', '5': 'Частично', '10': 'Полностью' },
      allowNA: true,
      naRule: 'Клиент не задавал вопрос.',
    },
  ],
};

describe('Checklist editor serialization boundary', () => {
  it('round-trips scale meanings and makes independent drafts', () => {
    const draft = toChecklistDraft(input);
    expect(validateChecklistDraft(draft).input).toEqual(input);
    draft.criteria[0].levels[0].description = 'Изменено';
    draft.sections[0].title = 'Новый раздел';
    expect(input.criteria[0].levelDescriptions['0']).toBe('Нет ответа');
    expect(input.sections[0].title).toBe('Обслуживание');
  });

  it.each(['', ' ', '-1', '10001', 'NaN', 'Infinity', '12oops'])(
    'rejects invalid weight %j',
    (weight) => {
      const draft = toChecklistDraft(input);
      draft.criteria[0].weight = weight;
      expect(validateChecklistDraft(draft).errors).toContainEqual(
        expect.objectContaining({ path: 'criteria.0.weight' }),
      );
    },
  );

  it.each([['0', '0'], ['1', '2'], ['0'], ['0', ''], ['0', '-2']])(
    'rejects malformed levels %j',
    (...values) => {
      const draft = toChecklistDraft(input);
      draft.criteria[0].levels = values.map((value, index) => ({
        key: String(index),
        value,
        description: '',
      }));
      expect(validateChecklistDraft(draft).input).toBeNull();
    },
  );

  it('accepts decimal levels and keys their descriptions by the serialized numeric value', () => {
    const draft = toChecklistDraft(input);
    draft.criteria[0].levels[1] = {
      key: 'half',
      value: '1.50',
      description: ' Частично выполнено ',
    };
    const saved = validateChecklistDraft(draft).input;
    expect(saved?.criteria[0].levels).toEqual([0, 1.5, 10]);
    expect(saved?.criteria[0].levelDescriptions['1.5']).toBe('Частично выполнено');
  });

  it('requires an applicability rule and drops it only when N/A is disabled', () => {
    const draft = toChecklistDraft(input);
    draft.criteria[0].naRule = '  ';
    expect(validateChecklistDraft(draft).errors[0].path).toBe('criteria.0.naRule');
    draft.criteria[0].allowNA = false;
    expect(validateChecklistDraft(draft).input?.criteria[0].naRule).toBeNull();
  });

  it('omits retained scale drafts after switching to binary', () => {
    const draft = toChecklistDraft(input);
    draft.criteria[0].answerType = 'binary';
    expect(validateChecklistDraft(draft).input?.criteria[0]).toMatchObject({
      levels: [],
      levelDescriptions: {},
    });
    expect(draft.criteria[0].levels).toHaveLength(3);
  });

  it('enforces flag restrictions through the shared schema', () => {
    const draft = toChecklistDraft(input);
    draft.criteria[0].scoringMode = 'flag';
    expect(validateChecklistDraft(draft).input).toBeNull();
    Object.assign(draft.criteria[0], { answerType: 'binary', weight: '0', allowNA: false });
    expect(validateChecklistDraft(draft).input).not.toBeNull();
  });

  it('requires text on new criteria and retains assigned identity on save', () => {
    const draft = toChecklistDraft(input);
    draft.criteria.push(newCriterion('added-criterion', 'service'));
    expect(validateChecklistDraft(draft).errors.map((error) => error.path)).toEqual([
      'criteria.1.title',
      'criteria.1.instruction',
    ]);
    Object.assign(draft.criteria[1], { title: ' Прощание ', instruction: ' Проверить прощание. ' });
    expect(validateChecklistDraft(draft).input?.criteria[1]).toMatchObject({
      id: 'added-criterion',
      title: 'Прощание',
      instruction: 'Проверить прощание.',
    });
  });

  it('rejects duplicate identities and unknown sections', () => {
    const draft = toChecklistDraft(input);
    draft.criteria.push({ ...draft.criteria[0], sectionId: 'missing' });
    expect(validateChecklistDraft(draft).input).toBeNull();
  });
});
