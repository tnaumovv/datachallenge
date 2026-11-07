import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defaultChecklist } from '../src/checklists/default.js';
import { buildRubricJsonSchema, parseRubricOutput } from '../src/evaluations/rubric.js';
import type { ChecklistVersion, Conversation } from '../../shared/contracts.js';
import { createDatabase } from '../src/db.js';
import { ChecklistService } from '../src/checklists/service.js';
import { EvaluationService } from '../src/evaluations/service.js';

const conversation: Conversation = {
  id: 'new',
  sourceConversationId: 'unseen',
  groupId: 'TEST',
  transcriptHash: 'hash',
  channel: 'agent chat',
  language: 'RU',
  audioUrl: null,
  importedAt: 'now',
  messages: [
    { id: 'm1', speaker: 'client', timestamp: '00:00', text: 'Где справка и тарифы?' },
    {
      id: 'm2',
      speaker: 'operator',
      timestamp: '00:01',
      text: 'Здравствуйте, я Анна. Справка в меню.',
    },
    { id: 'm3', speaker: 'client', timestamp: '00:02', text: 'А тарифы?' },
    { id: 'm4', speaker: 'operator', timestamp: '00:03', text: 'До свидания.' },
  ],
};
const checklist: ChecklistVersion = {
  ...defaultChecklist,
  id: 'v',
  checklistId: 'default',
  version: 1,
  createdAt: 'now',
};
function selected(id: string): ChecklistVersion {
  return { ...checklist, criteria: checklist.criteria.filter((c) => c.id === id) };
}
function raw(id: string, facts: Record<string, unknown>) {
  return {
    answers: {
      [id]: { evidenceMessageIds: ['m2'], checkedSpanMessageIds: ['m1', 'm2', 'm3', 'm4'], facts },
    },
  };
}
function value(id: string, facts: Record<string, unknown>) {
  return parseRubricOutput(raw(id, facts), conversation, selected(id))[0].value;
}

