// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KnowledgePage } from './KnowledgePage';
import { CoachingPanel } from './CoachingPanel';
import { evaluation } from '../tests/fixtures';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('shows an empty knowledge base and keeps the fictional example inactive', async () => {
  let saved: Record<string, unknown> | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        saved = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ ...saved, id: 'example' }), { status: 201 });
      }
      return new Response(JSON.stringify(saved ? [{ ...saved, id: 'example' }] : []));
    }),
  );
  render(<KnowledgePage />);
  await screen.findByText('Регламенты пока не добавлены');
  fireEvent.click(screen.getByRole('button', { name: 'Посмотреть учебный пример' }));
  expect(
    (screen.getByLabelText('Использовать при новых оценках') as HTMLInputElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить документ' }));
  await screen.findByText('Документ сохранён.');
  expect(saved?.demo).toBe(true);
  expect(saved?.active).toBe(false);
});
it('lets the reviewer navigate to the exact message behind a recommendation', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            basedOn: 'effective_answers',
            items: [
              {
                criterionId: 'contact',
                title: 'Контакт',
                basis: 'Не представился.',
                action: 'Представьтесь в первом ответе.',
                example: 'Здравствуйте, я [имя].',
                priority: 'normal',
                knowledgeReferences: [],
                evidence: [
                  { id: 'm0001', speaker: 'operator', timestamp: '00:00', text: 'Добрый день!' },
                ],
              },
            ],
          }),
        ),
    ),
  );
  const navigate = vi.fn();
  render(<CoachingPanel evaluation={evaluation} onEvidence={navigate} />);
  fireEvent.click(await screen.findByRole('button', { name: /Добрый день/ }));
  expect(navigate).toHaveBeenCalledWith('m0001');
  expect(screen.getByText('Пример формулировки')).toBeTruthy();
});
it('shows frozen rules while a candidate is awaiting human review', async () => {
  const { HumanDecision } = await import('./ReviewQueuePage');
  const { conversation, version } = await import('../tests/fixtures');
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
        evaluation: {
          ...evaluation,
          status: 'failed',
          knowledge: {
            retrievalVersion: 'fts-v1',
            status: 'matched',
            date: null,
            datedRulesSkipped: false,
            sources: [
              {
                reference: 'K1',
                id: 'doc',
                documentKey: 'rules',
                title: 'Правило для проверки',
                source: 'Справочник',
                version: '1',
                language: 'RU',
                effectiveFrom: null,
                effectiveTo: null,
                contentHash: 'hash',
                chunkIndex: 0,
                text: 'Подтверждение личности требуется до раскрытия защищённых данных.',
              },
            ],
          },
        },
        conversation,
        checklist: version,
        runs: [],
      }}
      onSaved={() => {}}
    />,
  );
  fireEvent.click(screen.getByText('Регламенты для этой оценки'));
  fireEvent.click(screen.getByText('[K1] Правило для проверки · версия 1'));
  expect(
    screen.getByText('Подтверждение личности требуется до раскрытия защищённых данных.'),
  ).toBeTruthy();
});
