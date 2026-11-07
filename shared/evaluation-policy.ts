import { z } from 'zod';
import { CriterionAnswerSchema } from './contracts.js';
export const POLICY_VERSION = 'facts-first-v1';
export const CandidateAnswerSchema = CriterionAnswerSchema.extend({
  explanation: z.string().trim().min(1),
  evidenceMessageIds: z.array(z.string().min(1)),
  checkedSpanMessageIds: z.array(z.string().min(1)),
  naReason: z.string().nullable(),
}).strict();
export const CriterionAssessmentSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('resolved'), answer: CandidateAnswerSchema }).strict(),
  z
    .object({
      status: z.literal('unresolved'),
      criterionId: z.string().min(1),
      reasonCode: z.enum(['insufficient_recording', 'ambiguous_rule', 'unknown']),
      explanation: z.string().trim().min(1),
      checkedSpanMessageIds: z.array(z.string()).min(1),
    })
    .strict(),
]);
export const CandidateOutputSchema = z
  .object({
    observations: z.array(
      z
        .object({
          name: z.enum(['identity_verified', 'protected_disclosure', 'operator_action', 'other']),
          status: z.enum(['observed', 'unknown']),
          messageIds: z.array(z.string()),
          source: z.literal('model'),
        })
        .strict(),
    ),
    assessments: z.array(CriterionAssessmentSchema),
  })
  .strict();
export type CandidateOutput = z.infer<typeof CandidateOutputSchema>;
export type ReviewItem = {
  id: string;
  evaluationId: string;
  status: 'open' | 'resolved';
  revision: number;
  reasons: string[];
  createdAt: string;
};
export const ReviewDecisionSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    idempotencyKey: z.string().trim().min(1).max(200),
    action: z.enum(['resolve', 'defer']),
    reason: z.string().trim().min(1),
    answers: z.array(CandidateAnswerSchema).optional(),
  })
  .strict();
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;
