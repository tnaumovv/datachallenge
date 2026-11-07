import type {
  ChecklistInput,
  Conversation,
  Criterion,
  CriterionAnswer,
} from '../../../shared/contracts.js';
import { scoreEvaluation } from '../evaluations/scoring.js';

// JSON format 1.0, organizer appendix, page 3. These are submission rules,
// independent of editable application checklists and future prompt wording.
const criteria = [
  { id: 'contact', internalId: 'contact', weight: 10, allowNA: false, levels: [] },
  { id: 'discovery', internalId: 'needs', weight: 15, allowNA: true, levels: [] },
  { id: 'identification', internalId: 'identity', weight: 20, allowNA: true, levels: [] },
  {
    id: 'consultation',
    internalId: 'consultation',
    weight: 20,
    allowNA: true,
    levels: [0, 5, 10, 15, 20],
  },
  { id: 'empathy', internalId: 'empathy', weight: 15, allowNA: false, levels: [] },
  { id: 'dialogue', internalId: 'dialogue', weight: 15, allowNA: false, levels: [0, 4, 7, 10] },
  { id: 'closure', internalId: 'closing', weight: 5, allowNA: true, levels: [] },
  { id: 'critical', internalId: 'gross', weight: 0, allowNA: false, levels: [] },
] as const;

type CriterionId = (typeof criteria)[number]['id'];
export type ResultCriterion = {
  criterion_id: CriterionId;
  value: boolean | number | null;
  rationale: string;
  evidence_turns: number[];
};
export type OkResult = {
  conversation_id: string;
  status: 'ok';
  criteria: ResultCriterion[];
  score: { final_score: number; critical_flag: boolean };
};
export type ErrorResult = {
  conversation_id: string;
  status: 'error';
  criteria: [];
  score: null;
  error: string;
};
export type ResultsDocument = {
  schema_version: '1.0';
  team_name: string;
  model: { mode: 'local' | 'external_api' | 'hybrid'; name: string };
  results: (OkResult | ErrorResult)[];
};

function definition(id: string) {
  const found = criteria.find((c) => c.id === id || c.internalId === id);
  if (!found) throw new Error(`Unknown submission criterion: ${id}`);
  return found;
}

/** Normalize aliases while rejecting edited scales/weights that cannot be submitted as JSON 1.0. */
export function standardCriteria(checklist: ChecklistInput): Criterion[] {
  if (checklist.criteria.length !== 8)
    throw new Error('Submission checklist must have exactly 8 criteria');
  const byId = new Map<CriterionId, Criterion>();
  for (const c of checklist.criteria) {
    const spec = definition(c.id);
    if (byId.has(spec.id)) throw new Error(`Duplicate checklist criterion alias: ${spec.id}`);
    if (
      c.weight !== spec.weight ||
      c.allowNA !== spec.allowNA ||
      c.answerType !== (spec.levels.length ? 'scale' : 'binary') ||
      c.scoringMode !== (spec.id === 'critical' ? 'flag' : 'weighted') ||
      JSON.stringify([...c.levels].sort((a, b) => a - b)) !== JSON.stringify(spec.levels)
    )
      throw new Error(
        `Nonstandard submission checklist weight, scale or applicability: ${spec.id}`,
      );
    byId.set(spec.id, { ...c, id: spec.internalId });
  }
  return criteria.map((c) => byId.get(c.id)!);
}

export function formatCompletedEvaluation(
  conversation: Pick<Conversation, 'sourceConversationId' | 'messages'>,
  evaluation: {
    originalAnswers: CriterionAnswer[];
    originalScore: { total: number | null } | null;
  },
  checklist: Criterion[],
): OkResult {
  if (evaluation.originalAnswers.length !== 8)
    throw new Error('Original result must contain all 8 criteria');
  const answers = new Map<CriterionId, CriterionAnswer>();
  for (const a of evaluation.originalAnswers) {
    const spec = definition(a.criterionId);
    if (answers.has(spec.id)) throw new Error(`Duplicate result criterion alias: ${spec.id}`);
    answers.set(spec.id, { ...a, criterionId: spec.internalId });
  }
  const normalized = criteria.map((c) => answers.get(c.id)!);
  const score = scoreEvaluation(checklist, normalized);
  if (score.total === null || evaluation.originalScore?.total !== score.total)
    throw new Error('Persisted original score does not match the standard weighted score');

  const turns = new Map(conversation.messages.map((m, index) => [m.id, index + 1]));
  if (turns.size !== conversation.messages.length)
    throw new Error('Duplicate transcript message IDs');
  const result = criteria.map((spec): ResultCriterion => {
    const answer = answers.get(spec.id)!;
    const explanation = answer.explanation.trim();
    if (!explanation) throw new Error(`Missing original explanation for ${spec.id}`);
    const reason = answer.value === 'NA' ? answer.naReason!.trim() : '';
    const evidenceTurns = [
      ...new Set(
        [...answer.evidenceMessageIds, ...answer.checkedSpanMessageIds].map((id) => {
          const turn = turns.get(id);
          if (turn === undefined)
            throw new Error(`Unknown evidence message ID for ${spec.id}: ${id}`);
          return turn;
        }),
      ),
    ].sort((a, b) => a - b);
    if (!evidenceTurns.length) throw new Error(`Missing original evidence turns for ${spec.id}`);
    return {
      criterion_id: spec.id,
      value: answer.value === 'NA' ? null : answer.value,
      rationale: reason && reason !== explanation ? `${explanation} ${reason}` : explanation,
      evidence_turns: evidenceTurns,
    };
  });
  return {
    conversation_id: conversation.sourceConversationId,
    status: 'ok',
    criteria: result,
    score: { final_score: score.total, critical_flag: score.grossViolation },
  };
}