describe('standard rubric values derived from observed facts', () => {
  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])(
    'requires both same-language greeting %s and introduction %s',
    (greetedInClientLanguage, introducedSelf, expected) => {
      expect(value('contact', { greetedInClientLanguage, introducedSelf })).toBe(expected);
    },
  );
  it('derives N/A before a positive needs answer when information was already sufficient', () => {
    const answer = parseRubricOutput(
      raw('needs', { missingDetailsAtHandoff: [] }),
      conversation,
      selected('needs'),
    )[0];
    expect(answer.value).toBe('NA');
    expect(answer.naReason).toMatch(/достаточно/);
    const needsConversation = {
      ...conversation,
      messages: conversation.messages.map((m) =>
        m.id === 'm2' ? { ...m, text: 'Какой формат файла нужен?' } : m,
      ),
    };
    for (const beforeAction of [true, false]) {
      expect(
        parseRubricOutput(
          raw('needs', {
            missingDetailsAtHandoff: [
              {
                detail: 'Формат файла',
                clarification: { messageId: 'm2', quote: 'Какой формат файла нужен?' },
                clarifiedBeforeAction: beforeAction,
              },
            ],
          }),
          needsConversation,
          selected('needs'),
        )[0].value,
      ).toBe(beforeAction);
    }
  });
  it('separates identity applicability and verification order', () => {
    expect(value('identity', { requiresIdentity: false, verifiedBeforeProtectedStep: false })).toBe(
      'NA',
    );
    expect(value('identity', { requiresIdentity: true, verifiedBeforeProtectedStep: false })).toBe(
      false,
    );
    expect(value('identity', { requiresIdentity: true, verifiedBeforeProtectedStep: true })).toBe(
      true,
    );
  });
  it.each([
    [[true, true], false, false, false, 20],
    [[true, true], true, false, false, 15],
    [[true, false], false, false, false, 10],
    [[false], false, true, false, 5],
    [[false], false, false, false, 0],
    [[true], false, false, true, 0],
  ])(
    'maps question coverage %j to the published consultation step',
    (addressed, secondaryDetailMissing, vagueGuidanceOnly, keyAdviceWrong, expected) => {
      expect(
        value('consultation', {
          requestFormulated: true,
          questions: addressed.map((hit, i) => ({ question: 'Вопрос ' + i, addressed: hit })),
          secondaryDetailMissing,
          vagueGuidanceOnly,
          keyAdviceWrong,
        }),
      ).toBe(expected);
    },
  );
  it('does not equate an unformulated request with failed consultation', () => {
    expect(
      value('consultation', {
        requestFormulated: false,
        questions: [],
        secondaryDetailMissing: false,
        vagueGuidanceOnly: false,
        keyAdviceWrong: false,
      }),
    ).toBe('NA');
  });
  it.each([
    [false, false, false, 10],
    [false, false, true, 7],
    [false, true, false, 4],
    [true, true, true, 0],
  ])(
    'maps clarity facts independently of unanswered questions',
    (unintelligible, clientHadToClarifyWording, minorLapse, expected) => {
      expect(value('dialogue', { unintelligible, clientHadToClarifyWording, minorLapse })).toBe(
        expected,
      );
    },
  );
  it('keeps politeness independent from the completeness of a consultation', () => {
    expect(
      value('empathy', {
        polite: true,
        specificProblemExpressed: false,
        specificProblemAddressed: false,
      }),
    ).toBe(true);
    expect(
      value('empathy', {
        polite: true,
        specificProblemExpressed: true,
        specificProblemAddressed: false,
      }),
    ).toBe(false);
  });
  it('requires a real interruption for closing N/A and both closing actions for true', () => {
    const closingConversation = {
      ...conversation,
      messages: conversation.messages.map((m) =>
        m.id === 'm4' ? { ...m, text: 'Заявка принята. До свидания.' } : m,
      ),
    };
    const closingValue = (facts: Record<string, unknown>) => {
      const output = raw('closing', facts);
      output.answers.closing.evidenceMessageIds = ['m4'];
      return parseRubricOutput(output, closingConversation, selected('closing'))[0].value;
    };
    expect(
      closingValue({
        interruptedBeforeOpportunity: true,
        summaryOrOffer: null,
        farewell: null,
      }),
    ).toBe('NA');
    expect(
      closingValue({
        interruptedBeforeOpportunity: false,
        summaryOrOffer: null,
        farewell: { messageId: 'm4', quote: 'До свидания.' },
      }),
    ).toBe(false);
    expect(
      closingValue({
        interruptedBeforeOpportunity: false,
        summaryOrOffer: { kind: 'summary', messageId: 'm4', quote: 'Заявка принята.' },
        farewell: { messageId: 'm4', quote: 'До свидания.' },
      }),
    ).toBe(true);
  });
  it('flags a private paid offer regardless of client acceptance', () => {
    expect(
      value('gross', { insult: false, privatePaidOffer: true, confidentialDisclosure: false }),
    ).toBe(true);
    expect(
      value('gross', { insult: false, privatePaidOffer: false, confidentialDisclosure: false }),
    ).toBe(false);
  });
});

