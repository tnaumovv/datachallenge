import { afterEach, expect, it } from 'vitest';
import { createDatabase } from '../src/db.js';
import { exportResults } from '../src/results/export.js';
import {
  seedResults,
  fixtureEvaluation,
  insertEvaluation,
  updateEvaluation,
} from './fixtures/results.js';
import { ConversationService } from '../src/conversations/service.js';
import { ChecklistService } from '../src/checklists/service.js';
import { AppealService } from '../src/appeals/service.js';
import { scoreEvaluation } from '../src/evaluations/scoring.js';
import type { Evaluation } from '../../shared/contracts.js';

const databases: ReturnType<typeof createDatabase>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function setup(group: 'DEV' | 'PROD' = 'PROD', sourceGroup: string = group) {
  const db = createDatabase(':memory:');
  databases.push(db);
  return { db, ...seedResults(db, group, sourceGroup) };
}

function editFirst(f: ReturnType<typeof setup>, edit: (e: Evaluation) => void) {
  const evaluation = f.evaluations[0];
  edit(evaluation);
  updateEvaluation(f.db, evaluation);
}

it('exports the literal organizer contract with N/A and full transcript turn numbering', () => {
  const f = setup();
  const result = exportResults(f.db, f.options);
  expect(Object.keys(result).sort()).toEqual(['model', 'results', 'schema_version', 'team_name']);
  expect(result.schema_version).toBe('1.0');
  expect(result.team_name).toBe('Fixture team');
  expect(result.model).toEqual({ mode: 'external_api', name: 'fixture-model-001' });
  expect(result.results).toHaveLength(10);
  expect(result.results[0]).toEqual({
    conversation_id: 'fixture-001',
    status: 'ok',
    criteria: [
      {
        criterion_id: 'contact',
        value: true,
        rationale: 'Оператор поздоровался и представился.',
        evidence_turns: [4],
      },
      {
        criterion_id: 'discovery',
        value: null,
        rationale: 'Клиент сразу ясно изложил вопрос.',
        evidence_turns: [1],
      },
      {
        criterion_id: 'identification',
        value: null,
        rationale: 'Общий вопрос не требует идентификации.',
        evidence_turns: [1],
      },
      {
        criterion_id: 'consultation',
        value: 15,
        rationale: 'Основной вопрос решён, упущена деталь.',
        evidence_turns: [5, 6],
      },
      {
        criterion_id: 'empathy',
        value: true,
        rationale: 'Вежливо признал неудобство клиента.',
        evidence_turns: [4, 5],
      },
      {
        criterion_id: 'dialogue',
        value: 7,
        rationale: 'Есть повтор, но ход диалога понятен.',
        evidence_turns: [5, 6],
      },
      {
        criterion_id: 'closure',
        value: true,
        rationale: 'Предложил дальнейшую помощь и попрощался.',
        evidence_turns: [8],
      },
      {
        criterion_id: 'critical',
        value: false,
        rationale: 'Грубых нарушений в репликах нет.',
        evidence_turns: [4, 5, 6, 8],
      },
    ],
    score: { final_score: 85.38, critical_flag: false },
  });
  expect(result.results.map((r) => r.conversation_id)).toEqual(
    f.records.map((r) => r.conversation_id),
  );
});

it('exports all 60 DEV chats and 5 calls without including another source group', () => {
  const f = setup('DEV');
  seedResults(f.db, 'PROD');
  const result = exportResults(f.db, f.options);
  expect(result.results).toHaveLength(65);
  expect(new Set(result.results.map((r) => r.conversation_id)).size).toBe(65);
});

it('validates PROD counts while selecting the actual CONTROL API group name', () => {
  const f = setup('PROD', 'CONTROL-42');
  seedResults(f.db, 'DEV');
  expect(exportResults(f.db, f.options).results).toHaveLength(10);
});

it.each(['DEV', 'PROD'] as const)('rejects an incomplete %s set', (group) => {
  const f = setup(group);
  const id = f.conversations[0].id;
  f.db.prepare('DELETE FROM evaluations WHERE conversation_id=?').run(id);
  f.db.prepare('DELETE FROM conversations WHERE id=?').run(id);
  expect(() => exportResults(f.db, f.options)).toThrow(/count|65|10/i);
});

it('rejects extra records instead of truncating the set', () => {
  const f = setup();
  new ConversationService(f.db).importRecords('PROD', [
    { ...f.records[0], conversation_id: 'extra' },
  ]);
  expect(() => exportResults(f.db, f.options)).toThrow(/count|10/i);
});

