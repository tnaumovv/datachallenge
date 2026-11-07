import { z } from 'zod';
import type {
  ChecklistVersion,
  Conversation,
  Criterion,
  CriterionAnswer,
} from '../../../shared/contracts.js';
import { isStandardOperatorCriterion, validateEvidence } from './evidence.js';
import { scoreEvaluation } from './scoring.js';
import { OutputValidationError } from './validation.js';
import type { KnowledgeSnapshot } from '../../../shared/knowledge.js';
import { validateKnowledgeReferences } from '../knowledge/prompt.js';

export const RUBRIC_VERSION = 'cqa-evaluator-v7.2';

const quotedObservation = z
  .object({
    messageId: z.string().min(1),
    quote: z
      .string()
      .trim()
      .min(1)
      .max(800)
      .describe(
        'Дословный минимальный фрагмент реплики самого оператора, подтверждающий именно это действие. Не пересказ.',
      ),
  })
  .strict();

const factsSchemas = {
  contact: z
    .object({
      greetedInClientLanguage: z
        .boolean()
        .describe('Приветствие самого оператора на языке клиента в первой реплике оператора.'),
      introducedSelf: z
        .boolean()
        .describe(
          'Сам оператор назвал себя в первой реплике. Одного имени достаточно; фамилия, компания и должность не обязательны.',
        ),
    })
    .strict(),
  needs: z
    .object({
      missingDetailsAtHandoff: z
        .array(
          z
            .object({
              detail: z
                .string()
                .trim()
                .min(1)
                .max(180)
                .describe(
                  'Конкретная существенная деталь, неизвестная до первого ответа оператора и необходимая для ответа на реальный запрос.',
                ),
              clarification: quotedObservation
                .nullable()
                .describe(
                  'Дословный вопрос/просьба ОПЕРАТОРА сообщить эту неизвестную деталь; null, если он не спрашивал. Инструкция клиенту и готовый ответ не являются уточнением.',
                ),
              clarifiedBeforeAction: z
                .boolean()
                .describe(
                  'Этот необходимый вопрос задан до содержательного ответа/выполненного действия. Вопрос до ухода клиента учитывается. При clarification=null ставь false.',
                ),
            })
            .strict(),
        )
        .max(30)
        .describe(
          'Сначала перечисли детали, реально недостающие ДО оператора. Если для ответа уже всего достаточно, верни []: это N/A. Не включай сведения, уже сообщённые клиентом боту. Общая навигация не требует выдумывать дополнительные детали.',
        ),
    })
    .strict(),
  identity: z
    .object({
      requiresIdentity: z
        .boolean()
        .describe(
          'Запрос требует раскрытия защищенных данных или защищенного действия оператора. Общая справка и самостоятельная навигация клиента — false.',
        ),
      verifiedBeforeProtectedStep: z
        .boolean()
        .describe(
          'В тексте явно подтверждена проверка личности ДО защищенного шага, включая системное подтверждение. Проверка после действия — false.',
        ),
    })
    .strict(),
  consultation: z
    .object({
      requestFormulated: z
        .boolean()
        .describe(
          'Клиент сформулировал содержательный запрос. Просто просьба подключить человека без вопроса — false.',
        ),
      keyAdviceWrong: z
        .boolean()
        .describe(
          'Ключевой совет явно неверен по доступному контексту. Не считай этим ошибку идентификации или неясную формулировку; не выдумывай внешние правила продукта.',
        ),
      questions: z
        .array(
          z
            .object({
              question: z
                .string()
                .min(1)
                .max(180)
                .describe('Краткое название существенного вопроса клиента по-русски.'),
              addressed: z
                .boolean()
                .describe(
                  'На этот вопрос дан корректный ответ ИЛИ конкретный корректный следующий шаг. Вопрос, который оператор проигнорировал, — false.',
                ),
            })
            .strict(),
        )
        .max(30)
        .describe(
          'Все существенные вопросы клиента, включая оставшиеся без ответа. Не удаляй нерешенные вопросы.',
        ),
      secondaryDetailMissing: z
        .boolean()
        .describe('Пропущена второстепенная деталь при решении всех существенных вопросов.'),
      vagueGuidanceOnly: z
        .boolean()
        .describe('Есть только общая подсказка без понятного следующего шага.'),
    })
    .strict(),
  empathy: z
    .object({
      polite: z
        .boolean()
        .describe(
          'Оператор вежлив. Отсутствие приветствия или неполный ответ сами по себе не делают вежливость false.',
        ),
      specificProblemExpressed: z
        .boolean()
        .describe('Клиент описал конкретное неудобство или недовольство, требующее реакции.'),
      specificProblemAddressed: z
        .boolean()
        .describe(
          'Оператор конкретно отреагировал на это неудобство. Если неудобства не было, этот признак не требуется.',
        ),
    })
    .strict(),
  dialogue: z
    .object({
      unintelligible: z
        .boolean()
        .describe(
          'Из-за бессвязных или противоречивых формулировок ход разговора непонятен. Неполный ответ или отсутствие прощания сами по себе не означают это.',
        ),
      clientHadToClarifyWording: z
        .boolean()
        .describe(
          'Клиент вынужден переспросить ИЗ-ЗА непонятной формулировки или порядка. Напоминание о другом неотвеченном вопросе — не такой переспрос.',
        ),
      minorLapse: z
        .boolean()
        .describe(
          'Один заметный сбой ясности/последовательности или отсутствие предупреждения о явном ожидании, но клиент понимает ответ и может продолжить. Не учитывай порог 3 минуты.',
        ),
    })
    .strict(),
  closing: z
    .object({
      interruptedBeforeOpportunity: z
        .boolean()
        .describe(
          'Есть явный обрыв до возможности завершить диалог. Обычное закрытие оператором без прощания — false.',
        ),
      summaryOrOffer: quotedObservation
        .extend({ kind: z.enum(['summary', 'next_step', 'help_offer']) })
        .nullable()
        .describe(
          'Отдельная дословная цитата итога, согласованного следующего шага или предложения ДАЛЬНЕЙШЕЙ помощи в завершении. null, если есть только благодарность, «пожалуйста» или пожелание хорошего дня. Первый ответ сам по себе не итог.',
        ),
      farewell: quotedObservation
        .nullable()
        .describe(
          'Отдельная дословная цитата прощания самого оператора; null, если отсутствует. Не используй эту же фразу как итог/предложение помощи.',
        ),
    })
    .strict(),
  gross: z
    .object({
      insult: z.boolean().describe('Оператор оскорбил клиента.'),
      privatePaidOffer: z
        .boolean()
        .describe(
          'Оператор предложил платную услугу в обход компании. Самого предложения достаточно, отказ клиента не отменяет факт.',
        ),
      confidentialDisclosure: z
        .boolean()
        .describe('Оператор раскрыл конфиденциальные сведения неуполномоченному собеседнику.'),
    })
    .strict(),
};
type StandardId = keyof typeof factsSchemas;
export function standardRubricId(criterion: Criterion): StandardId | null {
  return isStandardOperatorCriterion(criterion) && criterion.id in factsSchemas
    ? (criterion.id as StandardId)
    : null;
}

