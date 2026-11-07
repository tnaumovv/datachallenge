// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { api } from './api';
import { conversation, version } from '../tests/fixtures';

let mobile = false;
beforeEach(() => {
  window.history.replaceState(null, '', '/dialogs');
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-width: 767px)' && mobile,
    addEventListener() {},
    removeEventListener() {},
  }));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
  vi.spyOn(api, 'conversations').mockResolvedValue([structuredClone(conversation)]);
  vi.spyOn(api, 'checklists').mockResolvedValue([structuredClone(version)]);
  vi.spyOn(api, 'appeals').mockResolvedValue([]);
  vi.spyOn(api, 'evaluations').mockResolvedValue([]);
  vi.spyOn(api, 'profiles').mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  mobile = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('expands from the keyboard and keeps real navigation usable when collapsed', async () => {
  const user = userEvent.setup();
  render(<App />);
  const toggle = screen.getByRole('button', { name: 'Развернуть меню' });
  toggle.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: 'Свернуть меню' }).getAttribute('aria-expanded')).toBe(
    'true',
  );
  const navigation = screen.getByRole('navigation', { name: 'Разделы' });
  expect(within(navigation).getAllByRole('link')).toHaveLength(7);
  expect(within(navigation).getByRole('link', { name: 'База знаний' }).getAttribute('href')).toBe(
    '/knowledge',
  );
  expect(
    within(navigation).getByRole('link', { name: 'Диалоги' }).getAttribute('aria-current'),
  ).toBe('page');
  await user.keyboard('{Enter}');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  await user.click(within(navigation).getByRole('link', { name: 'Апелляции' }));
  await waitFor(() => expect(window.location.pathname).toBe('/appeals'));
  expect(
    within(navigation).getByRole('link', { name: 'Апелляции' }).getAttribute('aria-current'),
  ).toBe('page');
});

it('opens the mobile menu, closes after navigation and handles native dismissal', async () => {
  mobile = true;
  const user = userEvent.setup();
  render(<App />);
  const trigger = screen.getByRole('button', { name: 'Открыть меню' });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('dialog', { name: 'Меню разделов' })).toBeNull();
  await user.click(trigger);
  const menu = screen.getByRole<HTMLDialogElement>('dialog', { name: 'Меню разделов' });
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  await user.click(within(menu).getByRole('link', { name: 'Апелляции' }));
  await waitFor(() => expect(window.location.pathname).toBe('/appeals'));
  expect(menu.open).toBe(false);
  expect(document.activeElement).toBe(trigger);
  await user.click(trigger);
  fireEvent(menu, new Event('cancel', { cancelable: true }));
  expect(menu.open).toBe(false);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

it('moves keyboard focus into display settings when expanding their collapsed shortcut', async () => {
  const user = userEvent.setup();
  render(<App />);
  screen.getByRole('button', { name: 'Настройки отображения' }).focus();
  await user.keyboard('{Enter}');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Светлая' }));
});

it('keeps system-theme updates and in-memory preferences active while the mobile menu is closed', async () => {
  mobile = true;
  const user = userEvent.setup();
  let systemChanged: (() => void) | undefined;
  const scheme = {
    matches: false,
    addEventListener(_type: string, listener: () => void) {
      systemChanged = listener;
    },
    removeEventListener() {
      systemChanged = undefined;
    },
  };
  const matchMedia = window.matchMedia;
  vi.stubGlobal('matchMedia', (query: string) =>
    query === '(prefers-color-scheme: dark)' ? scheme : matchMedia(query),
  );
  vi.stubGlobal('localStorage', {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  });
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Открыть меню' }));
  await user.click(screen.getByText('Настройки вида'));
  await user.click(screen.getByRole('checkbox', { name: 'Как в системе' }));
  await user.click(screen.getByRole('button', { name: 'Закрыть меню' }));
  act(() => {
    scheme.matches = true;
    systemChanged?.();
  });
  expect(document.documentElement.dataset.theme).toBe('dark');
  await user.click(screen.getByRole('button', { name: 'Открыть меню' }));
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Как в системе' }).checked).toBe(
    true,
  );
});

it('keeps the mobile menu and checklist edits when leaving the editor is cancelled', async () => {
  mobile = true;
  const user = userEvent.setup();
  window.history.replaceState(null, '', '/checklists');
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Новая версия' }));
  const title = await screen.findByRole('textbox', { name: 'Название чек-листа' });
  await user.type(title, ' draft');
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  await user.click(screen.getByRole('button', { name: 'Открыть меню' }));
  const menu = screen.getByRole<HTMLDialogElement>('dialog', { name: 'Меню разделов' });
  await user.click(within(menu).getByRole('link', { name: 'Диалоги' }));
  expect(window.location.pathname).toBe('/checklists');
  expect(menu.open).toBe(true);
  expect((title as HTMLInputElement).value).toContain('draft');
});