it.each(['DEV', 'PROD'] as const)(
  'rejects an incorrect %s channel composition at the correct count',
  (group) => {
    const f = setup(group);
    const c = f.conversations[0];
    c.channel = 'voice call';
    f.db.prepare('UPDATE conversations SET payload=? WHERE id=?').run(JSON.stringify(c), c.id);
    expect(() => exportResults(f.db, f.options)).toThrow(/channel|chats|calls/i);
  },
);

it('rejects multiple transcript revisions with the same original conversation_id', () => {
  const f = setup();
  new ConversationService(f.db).importRecords('PROD', [
    {
      ...f.records[0],
      transcript: f.records[0].transcript.map((m) => ({
        ...m,
        text: m.text + ' changed revision',
      })),
    },
  ]);
  expect(() => exportResults(f.db, f.options)).toThrow(
    /duplicate.*(conversation|source)|source.*unique/i,
  );
});

it('accepts official criterion IDs as well as legacy internal aliases', () => {
  const f = setup();
  const aliases: Record<string, string> = {
    needs: 'discovery',
    identity: 'identification',
    closing: 'closure',
    gross: 'critical',
  };
  editFirst(f, (e) => {
    e.originalAnswers = e.originalAnswers.map((a) => ({
      ...a,
      criterionId: aliases[a.criterionId] ?? a.criterionId,
    }));
  });
  const ids = exportResults(f.db, f.options).results[0].criteria.map((c) => c.criterion_id);
  expect(ids).toEqual([
    'contact',
    'discovery',
    'identification',
    'consultation',
    'empathy',
    'dialogue',
    'closure',
    'critical',
  ]);
});

it.each([
  [
    'missing',
    (e: Evaluation) => {
      e.originalAnswers.pop();
    },
  ],
  [
    'unknown',
    (e: Evaluation) => {
      e.originalAnswers[0].criterionId = 'unknown';
    },
  ],
  [
    'duplicate alias',
    (e: Evaluation) => {
      e.originalAnswers[2].criterionId = 'discovery';
    },
  ],
] as const)('rejects %s criteria', (_name, edit) => {
  const f = setup();
  editFirst(f, edit);
  expect(() => exportResults(f.db, f.options)).toThrow(/criteri|alias/i);
});

it.each([
  ['contact', 'NA'],
  ['empathy', 'NA'],
  ['dialogue', 'NA'],
  ['gross', 'NA'],
  ['consultation', 17],
  ['dialogue', 15],
  ['contact', 1],
  ['consultation', true],
] as const)('rejects illegal %s value %s', (id, value) => {
  const f = setup();
  editFirst(f, (e) => {
    e.originalAnswers.find((a) => a.criterionId === id)!.value = value;
  });
  expect(() => exportResults(f.db, f.options)).toThrow(
    /value|N\/A|level|boolean|number|Expected one of/i,
  );
});

it('requires the original N/A reason and includes a distinct reason in rationale', () => {
  const f = setup();
  editFirst(f, (e) => {
    e.originalAnswers[1].naReason = 'Данных достаточно.';
  });
  expect(exportResults(f.db, f.options).results[0].criteria[1].rationale).toBe(
    'Клиент сразу ясно изложил вопрос. Данных достаточно.',
  );
  editFirst(f, (e) => {
    e.originalAnswers[1].naReason = ' ';
  });
  expect(() => exportResults(f.db, f.options)).toThrow(/N\/A|reason/i);
});

it('requires a substantive original explanation', () => {
  const f = setup();
  editFirst(f, (e) => {
    e.originalAnswers[0].explanation = ' ';
  });
  expect(() => exportResults(f.db, f.options)).toThrow(/explanation|rationale/i);
});

it('maps opaque message IDs by full transcript position and deduplicates both evidence sources', () => {
  const f = setup();
  const c = f.conversations[0];
  const replacements = new Map(
    c.messages.map((m, i) => [m.id, `opaque-${String.fromCharCode(97 + i)}`]),
  );
  c.messages = c.messages.map((m) => ({ ...m, id: replacements.get(m.id)! }));
  f.db.prepare('UPDATE conversations SET payload=? WHERE id=?').run(JSON.stringify(c), c.id);
  editFirst(f, (e) => {
    for (const a of e.originalAnswers) {
      a.evidenceMessageIds = a.evidenceMessageIds.map((id) => replacements.get(id)!);
      a.checkedSpanMessageIds = a.checkedSpanMessageIds.map((id) => replacements.get(id)!);
    }
    e.originalAnswers[3].evidenceMessageIds = ['opaque-f', 'opaque-e', 'opaque-f'];
    e.originalAnswers[3].checkedSpanMessageIds = ['opaque-d', 'opaque-e'];
  });
  const result = exportResults(f.db, f.options).results[0];
  expect(result.criteria[0].evidence_turns).toEqual([4]);
  expect(result.criteria[3].evidence_turns).toEqual([4, 5, 6]);
});

