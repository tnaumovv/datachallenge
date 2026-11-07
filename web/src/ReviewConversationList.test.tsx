// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { conversation } from '../tests/fixtures';
import { ReviewConversationList } from './ReviewConversationList';

afterEach(cleanup);

describe('review conversation navigation', () => {
  const kazakh = {
    ...conversation,
    id: 'kz/id',
    sourceConversationId: 'KZ-002',
    language: 'KZ' as const,
    messages: [{ ...conversation.messages[0], text: 'Сәлеметсіз бе, аударым түспеді.' }],
  };

  it('searches multilingual messages without changing the current conversation', async () => {
    const onOpen = vi.fn();
    render(
      <ReviewConversationList
        conversations={[conversation, kazakh]}
        selectedId={conversation.id}
        onOpen={onOpen}
      />,
    );
    const user = userEvent.setup();
    const search = screen.getByRole('searchbox', { name: 'Поиск по диалогам' });
    await user.type(search, 'АУДАРЫМ');
    const match = screen.getByRole('link', { name: /KZ-002/ });
    expect(match.getAttribute('href')).toBe('/dialogs/kz%2Fid');
    expect(screen.queryByRole('link', { name: /UI-001/ })).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
    await user.type(search, 'нет совпадений');
    expect(screen.getByRole('status').textContent).toContain('Ничего не найдено');
    await user.clear(search);
    expect(screen.getByRole('link', { name: /UI-001/ }).getAttribute('aria-current')).toBe('page');
    await user.click(screen.getByRole('link', { name: /KZ-002/ }));
    expect(onOpen).toHaveBeenCalledWith('kz/id');
  });

  it('provides the same choices in the native compact selector', async () => {
    const onOpen = vi.fn();
    render(
      <ReviewConversationList
        conversations={[conversation, kazakh]}
        selectedId={conversation.id}
        onOpen={onOpen}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText('Другой диалог'), 'kz/id');
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith('kz/id');
  });
});