describe('protocol constraints and genuinely dynamic criteria', () => {
  it('does not let a later operator turn or bot introduction support first contact', () => {
    const wrong = raw('contact', { greetedInClientLanguage: true, introducedSelf: true });
    Object.values(wrong.answers)[0].evidenceMessageIds = ['m4'];
    expect(() => parseRubricOutput(wrong, conversation, selected('contact'))).toThrow();
  });
  it('requires operator evidence for partial numeric grades in the generation schema', () => {
    const schema = z.fromJSONSchema(buildRubricJsonSchema(conversation, selected('dialogue')));
    const output = raw('dialogue', {
      unintelligible: false,
      clientHadToClarifyWording: true,
      minorLapse: false,
    });
    expect(schema.safeParse(output).success).toBe(true);
    Object.values(output.answers)[0].evidenceMessageIds = [];
    expect(schema.safeParse(output).success).toBe(false);
    Object.values(output.answers)[0].evidenceMessageIds = ['m3'];
    expect(schema.safeParse(output).success).toBe(false);
  });
  it('retains an edited built-in scale and client-role evidence instead of applying fixed rules', () => {
    const edited = selected('contact');
    edited.criteria[0] = {
      ...edited.criteria[0],
      instruction: 'Оцени благодарность клиента по шкале.',
      answerType: 'scale',
      levels: [0, 3, 6],
      levelDescriptions: { '0': 'Нет', '3': 'Частично', '6': 'Да' },
    };
    const output = raw('contact', {
      value: 3,
      explanation: 'Клиент частично выразил благодарность.',
      naReason: null,
    });
    Object.values(output.answers)[0].evidenceMessageIds = ['m3'];
    expect(parseRubricOutput(output, conversation, edited)[0].value).toBe(3);
    Object.values(output.answers)[0].facts.value = 20;
    expect(() => parseRubricOutput(output, conversation, edited)).toThrow();
  });
  it('does not apply standard N/A semantics to a customized applicability rule', () => {
    const edited = selected('needs');
    edited.criteria[0] = { ...edited.criteria[0], allowNA: false, naRule: null };
    expect(
      parseRubricOutput(
        raw('needs', {
          value: true,
          explanation: 'Условие пользовательского критерия выполнено.',
          naReason: null,
        }),
        conversation,
        edited,
      )[0].value,
    ).toBe(true);
    expect(() =>
      parseRubricOutput(raw('needs', { missingDetailsAtHandoff: [] }), conversation, edited),
    ).toThrow();
  });
  it('rejects missing, duplicate, unknown criteria and unknown fields', () => {
    const output = raw('contact', { greetedInClientLanguage: true, introducedSelf: true });
    expect(() => parseRubricOutput({ answers: [] }, conversation, selected('contact'))).toThrow();
    expect(() =>
      parseRubricOutput(
        { answers: [Object.values(output.answers)[0], Object.values(output.answers)[0]] },
        conversation,
        selected('contact'),
      ),
    ).toThrow();
    expect(() =>
      parseRubricOutput(
        { answers: [{ ...Object.values(output.answers)[0], criterionId: 'invented' }] },
        conversation,
        selected('contact'),
      ),
    ).toThrow();
    expect(() =>
      parseRubricOutput(
        { answers: [{ ...Object.values(output.answers)[0], value: false }] },
        conversation,
        selected('contact'),
      ),
    ).toThrow();
  });
  it('requires a checked span even for nonapplicable criteria', () => {
    const output = raw('needs', { missingDetailsAtHandoff: [] });
    Object.values(output.answers)[0].checkedSpanMessageIds = [];
    expect(() => parseRubricOutput(output, conversation, selected('needs'))).toThrow();
  });
  it('rejects a custom applicability reason attached to an applicable value', () => {
    const edited = selected('contact');
    edited.criteria[0] = { ...edited.criteria[0], instruction: 'Оцени реакцию клиента.' };
    expect(() =>
      parseRubricOutput(
        raw('contact', {
          value: true,
          explanation: 'Клиент отреагировал.',
          naReason: 'Неприменимо.',
        }),
        conversation,
        edited,
      ),
    ).toThrow();
  });
  it.each([100, 1500])(
    'keeps %i transcript IDs within API enum limits and enforces literal IDs',
    (count) => {
      const long = {
        ...conversation,
        messages: Array.from({ length: count }, (_, i) => ({
          id: `m[${i}]`,
          speaker: i % 2 ? ('operator' as const) : ('client' as const),
          timestamp: '00:00',
          text: 'Реплика.',
        })),
      };
      const schema = buildRubricJsonSchema(long, selected('contact'));
      const countEnums = (x: unknown): number =>
        x && typeof x === 'object'
          ? Array.isArray(x)
            ? x.reduce((n, item) => n + countEnums(item), 0)
            : Object.entries(x).reduce(
                (n, [k, v]) => n + (k === 'enum' && Array.isArray(v) ? v.length : countEnums(v)),
                0,
              )
          : 0;
      expect(countEnums(schema)).toBeLessThanOrEqual(1000);
      const validator = z.fromJSONSchema(schema);
      const output = raw('contact', { greetedInClientLanguage: true, introducedSelf: true });
      Object.values(output.answers)[0].evidenceMessageIds = ['m[1]'];
      Object.values(output.answers)[0].checkedSpanMessageIds = ['m[0]'];
      expect(validator.safeParse(output).success).toBe(true);
      Object.values(output.answers)[0].evidenceMessageIds = ['m1'];
      expect(validator.safeParse(output).success).toBe(false);
    },
  );
});