function factsSchema(criterion: Criterion) {
  const kind = standardRubricId(criterion);
  if (kind) return factsSchemas[kind];
  const applicable =
    criterion.answerType === 'binary'
      ? z.boolean()
      : z.number().refine((n) => criterion.levels.includes(n), 'Value is outside the saved scale');
  return z
    .object({
      explanation: z.string().trim().min(1).max(800),
      naReason: z.string().nullable(),
      value: criterion.allowNA ? z.union([applicable, z.literal('NA')]) : applicable,
    })
    .strict();
}

function groups(conversation: Conversation) {
  const operator = conversation.messages.filter((m) => m.speaker === 'operator').map((m) => m.id);
  return {
    message: conversation.messages.map((m) => m.id),
    operator,
    contact: operator.slice(0, 1),
    identity: conversation.messages
      .filter((m) => m.speaker === 'operator' || m.speaker === 'system')
      .map((m) => m.id),
  };
}
function evidenceGroup(c: Criterion): keyof ReturnType<typeof groups> {
  const standard = standardRubricId(c);
  return standard === 'contact'
    ? 'contact'
    : standard === 'identity'
      ? 'identity'
      : standard
        ? 'operator'
        : 'message';
}
function idsSchema(ids: string[]) {
  return z
    .array(z.string().refine((id) => ids.includes(id), 'Unknown message or inappropriate speaker'))
    .min(ids.length ? 1 : 0)
    .max(ids.length)
    .refine((values) => new Set(values).size === values.length, 'Duplicate message IDs');
}

