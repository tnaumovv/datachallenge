import type { ChecklistVersion, Conversation, TokenUsage } from '../../../shared/contracts.js';

export type ProviderInput = {
  conversation: Conversation;
  checklist: ChecklistVersion;
  signal: AbortSignal;
  repairInstruction?: string;
};
export type ProviderResult = {
  text: string;
  usage: Partial<TokenUsage>;
  modelVersion?: string;
  finishReason?: string;
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
