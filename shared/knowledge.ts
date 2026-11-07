import { z } from 'zod';
export const KnowledgeInputSchema = z
  .object({
    documentKey: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    source: z.string().trim().min(1).max(500),
    version: z.string().trim().min(1).max(80),
    language: z.enum(['RU', 'KZ', 'EN', 'MULTI']),
    text: z.string().trim().min(20).max(100000),
    keywords: z.string().trim().max(1000).default(''),
    effectiveFrom: z.iso.date().nullable().default(null),
    effectiveTo: z.iso.date().nullable().default(null),
    active: z.boolean().default(false),
    demo: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.demo && v.active)
      ctx.addIssue({ code: 'custom', message: 'Demo documents cannot be activated' });
    if (v.effectiveFrom && v.effectiveTo && v.effectiveFrom > v.effectiveTo)
      ctx.addIssue({ code: 'custom', message: 'Invalid effective date range' });
  });
export type KnowledgeInput = z.infer<typeof KnowledgeInputSchema>;
export type KnowledgeDocument = KnowledgeInput & {
  id: string;
  createdAt: string;
  contentHash: string;
};
export type KnowledgeSource = Pick<
  KnowledgeDocument,
  | 'id'
  | 'documentKey'
  | 'title'
  | 'source'
  | 'version'
  | 'language'
  | 'effectiveFrom'
  | 'effectiveTo'
  | 'contentHash'
> & {
  reference: string;
  chunkIndex: number;
  text: string;
};
export type KnowledgeSnapshot = {
  retrievalVersion: 'fts-v1';
  status: 'empty' | 'no_match' | 'date_unknown' | 'matched';
  date: string | null;
  sources: KnowledgeSource[];
  datedRulesSkipped: boolean;
};
export const KnowledgeSearchSchema = z
  .object({
    query: z.string().trim().min(1).max(20000),
    date: z.iso.date().optional(),
  })
  .strict();