/** Schema constrains observations and locations; no reference decisions are present. */
export function buildRubricJsonSchema(
  conversation: Conversation,
  checklist: ChecklistVersion,
  knowledge?: KnowledgeSnapshot,
): z.core.JSONSchema.JSONSchema {
  const source = groups(conversation);
  const references = knowledge?.sources.map((s) => s.reference) ?? [];
  const count =
    Object.values(source).reduce((n, ids) => n + ids.length, 0) +
    references.length * checklist.criteria.length +
    checklist.criteria.reduce((n, c) => n + c.levels.length + 2, 0);
  const definitions: Record<string, z.core.JSONSchema.JSONSchema> = Object.fromEntries(
    Object.entries(source)
      .filter(([, ids]) => ids.length)
      .map(([name, ids]) => [
        name,
        count <= 900
          ? { type: 'string', enum: ids }
          : {
              type: 'string',
              pattern:
                '^(?:' +
                ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') +
                ')$',
            },
      ]),
  );
  const schema: z.core.JSONSchema.JSONSchema = {
    $defs: definitions,
    type: 'object',
    additionalProperties: false,
    required: ['answers'],
    properties: {
      answers: {
        type: 'object',
        additionalProperties: false,
        required: checklist.criteria.map((c) => c.id),
        properties: Object.fromEntries(
          checklist.criteria.map((c) => {
            const kind = standardRubricId(c);
            const facts: z.core.JSONSchema.JSONSchema = kind
              ? z.toJSONSchema(factsSchemas[kind])
              : {
                  type: 'object',
                  additionalProperties: false,
                  required: ['explanation', 'naReason', 'value'],
                  properties: {
                    explanation: { type: 'string', minLength: 1, maxLength: 800 },
                    naReason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                    value: {
                      anyOf: [
                        c.answerType === 'binary'
                          ? { type: 'boolean' }
                          : { type: 'number', enum: c.levels },
                        ...(c.allowNA ? [{ type: 'string' as const, enum: ['NA'] }] : []),
                      ],
                    },
                  },
                };
            delete (facts as Record<string, unknown>).$schema;
            const group = evidenceGroup(c);
            const evidence: z.core.JSONSchema.JSONSchema = source[group].length
              ? {
                  type: 'array',
                  minItems: 1,
                  maxItems: source[group].length,
                  items: { $ref: '#/$defs/' + group },
                }
              : { type: 'array', maxItems: 0, items: { type: 'string' } };
            return [
              c.id,
              {
                type: 'object',
                additionalProperties: false,
                required: [
                  'evidenceMessageIds',
                  'checkedSpanMessageIds',
                  'facts',
                  ...(references.length ? ['knowledgeReferenceIds'] : []),
                  ...(references.length && kind === 'consultation'
                    ? ['verificationLimitation']
                    : []),
                ],
                properties: {
                  ...(references.length && kind === 'consultation'
                    ? {
                        verificationLimitation: {
                          anyOf: [
                            { type: 'string' as const, minLength: 1 },
                            { type: 'null' as const },
                          ],
                        },
                      }
                    : {}),
                  ...(references.length
                    ? {
                        knowledgeReferenceIds: {
                          type: 'array' as const,
                          items: { type: 'string' as const, enum: references },
                        },
                      }
                    : {}),
                  evidenceMessageIds: evidence,
                  checkedSpanMessageIds: {
                    type: 'array',
                    minItems: 1,
                    maxItems: source.message.length,
                    items: { $ref: '#/$defs/message' },
                  },
                  facts,
                },
              },
            ];
          }),
        ),
      },
    },
  };
  // Combined array/string upper bounds cause Gemini's decoding constraint to
  // reject otherwise valid longer conversations (HTTP 400). Keep membership,
  // required fields and nonempty evidence in generation; enforce every upper
  // bound with the stricter Zod parser below.
  const omitUpperBounds = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if ((key === 'maxItems' || key === 'maxLength') && value !== 0) {
        delete (node as Record<string, unknown>)[key];
      } else omitUpperBounds(value);
    }
  };
  omitUpperBounds(schema);
  return schema;
}

