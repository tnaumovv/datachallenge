import type { Message } from './contracts.js';
export type CoachingItem = {
  criterionId: string;
  title: string;
  priority: 'high' | 'normal';
  basis: string;
  action: string;
  example: string | null;
  evidence: Message[];
  knowledgeReferences: string[];
};
export type CoachingResult = { items: CoachingItem[]; basedOn: 'effective_answers' };
