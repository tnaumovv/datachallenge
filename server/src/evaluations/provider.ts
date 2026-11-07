import type {
  ChecklistVersion,
  Conversation,
  EvaluationAttempt,
  TokenUsage,
} from '../../../shared/contracts.js';

export type RepairContext = Pick<
  EvaluationAttempt,
  'failureStage' | 'finishReason' | 'validationErrors'
>;

export type ProviderInput = {
  conversation: Conversation;
  checklist: ChecklistVersion;
  signal: AbortSignal;
  repair?: RepairContext;
  policyVersion?: string;
  precedents?: {
    id: string;
    criterionId: string;
    example: string;
    value: import('../../../shared/contracts.js').CriterionAnswer['value'];
  }[];
};
export type ProviderResult = {
  text: string;
  usage: Partial<TokenUsage>;
  modelVersion?: string;
  finishReason?: string;
  blockReason?: string;
};
export interface EvaluationProvider {
  id: string;
  modelId: string;
  configurationId: string;
  generate(input: ProviderInput): Promise<ProviderResult>;
}
/** Only safe, fixed codes cross the provider boundary. Never persist SDK error text. */
export class ProviderError extends Error {
  constructor(
    public code: string,
    public retryable: boolean,
    public retryAfterMs?: number,
  ) {
    super(code);
  }
}