/** Values and their explanations share the same derivation, rather than independent model verdicts. */
function derive(
  kind: StandardId,
  raw: unknown,
): { value: CriterionAnswer['value']; explanation: string } {
  switch (kind) {
    case 'contact': {
      const f = factsSchemas.contact.parse(raw);
      return {
        value: f.greetedInClientLanguage && f.introducedSelf,
        explanation: `Первая реплика оператора: ${f.greetedInClientLanguage ? 'есть приветствие' : 'нет приветствия'} на языке клиента; ${f.introducedSelf ? 'оператор представился' : 'оператор не представился'}. Для представления достаточно имени.`,
      };
    }
    case 'needs': {
      const f = factsSchemas.needs.parse(raw);
      const clarified = f.missingDetailsAtHandoff.every(
        (d) => d.clarification !== null && d.clarifiedBeforeAction,
      );
      return !f.missingDetailsAtHandoff.length
        ? {
            value: 'NA',
            explanation:
              'К началу ответа оператора уже достаточно существенных деталей для ответа; выявление потребности неприменимо.',
          }
        : {
            value: clarified,
            explanation: `Недостающие детали: ${f.missingDetailsAtHandoff.map((d) => d.detail).join('; ')}. ${
              clarified
                ? 'Для каждой есть вопрос оператора до содержательного ответа или действия. Если клиент ушел, сам необходимый вопрос учитывается.'
                : 'Не все необходимые уточнения сделаны до содержательного ответа или выполненного действия.'
            }`,
          };
    }
    case 'identity': {
      const f = factsSchemas.identity.parse(raw);
      return !f.requiresIdentity
        ? {
            value: 'NA',
            explanation:
              'Запрос не требует раскрытия защищенных данных или защищенного действия оператора; идентификация неприменима.',
          }
        : {
            value: f.verifiedBeforeProtectedStep,
            explanation: f.verifiedBeforeProtectedStep
              ? 'Проверка личности явно подтверждена до защищенного шага.'
              : 'Для запроса нужна идентификация, но ее подтверждения до защищенного шага нет. Поздняя проверка не исправляет порядок.',
          };
    }
    case 'consultation': {
      const f = factsSchemas.consultation.parse(raw);
      if (!f.requestFormulated)
        return {
          value: 'NA',
          explanation:
            'Диалог закончился до формулировки содержательного запроса клиента; консультация неприменима.',
        };
      if (!f.questions.length)
        throw new OutputValidationError(
          'MISSING_REQUESTS',
          ['facts', 'questions'],
          'A formulated request requires at least one substantial question',
        );
      const addressed = f.questions.filter((q) => q.addressed).length;
      const value = f.keyAdviceWrong
        ? 0
        : addressed === f.questions.length
          ? f.secondaryDetailMissing
            ? 15
            : 20
          : addressed
            ? 10
            : f.vagueGuidanceOnly
              ? 5
              : 0;
      const open = f.questions
        .filter((q) => !q.addressed)
        .map((q) => q.question)
        .join('; ');
      const outcome = f.keyAdviceWrong
        ? 'Ключевая рекомендация неверна по доступному контексту.'
        : value === 20
          ? 'По транскрипту все существенные вопросы получили ответ или конкретный следующий шаг.'
          : value === 15
            ? 'Основной запрос решен, пропущена второстепенная деталь.'
            : value === 10
              ? 'Существенная часть запроса осталась открытой.'
              : value === 5
                ? 'Дана только общая подсказка без понятного следующего шага.'
                : 'Нет содержательного ответа или корректного следующего шага.';
      return {
        value,
        explanation: `Закрыто существенных вопросов: ${addressed} из ${f.questions.length}. Вопросы: ${f.questions.map((q) => q.question).join('; ')}. ${outcome}${open ? ' Открытые вопросы: ' + open : ''}`,
      };
    }
    case 'empathy': {
      const f = factsSchemas.empathy.parse(raw);
      return {
        value: f.polite && (!f.specificProblemExpressed || f.specificProblemAddressed),
        explanation: !f.polite
          ? 'Оператор общается невежливо.'
          : !f.specificProblemExpressed
            ? 'Оператор вежлив; отдельного выраженного неудобства или недовольства, требующего реакции, не было.'
            : f.specificProblemAddressed
              ? 'Оператор вежлив и конкретно отреагировал на описанную проблему клиента.'
              : 'Оператор вежлив, но конкретной реакции на описанное неудобство клиента нет.',
      };
    }
    case 'dialogue': {
      const f = factsSchemas.dialogue.parse(raw);
      return {
        value: f.unintelligible ? 0 : f.clientHadToClarifyWording ? 4 : f.minorLapse ? 7 : 10,
        explanation: f.unintelligible
          ? 'Из-за бессвязных или противоречивых формулировок ход диалога непонятен.'
          : f.clientHadToClarifyWording
            ? 'Клиенту пришлось переспросить из-за формулировок или порядка ответов.'
            : f.minorLapse
              ? 'Есть один заметный сбой, но клиент может понять ответ и продолжить.'
              : 'Ответы ясные и последовательные; выявленных сбоев ведения диалога нет. Полнота решения оценивается отдельно.',
      };
    }
    case 'closing': {
      const f = factsSchemas.closing.parse(raw);
      return f.interruptedBeforeOpportunity
        ? {
            value: 'NA',
            explanation:
              'Диалог явно оборвался до возможности корректно его завершить; критерий неприменим.',
          }
        : {
            value: f.summaryOrOffer !== null && f.farewell !== null,
            explanation: `В завершении ${f.summaryOrOffer ? 'есть итог или предложение дальнейшей помощи' : 'нет итога или предложения дальнейшей помощи'}; ${f.farewell ? 'оператор попрощался' : 'оператор не попрощался'}. Для положительного ответа нужны оба условия.`,
          };
    }
    case 'gross': {
      const f = factsSchemas.gross.parse(raw);
      const violations = [
        f.insult ? 'оскорбление клиента' : '',
        f.privatePaidOffer ? 'предложение платной услуги в обход компании' : '',
        f.confidentialDisclosure ? 'разглашение конфиденциальных сведений' : '',
      ].filter(Boolean);
      return {
        value: violations.length > 0,
        explanation: violations.length
          ? `Выявлено: ${violations.join('; ')}. Флаг не обнуляет итоговый балл.`
          : 'В проверенных репликах оператора не выявлены оскорбления, частные платные предложения или разглашение конфиденциальных сведений.',
      };
    }
  }
}