it.each(['unknown', 'empty'] as const)('rejects %s evidence references', (kind) => {
  const f = setup();
  editFirst(f, (e) => {
    e.originalAnswers[0].evidenceMessageIds = kind === 'unknown' ? ['m9999'] : [];
  });
  expect(() => exportResults(f.db, f.options)).toThrow(/evidence|turn/i);
});

it('rejects duplicate transcript message IDs instead of guessing a turn', () => {
  const f = setup();
  const c = f.conversations[0];
  c.messages[0].id = c.messages[3].id;
  f.db.prepare('UPDATE conversations SET payload=? WHERE id=?').run(JSON.stringify(c), c.id);
  expect(() => exportResults(f.db, f.options)).toThrow(/duplicate.*message|message.*unique/i);
});

it('exports the latest inserted failure instead of an older completed result', () => {
  const f = setup();
  insertEvaluation(
    f.db,
    fixtureEvaluation(f.conversations[0].id, f.checklist, {
      status: 'failed',
      createdAt: '2026-11-06T00:00:00.000Z',
      originalAnswers: [],
      effectiveAnswers: [],
      originalScore: null,
      finalScore: null,
      error: { code: 'TIMEOUT', message: 'Model request timed out' },
    }),
  );
  expect(exportResults(f.db, f.options).results[0]).toEqual({
    conversation_id: 'fixture-001',
    status: 'error',
    criteria: [],
    score: null,
    error: 'TIMEOUT: Model request timed out',
  });
});

it.each(['queued', 'running'] as const)(
  'refuses a latest %s task without falling back to success',
  (status) => {
    const f = setup();
    insertEvaluation(f.db, fixtureEvaluation(f.conversations[0].id, f.checklist, { status }));
    expect(() => exportResults(f.db, f.options)).toThrow(/queued|running|unfinished|terminal/i);
  },
);

it('refuses missing persisted evaluations instead of fabricating errors', () => {
  const f = setup();
  f.db.prepare('DELETE FROM evaluations WHERE conversation_id=?').run(f.conversations[0].id);
  expect(() => exportResults(f.db, f.options)).toThrow(/missing.*evaluation|no.*evaluation/i);
});

it('selects only the explicitly requested checklist version', () => {
  const f = setup();
  const newer = new ChecklistService(f.db).save('default', f.checklist);
  const e = fixtureEvaluation(f.conversations[0].id, newer, {
    status: 'failed',
    error: { code: 'TIMEOUT', message: 'Model request timed out' },
  });
  insertEvaluation(f.db, e);
  expect(exportResults(f.db, f.options).results[0].status).toBe('ok');
  expect(() => exportResults(f.db, { ...f.options, checklistVersionId: newer.id })).toThrow(
    /missing.*evaluation|no.*evaluation/i,
  );
});

it('keeps original AI answers and score after a real persisted appeal without writing to the DB', () => {
  const f = setup();
  const appeals = new AppealService(f.db);
  const appeal = appeals.submit({
    evaluationId: f.evaluations[0].id,
    criterionId: 'consultation',
    comment: 'Тестовая апелляция',
  });
  const changed = appeals.resolve(appeal.id, {
    decision: 'change',
    replacementValue: 20,
    reason: 'Тестовое решение человека',
  });
  expect(changed.finalScore!.total).toBe(93.08);
  const before = f.db.prepare('SELECT payload FROM evaluations ORDER BY rowid').all();
  const result = exportResults(f.db, f.options).results[0];
  expect(result.criteria[3].value).toBe(15);
  expect(result.criteria[3].evidence_turns).toEqual([5, 6]);
  expect(result.score).toEqual({ final_score: 85.38, critical_flag: false });
  expect(f.db.prepare('SELECT payload FROM evaluations ORDER BY rowid').all()).toEqual(before);
  expect(appeals.get(appeal.id)!.status).toBe('resolved');
});

it('exports critical=true separately without zeroing the saved score', () => {
  const f = setup();
  editFirst(f, (e) => {
    e.originalAnswers[7].value = true;
    e.originalScore = scoreEvaluation(f.checklist.criteria, e.originalAnswers);
  });
  const result = exportResults(f.db, f.options).results[0];
  expect(result.criteria[7].value).toBe(true);
  expect(result.score).toEqual({ final_score: 85.38, critical_flag: true });
});

