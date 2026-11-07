import { z } from 'zod';

export const GroupIdSchema = z.string().trim().min(1).max(100);
export const SourceMessageSchema = z.object({
  timestamp: z.string().min(1),
  speaker: z.enum(['client', 'operator', 'bot', 'system']),
  text: z.string(),
});
export const SourceConversationSchema = z.object({
  conversation_id: z.string().min(1),
  channel: z.enum(['agent chat', 'voice call']),
  language: z.enum(['RU', 'KZ', 'EN']),
  transcript: z.array(SourceMessageSchema).min(1),
  audio_url: z.string().url().nullable().default(null),
});
export type SourceConversation = z.infer<typeof SourceConversationSchema>;
export type SourceRecord = SourceConversation;
export type Message = z.infer<typeof SourceMessageSchema> & { id: string };
export type Conversation = {
  id: string;
  sourceConversationId: string;
  groupId: string;
  transcriptHash: string;
  channel: SourceConversation['channel'];
  language: SourceConversation['language'];
  messages: Message[];
  audioUrl: string | null;
  importedAt: string;
};

export const CriterionSchema = z
  .object({
    id: z.string().min(1),
    sectionId: z.string().min(1),
    title: z.string().min(1),
    instruction: z.string().min(1),
    answerType: z.enum(['binary', 'scale']),
    scoringMode: z.enum(['weighted', 'flag']),
    weight: z.number().min(0).max(10000),
    levels: z.array(z.number().min(0)).default([]),
    levelDescriptions: z.record(z.string(), z.string()).default({}),
    allowNA: z.boolean(),
    naRule: z.string().nullable(),
  })
  .superRefine((c, ctx) => {
    const error = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (c.allowNA && !c.naRule?.trim()) error('N/A requires an applicability rule');
    if (
      c.answerType === 'scale' &&
      (c.levels.length < 2 ||
        !c.levels.includes(0) ||
        Math.max(...c.levels) <= 0 ||
        new Set(c.levels).size !== c.levels.length)
    )
      error('Scale requires distinct levels including zero and a positive maximum');
    if (c.answerType === 'binary' && c.levels.length)
      error('Binary criteria cannot define scale levels');
    if (c.scoringMode === 'flag' && (c.weight !== 0 || c.answerType !== 'binary' || c.allowNA))
      error('Flags must be binary, have zero weight and cannot be N/A');
  });
export type Criterion = z.infer<typeof CriterionSchema>;
export type CriterionConfig = Criterion;
export const ChecklistInputSchema = z
  .object({
    title: z.string().min(1),
    sections: z.array(z.object({ id: z.string().min(1), title: z.string().min(1) })).min(1),
    criteria: z.array(CriterionSchema).min(1),
  })
  .superRefine((c, ctx) => {
    if (
      new Set(c.criteria.map((x) => x.id)).size !== c.criteria.length ||
      new Set(c.sections.map((x) => x.id)).size !== c.sections.length
    )
      ctx.addIssue({ code: 'custom', message: 'IDs must be unique' });
    for (const criterion of c.criteria)
      if (!c.sections.some((s) => s.id === criterion.sectionId))
        ctx.addIssue({ code: 'custom', message: 'Unknown section' });
  });
export type ChecklistInput = z.infer<typeof ChecklistInputSchema>;
export type ChecklistVersion = ChecklistInput & {
  id: string;
  checklistId: string;
  version: number;
  createdAt: string;
};
export const CriterionAnswerSchema = z.object({
  criterionId: z.string().min(1),
  value: z.union([z.boolean(), z.number(), z.literal('NA')]),
  explanation: z.string().default(''),
  evidenceMessageIds: z.array(z.string()).default([]),
  checkedSpanMessageIds: z.array(z.string()).default([]),
  naReason: z.string().nullable().default(null),
});
export type CriterionAnswer = z.infer<typeof CriterionAnswerSchema>;
export type ScoreSummary = {
  total: number | null;
  applicableWeight: number;
  grossViolation: boolean;
  flags: { criterionId: string; triggered: boolean }[];
  contributions: {
    criterionId: string;
    sectionId: string;
    value: CriterionAnswer['value'];
    basePoints: number;
    points: number | null;
    maxPoints: number | null;
  }[];
  sections: { sectionId: string; points: number | null; maxPoints: number | null }[];
};
export const ImportRequestSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('json'),
    groupId: GroupIdSchema,
    records: z.array(SourceConversationSchema).min(1),
  }),
  z.object({ source: z.literal('organizer'), groupId: GroupIdSchema }),
]);
export type ImportRequest = z.infer<typeof ImportRequestSchema>;
export type ImportResult = {
  groupId: string;
  imported: number;
  existing: number;
  conversationIds: string[];
};
export type ImportSummary = ImportResult;
export const ConversationFiltersSchema = z.object({
  groupId: GroupIdSchema.optional(),
  language: SourceConversationSchema.shape.language.optional(),
  channel: SourceConversationSchema.shape.channel.optional(),
});
export type ConversationFilters = z.infer<typeof ConversationFiltersSchema>;
export const ScoreRequestSchema = z.object({
  checklistVersionId: z.string().min(1),
  answers: z.array(CriterionAnswerSchema),
});
export type ScoreRequest = z.infer<typeof ScoreRequestSchema>;
export type ScoreResponse = ScoreSummary & { checklistVersionId: string };
export type ApiError = { error: { code: string; message: string } };

export const EvaluationRequestSchema = z.object({
  conversationIds: z.array(z.string().min(1)).min(1).max(100),
  checklistVersionId: z.string().min(1),
  force: z.boolean().default(false),
});
export type EvaluationRequest = z.input<typeof EvaluationRequestSchema>;
export type EvaluationStatus = 'queued' | 'running' | 'completed' | 'failed';
export type TokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
  totalTokens: number | null;
};
export type EvaluationAttempt = {
  number: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: 'running' | 'completed' | 'failed';
  errorCode: string | null;
  usage: TokenUsage;
  modelVersion: string | null;
};
export type CriterionEvidence = {
  criterionId: string;
  evidence: Message[];
  checkedSpan: Message[];
};
export type Evaluation = {
  id: string;
  conversationId: string;
  checklistVersionId: string;
  providerId: string;
  modelId: string;
  configurationId: string;
  promptVersion: string;
  status: EvaluationStatus;
  retryOfId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  originalAnswers: CriterionAnswer[];
  effectiveAnswers: CriterionAnswer[];
  evidence: CriterionEvidence[];
  originalScore: ScoreSummary | null;
  finalScore: ScoreSummary | null;
  attempts: EvaluationAttempt[];
  usage: TokenUsage & { calls: number };
  error: { code: string; message: string } | null;
};
