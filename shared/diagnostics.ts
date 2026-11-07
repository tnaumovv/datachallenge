import type { CriterionAnswer, EvaluationAttempt, ScoreSummary } from './contracts.js';

/** Explicit historical tariff; no default/provider-name based pricing. */
export type PriceSnapshot = {
  currency: string;
  capturedAt: string;
  inputPerMillion: number;
  outputPerMillion: number;
  thinkingPerMillion: number;
  outputIncludesThinking: boolean;
};
export type AttemptCost = {
  amount: number | null;
  currency: string | null;
  reason: 'missing_price' | 'invalid_price' | 'unknown_usage' | null;
};
export type CostSummary = {
  total: number | null;
  knownSubtotal: number | null;
  currency: string | null;
  complete: boolean;
  unknownAttempts: number;
  attempts: (AttemptCost & { number: number; status: EvaluationAttempt['status'] })[];
};
export type AnswerDifference = {
  criterionId: string;
  left: CriterionAnswer | null;
  right: CriterionAnswer | null;
  changed: boolean;
};
export type ComparisonSide = {
  answers: AnswerDifference[];
  leftScore: ScoreSummary | null;
  rightScore: ScoreSummary | null;
  totalDelta: number | null;
};
export type EvaluationComparison = {
  leftId: string;
  rightId: string;
  transcriptHash: string;
  sameChecklistVersion: boolean;
  original: ComparisonSide;
  effective: ComparisonSide;
};
