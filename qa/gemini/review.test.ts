import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/src/db.js';
import { ChecklistService } from '../../server/src/checklists/service.js';
import { ConversationService } from '../../server/src/conversations/service.js';
import { scoreEvaluation } from '../../server/src/evaluations/scoring.js';
import { validateEvidence } from '../../server/src/evaluations/evidence.js';
import { demoImport, scoreExampleAnswers } from '../../shared/fixtures.js';
import type { Evaluation } from '../../shared/contracts.js';
import { reviewEvaluation, type ReferenceCase } from './review.js';

function fixture() {
  const db = createDatabase(':memory:');
  if (demoImport.source !== 'json') throw new Error('Expected local fixture');
  const conversations = new ConversationService(db);
  const imported = conversations.importRecords('DEMO', demoImport.records);
  const conversation = conversations.get(imported.conversationIds[0])!;
  const checklist = new ChecklistService(db).seed();
  db.close();
  const answers = scoreExampleAnswers.map((a) => ({
    ...a,
    evidenceMessageIds: ['m0002'],
    checkedSpanMessageIds: ['m0001', 'm0002', 'm0004'],
  }));
  const score = scoreEvaluation(checklist.criteria, answers);
  const evaluation: Evaluation = {
    id: 'local-test',
    conversationId: conversation.id,
    checklistVersionId: checklist.id,
    providerId: 'fixture',
    modelId: 'fixture',
    configurationId: 'fixture',
    promptVersion: 'fixture',
    status: 'completed',
    retryOfId: null,
    createdAt: '2026-11-07T00:00:00Z',
    startedAt: null,
    finishedAt: null,
    originalAnswers: answers,
    effectiveAnswers: structuredClone(answers),
    originalScore: score,
    finalScore: structuredClone(score),
    evidence: validateEvidence(conversation, answers),
    attempts: [],
    usage: {
      calls: 0,
      inputTokens: null,
      outputTokens: null,
      thinkingTokens: null,
      totalTokens: null,
    },
    error: null,
  };
  // Deliberately tests the reviewer mechanics using arithmetic fixtures, not AI accuracy.
  const reference: ReferenceCase = {
    sourceId: conversation.sourceConversationId,
    language: 'RU',
    role: 'unit_fixture',
    expectedValues: { needs: 'NA', identity: 'NA' },
    expectedTotal: 85.38,
    notes: 'Not a quality label for the synthetic text.',
  };
  return { evaluation, conversation, checklist, reference };
}

describe('Gemini quality review (no API calls)', () => {
  it('reviews a replaced built-in criterion using the actual checklist instruction', () => {
    const f = fixture();
    f.checklist.criteria[0].instruction = 'Да, если клиент попросил о помощи; укажи его сообщение.';
    f.evaluation.originalAnswers[0].evidenceMessageIds = ['m0001'];
    f.evaluation.evidence = validateEvidence(
      f.conversation,
      f.evaluation.originalAnswers,
      f.checklist.criteria,
    );
    expect(
      reviewEvaluation(f.evaluation, f.conversation, f.checklist, f.reference).technicalErrors,
    ).toEqual([]);
  });

  it('accepts a consistent stored result and independent expected values', () => {
    const f = fixture();
    expect(reviewEvaluation(f.evaluation, f.conversation, f.checklist, f.reference)).toEqual({
      technicalErrors: [],
      semanticMismatches: [],
      reviewStatus: 'passed',
    });
  });
  it('does not treat successful JSON as semantic correctness', () => {
    const f = fixture();
    const answer = f.evaluation.originalAnswers.find((a) => a.criterionId === 'identity')!;
    answer.value = true;
    answer.naReason = null;
    f.evaluation.originalScore = scoreEvaluation(
      f.checklist.criteria,
      f.evaluation.originalAnswers,
    );
    const review = reviewEvaluation(f.evaluation, f.conversation, f.checklist, f.reference);
    expect(review.technicalErrors).toEqual([]);
    expect(review.semanticMismatches).toContainEqual({
      criterionId: 'identity',
      expected: 'NA',
      actual: true,
    });
    expect(review.reviewStatus).toBe('mismatch');
  });
  it('rejects a saved quote that differs from the source message', () => {
    const f = fixture();
    f.evaluation.evidence[0].evidence[0].text = 'Invented quote';
    expect(
      reviewEvaluation(f.evaluation, f.conversation, f.checklist, f.reference).technicalErrors,
    ).toContain('Evidence differs from original transcript messages');
  });
  it('rejects an incorrect saved score', () => {
    const f = fixture();
    f.evaluation.originalScore!.total = 100;
    expect(
      reviewEvaluation(f.evaluation, f.conversation, f.checklist, f.reference).technicalErrors,
    ).toContain('Persisted original score differs from recomputation');
  });
  it('checks that a critical confirmation is cited, not just any existing message', () => {
    const f = fixture();
    f.reference.requiredEvidence = { identity: ['m0003'] };
    expect(
      reviewEvaluation(f.evaluation, f.conversation, f.checklist, f.reference).semanticMismatches,
    ).toContainEqual({ criterionId: 'identity', missingEvidence: ['m0003'] });
  });
  it('reports provider failure as unreviewed rather than a pass', () => {
    const f = fixture();
    f.evaluation.status = 'failed';
    expect(
      reviewEvaluation(f.evaluation, f.conversation, f.checklist, f.reference).reviewStatus,
    ).toBe('not_evaluated');
  });
});
