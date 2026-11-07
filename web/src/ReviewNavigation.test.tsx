// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { conversation } from '../tests/fixtures';
import { ReviewNavigation } from './ReviewNavigation';

afterEach(cleanup);
const kazakh = {
  ...conversation,
  id: 'kz/id',
  sourceConversationId: 'KZ-002',
  language: 'KZ' as const,
  messages: [{ ...conversation.messages[0], text: 'Сәлеметсіз бе, аударым түспеді.' }],
};

describe('compact review navigation', () => {
  it('selects a multilingual conversation without changing its identifier', async () => {
    const onOpen = vi.fn();
    render(
      <ReviewNavigation
        conversations={[conversation, kazakh]}
        selectedId={conversation.id}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByRole('option', { name: /KZ-002.*KZ.*Сәлеметсіз/ })).toBeTruthy();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Выбрать диалог' }),
      'kz/id',
    );
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('kz/id');
  });
  it('moves in list order and disables controls at the boundaries', async () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <ReviewNavigation
        conversations={[conversation, kazakh]}
        selectedId={conversation.id}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByRole('button', { name: 'Предыдущий диалог' }).hasAttribute('disabled')).toBe(
      true,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Следующий диалог' }));
    expect(onOpen).toHaveBeenCalledWith('kz/id');
    rerender(
      <ReviewNavigation
        conversations={[conversation, kazakh]}
        selectedId={kazakh.id}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByRole('button', { name: 'Следующий диалог' }).hasAttribute('disabled')).toBe(
      true,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Предыдущий диалог' }));
    expect(onOpen).toHaveBeenLastCalledWith(conversation.id);
  });
});