it('integrates rubric facts into the real queue and repairs an invalid first response', async () => {
  const db = createDatabase(':memory:');
  const saved = new ChecklistService(db).save('default', selected('contact'));
  db.prepare('INSERT INTO conversations VALUES (?,?,?,?,?)').run(
    conversation.id,
    conversation.groupId,
    conversation.sourceConversationId,
    conversation.transcriptHash,
    JSON.stringify(conversation),
  );
  let calls = 0;
  let repairReceived = false;
  const provider = {
    id: 'test',
    modelId: 'test',
    configurationId: 'rubric',
    outputFormat: 'rubric-v7' as const,
    promptVersion: 'cqa-evaluator-v7',
    async generate(input: { repair?: unknown }) {
      calls++;
      repairReceived ||= Boolean(input.repair);
      const output = raw('contact', { greetedInClientLanguage: true, introducedSelf: true });
      if (calls === 1) Object.values(output.answers)[0].evidenceMessageIds = [];
      return { text: JSON.stringify(output), usage: {} };
    },
  };
  const service = new EvaluationService(db, provider, { retryDelayMs: 1 });
  try {
    service.start();
    const [id] = service.enqueue([conversation.id], saved.id);
    for (let i = 0; i < 200 && ['queued', 'running'].includes(service.get(id)!.status); i++)
      await new Promise((r) => setTimeout(r, 2));
    const evaluation = service.get(id)!;
    expect(evaluation.status).toBe('completed');
    expect(evaluation.promptVersion).toBe('cqa-evaluator-v7');
    expect(evaluation.originalAnswers[0].value).toBe(true);
    expect(evaluation.originalAnswers[0].explanation).toMatch(/представления/);
    expect(repairReceived).toBe(true);
    expect(calls).toBe(2);
  } finally {
    await service.stop();
    db.close();
  }
});

it('avoids provider decoding-state bounds while retaining strict server limits', () => {
  const schema = buildRubricJsonSchema(conversation, checklist);
  const finiteCaps: unknown[] = [];
  const walk = (x: unknown) => {
    if (x && typeof x === 'object')
      for (const [key, value] of Object.entries(x)) {
        if ((key === 'maxItems' || key === 'maxLength') && value !== 0) finiteCaps.push(value);
        else walk(value);
      }
  };
  walk(schema);
  expect(finiteCaps).toEqual([]);
  const edited = selected('contact');
  edited.criteria[0] = { ...edited.criteria[0], instruction: 'Пользовательское правило.' };
  expect(() =>
    parseRubricOutput(
      raw('contact', { value: true, explanation: 'я'.repeat(801), naReason: null }),
      conversation,
      edited,
    ),
  ).toThrow();
});