export function parseRubricOutput(
  raw: unknown,
  conversation: Conversation,
  checklist: ChecklistVersion,
  knowledge?: KnowledgeSnapshot,
): CriterionAnswer[] {
  const envelope = z
    .object({ answers: z.record(z.string(), z.unknown()) })
    .strict()
    .parse(raw);
  if (Object.keys(envelope.answers).length !== checklist.criteria.length)
    throw new OutputValidationError(
      'INVALID_CRITERION_COVERAGE',
      ['answers'],
      'Exactly one answer per actual criterion is required',
    );
  const source = groups(conversation);
  const references = knowledge?.sources.map((s) => s.reference) ?? [];
  const answers = Object.entries(envelope.answers).map(([id, item], index): CriterionAnswer => {
    const criterion = checklist.criteria.find((c) => c.id === id);
    if (!criterion)
      throw new OutputValidationError(
        'INVALID_CRITERION_COVERAGE',
        ['answers', index, 'criterionId'],
        'Exactly one answer per actual criterion is required',
      );
    const kind = standardRubricId(criterion);
    const parsed = z
      .object({
        evidenceMessageIds: idsSchema(source[evidenceGroup(criterion)]),
        checkedSpanMessageIds: idsSchema(source.message),
        facts: factsSchema(criterion),
        ...(references.length && kind === 'consultation'
          ? { verificationLimitation: z.string().trim().min(1).max(400).nullable() }
          : {}),
        ...(references.length
          ? {
              knowledgeReferenceIds: z
                .array(
                  z.string().refine((id) => references.includes(id), 'Unknown knowledge reference'),
                )
                .max(references.length)
                .refine(
                  (ids) => new Set(ids).size === ids.length,
                  'Duplicate knowledge references',
                ),
            }
          : {}),
      })
      .strict()
      .parse(item);
    const custom = parsed.facts as {
      value: CriterionAnswer['value'];
      explanation: string;
      naReason: string | null;
    };
    const normalizeQuote = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const checkQuote = (claim: z.infer<typeof quotedObservation> | null) => {
      if (!claim) return;
      const message = conversation.messages.find((m) => m.id === claim.messageId);
      if (
        !message ||
        message.speaker !== 'operator' ||
        !normalizeQuote(message.text).includes(normalizeQuote(claim.quote)) ||
        !parsed.evidenceMessageIds.includes(claim.messageId)
      ) {
        throw new OutputValidationError(
          'UNGROUNDED_OBSERVATION',
          ['answers', id, 'facts'],
          'Each observation must quote exact operator text and include its message ID in evidenceMessageIds. Do not invent clarification or closing actions; use null when absent.',
        );
      }
    };
    if (kind === 'needs') {
      const facts = factsSchemas.needs.parse(parsed.facts);
      for (const detail of facts.missingDetailsAtHandoff) checkQuote(detail.clarification);
    }
    if (kind === 'closing') {
      const facts = factsSchemas.closing.parse(parsed.facts);
      checkQuote(facts.summaryOrOffer);
      checkQuote(facts.farewell);
      if (
        facts.summaryOrOffer &&
        facts.farewell &&
        facts.summaryOrOffer.messageId === facts.farewell.messageId
      ) {
        const summary = normalizeQuote(facts.summaryOrOffer.quote).toLocaleLowerCase();
        const farewell = normalizeQuote(facts.farewell.quote).toLocaleLowerCase();
        if (summary.includes(farewell) || farewell.includes(summary)) {
          throw new OutputValidationError(
            'OVERLAPPING_CLOSING_ACTIONS',
            ['answers', id, 'facts'],
            'Quote the summary/help offer separately from the farewell. A farewell cannot also prove a summary/help offer. Use summaryOrOffer=null if there is no separate action.',
          );
        }
      }
    }
    const decision = kind ? derive(kind, parsed.facts) : custom;
    const cited =
      'knowledgeReferenceIds' in parsed ? (parsed.knowledgeReferenceIds as string[]) : [];
    const suppliedLimitation =
      'verificationLimitation' in parsed ? (parsed.verificationLimitation as string | null) : null;
    const limitation =
      kind === 'consultation' && decision.value !== 'NA'
        ? (suppliedLimitation ??
          (cited.length
            ? null
            : 'Условия продукта не сверены с применимым регламентом; вывод о полноте основан на транскрипте.'))
        : null;
    if (!kind && decision.value !== 'NA' && custom.naReason !== null) {
      throw new OutputValidationError(
        'UNEXPECTED_NA_REASON',
        ['answers', index, 'facts', 'naReason'],
        'Applicable answers must have naReason=null',
      );
    }
    return {
      criterionId: id,
      value: decision.value,
      explanation:
        decision.explanation +
        (limitation ? ` Ограничение проверки: ${limitation}` : '') +
        (cited.length ? ` Источники: ${cited.map((id) => '[' + id + ']').join(', ')}.` : ''),
      evidenceMessageIds: parsed.evidenceMessageIds,
      checkedSpanMessageIds: parsed.checkedSpanMessageIds,
      naReason: decision.value === 'NA' ? (kind ? decision.explanation : custom.naReason) : null,
    };
  });
  scoreEvaluation(checklist.criteria, answers);
  validateKnowledgeReferences(answers, knowledge);
  validateEvidence(conversation, answers, checklist.criteria);
  return answers;
}
