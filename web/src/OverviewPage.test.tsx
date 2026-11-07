// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OverviewPage } from './OverviewPage';
import { api } from './api';
import * as client from './api';
import { version } from '../tests/fixtures';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const newer = { ...version, id: 'inactive-v2', version: 2 };
const profile = {
  id: 'legacy',
  title: 'Main',
  checklistId: version.checklistId,
  channels: ['agent chat' as const, 'voice call' as const],
  activeVersionId: version.id,
  revision: 1,
};
const data = {
  grossViolations: 0,
  losses: [],
  selection: { evaluationIds: [] },
  coverage: {
    conversations: 0,
    selected: 0,
    unassessedConversations: 0,
    completed: 0,
    failed: 0,
    queued: 0,
    running: 0,
    reviewRequired: 0,
  },
  original: { average: null, denominator: 0 },
  effective: { average: null, denominator: 0 },
};

it('defaults the overview to the active profile rather than the newest saved draft', async () => {
  vi.spyOn(api, 'profiles').mockResolvedValue([profile]);
  const request = vi.spyOn(client, 'request').mockResolvedValue(data);
  render(<OverviewPage checklists={[newer, version]} />);
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      `/overview?checklistVersionId=${version.id}`,
      expect.anything(),
    ),
  );
  expect(request.mock.calls.some(([url]) => String(url).includes(newer.id))).toBe(false);
});

it('does not query mixed versions on profile failure, and permits an intentional version selection', async () => {
  vi.spyOn(api, 'profiles').mockRejectedValue(new Error('offline'));
  const request = vi.spyOn(client, 'request').mockResolvedValue(data);
  render(<OverviewPage checklists={[newer, version]} />);
  await screen.findByText(/Не удалось загрузить активный чек-лист/);
  expect(request).not.toHaveBeenCalled();
  const selector = screen.getByRole('combobox', { name: 'Версия чек-листа' });
  if (selector.tagName === 'SELECT') {
    fireEvent.change(selector, { target: { value: newer.id } });
  } else {
    const user = userEvent.setup();
    await user.click(selector);
    await user.click(screen.getByRole('option', { name: `${newer.title} · v${newer.version}` }));
  }
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      `/overview?checklistVersionId=${newer.id}`,
      expect.anything(),
    ),
  );
});

it('does not silently substitute an unrelated profile for the workspace default', async () => {
  vi.spyOn(api, 'profiles').mockResolvedValue([{ ...profile, id: 'unrelated' }]);
  const request = vi.spyOn(client, 'request').mockResolvedValue(data);
  render(<OverviewPage checklists={[newer, version]} />);
  await screen.findByText('Активный чек-лист не выбран. Выберите версию для обзора.');
  expect(request).not.toHaveBeenCalled();
});