it('preserves grounded knowledge references through standard fact derivation', () => {
  const knowledge = {
    retrievalVersion: 'fts-v1' as const,
    status: 'matched' as const,
    date: null,
    datedRulesSkipped: false,
    sources: [
      {
        reference: 'K1',
        id: 'rule',
        documentKey: 'test',
        title: 'Правило',
        source: 'Тест',
        version: '1',
        language: 'RU' as const,
        effectiveFrom: null,
        effectiveTo: null,
        contentHash: 'hash',
        chunkIndex: 0,
        text: 'Описание правила.',
      },
    ],
  };
  const output = raw('consultation', {
    requestFormulated: true,
    keyAdviceWrong: true,
    questions: [{ question: 'Как выполнить действие?', addressed: false }],
    secondaryDetailMissing: false,
    vagueGuidanceOnly: false,
  });
  const enriched = {
    answers: {
      consultation: {
        ...output.answers.consultation,
        knowledgeReferenceIds: ['K1'],
        verificationLimitation: null,
      },
    },
  };
  const schema = z.fromJSONSchema(
    buildRubricJsonSchema(conversation, selected('consultation'), knowledge),
  );
  expect(schema.safeParse(enriched).success).toBe(true);
  const answer = parseRubricOutput(enriched, conversation, selected('consultation'), knowledge)[0];
  expect(answer.value).toBe(0);
  expect(answer.explanation).toContain('[K1]');
  enriched.answers.consultation.knowledgeReferenceIds = ['K99'];
  expect(() =>
    parseRubricOutput(enriched, conversation, selected('consultation'), knowledge),
  ).toThrow();
  expect(() => parseRubricOutput(enriched, conversation, selected('consultation'))).toThrow();
});

it('states the verification boundary and question even for a full consultation without regulations', () => {
  const output = raw('consultation', {
    requestFormulated: true,
    keyAdviceWrong: false,
    questions: [{ question: 'Стоимость подписки', addressed: true }],
    secondaryDetailMissing: false,
    vagueGuidanceOnly: false,
  });
  const answer = parseRubricOutput(output, conversation, selected('consultation'))[0];
  expect(answer.value).toBe(20);
  expect(answer.explanation).toContain('Стоимость подписки');
  expect(answer.explanation).toMatch(/Ограничение проверки/);
});

it('retains conflicting-source limitations without automatically reducing the consultation value', () => {
  const source = {
    reference: 'K1',
    id: 'rule1',
    documentKey: 'price',
    title: 'Цена',
    source: 'Тест',
    version: '1',
    language: 'RU' as const,
    effectiveFrom: null,
    effectiveTo: null,
    contentHash: 'hash',
    chunkIndex: 0,
    text: 'Подписка стоит 1000 тенге.',
  };
  const knowledge = {
    retrievalVersion: 'fts-v1' as const,
    status: 'matched' as const,
    date: null,
    datedRulesSkipped: false,
    sources: [
      source,
      { ...source, reference: 'K2', id: 'rule2', version: '2', text: 'Подписка стоит 2000 тенге.' },
    ],
  };
  const output = raw('consultation', {
    requestFormulated: true,
    keyAdviceWrong: false,
    questions: [{ question: 'Стоимость подписки', addressed: true }],
    secondaryDetailMissing: false,
    vagueGuidanceOnly: false,
  });
  const limitation =
    'Переданные выдержки содержат разные цены; правильную стоимость подтвердить нельзя.';
  const wire = {
    answers: {
      consultation: {
        ...output.answers.consultation,
        knowledgeReferenceIds: ['K1', 'K2'],
        verificationLimitation: limitation,
      },
    },
  };
  expect(
    z
      .fromJSONSchema(buildRubricJsonSchema(conversation, selected('consultation'), knowledge))
      .safeParse(wire).success,
  ).toBe(true);
  const answer = parseRubricOutput(wire, conversation, selected('consultation'), knowledge)[0];
  expect(answer.value).toBe(20);
  expect(answer.explanation).toContain(limitation);
  expect(answer.explanation).toContain('[K1]');
  expect(answer.explanation).toContain('[K2]');
});
