// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DisplaySettings } from './DisplaySettings';
import { initializeDisplayPreferences } from './display-preferences';

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  });
  delete document.documentElement.dataset.theme;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('switches all three themes immediately and persists across remounts', () => {
  const { unmount } = render(<DisplaySettings />);
  for (const [label, value] of [
    ['Тёмная', 'dark'],
    ['Чёрная', 'black'],
    ['Светлая', 'light'],
  ]) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(document.documentElement.dataset.theme).toBe(value);
    expect(localStorage.getItem('cqa-theme')).toBe(value);
    expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true');
  }
  fireEvent.click(screen.getByRole('button', { name: 'Чёрная' }));
  unmount();
  render(<DisplaySettings />);
  expect(document.documentElement.dataset.theme).toBe('black');
});
it('initializes the saved theme and large text before rendering; invalid preferences fall back to light', () => {
  localStorage.setItem('cqa-theme', 'black');
  localStorage.setItem('cqa-large-text', 'true');
  initializeDisplayPreferences();
  expect(document.documentElement.dataset.theme).toBe('black');
  expect(document.documentElement.dataset.text).toBe('large');
  localStorage.setItem('cqa-theme', 'invalid');
  initializeDisplayPreferences();
  expect(document.documentElement.dataset.theme).toBe('light');
});
it('keeps system mode reactive and stops following it after explicit selection', () => {
  let listener: (() => void) | undefined;
  const query = {
    matches: true,
    addEventListener: vi.fn((_type, fn) => {
      listener = fn;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', () => query);
  localStorage.setItem('cqa-theme', 'system');
  render(<DisplaySettings />);
  expect(document.documentElement.dataset.theme).toBe('dark');
  query.matches = false;
  listener?.();
  expect(document.documentElement.dataset.theme).toBe('light');
  fireEvent.click(screen.getByRole('button', { name: 'Чёрная' }));
  expect(query.removeEventListener).toHaveBeenCalled();
  expect(document.documentElement.dataset.theme).toBe('black');
});
it('continues working when browser storage is unavailable', () => {
  vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  render(<DisplaySettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Тёмная' }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  vi.restoreAllMocks();
});
