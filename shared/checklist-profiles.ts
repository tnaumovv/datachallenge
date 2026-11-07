import type { Conversation } from './contracts.js';
export type ChecklistProfile = {
  id: string;
  title: string;
  checklistId: string;
  channels: Conversation['channel'][];
  activeVersionId: string;
  revision: number;
};
export type ChecklistDiff = {
  weightOnly: boolean;
  changedCriterionIds: string[];
  changes: { criterionId: string; field: string; before: unknown; after: unknown }[];
  metadataChanged: boolean;
};