it('uses actual model versions across calls and falls back to the persisted requested model when unavailable', () => {
  const f = setup();
  editFirst(f, (e) => {
    e.attempts[0].modelVersion = 'fixture-model-002';
  });
  const other = f.evaluations[1];
  other.attempts[0].modelVersion = null;
  updateEvaluation(f.db, other);
  expect(exportResults(f.db, f.options).model).toEqual({
    mode: 'external_api',
    name: 'fixture-model-001, fixture-model-002, fixture-model-alias',
  });
});

it.each(['test-fake', 'test', 'demo'])(
  'rejects provider %s instead of claiming a guessed mode',
  (provider) => {
    const f = setup();
    editFirst(f, (e) => {
      e.providerId = provider;
    });
    expect(() => exportResults(f.db, f.options)).toThrow(/provider/i);
  },
);

it.each(['groq', 'openai', 'deepseek'])(
  'classifies production provider %s as external_api',
  (provider) => {
    const f = setup();
    editFirst(f, (e) => {
      e.providerId = provider;
    });
    expect(exportResults(f.db, f.options).model).toEqual({
      mode: 'external_api',
      name: 'fixture-model-001',
    });
  },
);

it('classifies an Ollama-only dataset as local', () => {
  const f = setup();
  for (const e of f.evaluations) {
    e.providerId = 'ollama';
    e.attempts[0].modelVersion = 'fixture-local-model';
    updateEvaluation(f.db, e);
  }
  expect(exportResults(f.db, f.options).model).toEqual({
    mode: 'local',
    name: 'fixture-local-model',
  });
});

it('uses hybrid when selected evaluations actually used local and external models', () => {
  const f = setup();
  editFirst(f, (e) => {
    e.providerId = 'ollama';
    e.attempts[0].modelVersion = 'fixture-local-model';
  });
  expect(exportResults(f.db, f.options).model).toEqual({
    mode: 'hybrid',
    name: 'fixture-local-model, fixture-model-001',
  });
});

it('does not claim hybrid when a local task failed before any actual model call', () => {
  const f = setup();
  editFirst(f, (e) => {
    e.providerId = 'ollama';
    e.status = 'failed';
    e.attempts = [];
    e.error = {
      code: 'PROVIDER_CHANGED',
      message: 'Configured provider differs from this queued evaluation',
    };
  });
  const document = exportResults(f.db, f.options);
  expect(document.results[0].status).toBe('error');
  expect(document.model).toEqual({ mode: 'external_api', name: 'fixture-model-001' });
});

it('rejects completed records without an actual completed model attempt', () => {
  const f = setup();
  editFirst(f, (e) => {
    e.attempts = [];
  });
  expect(() => exportResults(f.db, f.options)).toThrow(/attempt|model/i);
});

it('refuses to invent an actually used model if every record failed before any call', () => {
  const f = setup();
  for (const e of f.evaluations) {
    e.status = 'failed';
    e.attempts = [];
    e.error = {
      code: 'PROVIDER_CHANGED',
      message: 'Configured provider differs from this queued evaluation',
    };
    updateEvaluation(f.db, e);
  }
  expect(() => exportResults(f.db, f.options)).toThrow(/model|attempt/i);
});

it('requires a real saved error reason for failed records', () => {
  const f = setup();
  editFirst(f, (e) => {
    e.status = 'failed';
    e.error = null;
  });
  expect(() => exportResults(f.db, f.options)).toThrow(/error|reason/i);
});

it('rejects a persisted score inconsistent with original answers', () => {
  const f = setup();
  editFirst(f, (e) => {
    e.originalScore!.total = 0;
  });
  expect(() => exportResults(f.db, f.options)).toThrow(/score/i);
});

it('rejects a nonstandard checklist even if its eight IDs match', () => {
  const f = setup();
  const changed = structuredClone(f.checklist);
  changed.criteria[0].weight = 100;
  f.db
    .prepare('UPDATE checklist_versions SET payload=? WHERE id=?')
    .run(JSON.stringify(changed), changed.id);
  expect(() => exportResults(f.db, f.options)).toThrow(/weight|standard|checklist/i);
});

it('rejects inconsistent stored conversation metadata', () => {
  const f = setup();
  const c = f.conversations[0];
  c.sourceConversationId = 'wrong-id';
  f.db.prepare('UPDATE conversations SET payload=? WHERE id=?').run(JSON.stringify(c), c.id);
  expect(() => exportResults(f.db, f.options)).toThrow(/mismatch|inconsistent/i);
});

it('rejects blank team names and unknown dataset groups', () => {
  const f = setup();
  expect(() => exportResults(f.db, { ...f.options, teamName: ' ' })).toThrow();
  expect(() => exportResults(f.db, { ...f.options, group: 'CONTROL' as 'PROD' })).toThrow();
});
