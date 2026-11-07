// @vitest-environment jsdom
import React from 'react';
import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { HumanDecision } from './ReviewQueuePage';
import { conversation, evaluation, version } from '../tests/fixtures';
import { OverviewPage } from './OverviewPage';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('does not silently turn an unresolved criterion into false while typing an explanation', () => {
  const criterion = version.criteria[0];
  render(
    <HumanDecision
      detail={{
        item: {
          id: 'r',
          evaluationId: evaluation.id,
          status: 'open',
          revision: 0,
          reasons: ['unresolved'],
          createdAt: 'now',
        },
        evaluation: { ...evaluation, effectiveAnswers: [], revision: 0 },
        conversation,
        checklist: { ...version, criteria: [criterion] },
        runs: [],
      }}
      onSaved={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText('Обоснование'), { target: { value: 'Проверено' } });
  fireEvent.change(screen.getByLabelText('Причина решения'), {
    target: { value: 'Проверено человеком' },
  });
  expect(
    (screen.getByRole('button', { name: 'Подтвердить проверенные ответы' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect((screen.getByLabelText('Ответ') as HTMLSelectElement).value).toBe('');
});
it('does not render failed or missing averages as a zero score', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            selection: { evaluationIds: [] },
            coverage: {
              conversations: 3,
              selected: 2,
              unassessedConversations: 1,
              completed: 0,
              failed: 2,
              queued: 0,
              running: 0,
              reviewRequired: 1,
            },
            original: { average: null, denominator: 0 },
            effective: { average: null, denominator: 0 },
            grossViolations: 0,
            losses: [],
          }),
        ),
    ),
  );
  render(<OverviewPage checklists={[version]} />);
  await waitFor(() => expect(screen.getByText(/Средний итог рассчитан по 0/)).toBeTruthy());
  expect(screen.getAllByText('—').length).toBe(2);
});
