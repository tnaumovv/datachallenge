// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from './select';

afterEach(cleanup);

const options = [
  { value: '', label: 'Все языки' },
  { value: 'RU', label: 'Русский' },
  { value: 'KZ', label: 'Казахский' },
  { value: 'EN', label: 'Английский', disabled: true },
];

it('changes a controlled value and lets a filter return to its empty all-items value', async () => {
  function Filter() {
    const [value, setValue] = useState('');
    return <Select aria-label="Язык" options={options} value={value} onValueChange={setValue} />;
  }
  render(<Filter />);
  const user = userEvent.setup();
  const trigger = screen.getByRole('combobox', { name: 'Язык' });
  expect(trigger.textContent).toContain('Все языки');
  await user.click(trigger);
  await user.click(screen.getByRole('option', { name: 'Казахский' }));
  expect(trigger.textContent).toContain('Казахский');
  await user.click(trigger);
  await user.click(screen.getByRole('option', { name: 'Все языки' }));
  expect(trigger.textContent).toContain('Все языки');
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('does not choose an answer implicitly, and preserves distinct string values', async () => {
  const changed = vi.fn();
  const { rerender } = render(
    <Select
      aria-label="Ответ"
      value=""
      onValueChange={changed}
      required
      placeholder="Выберите ответ"
      options={[
        { value: '0', label: 'Ноль' },
        { value: 'false', label: 'Нет' },
        { value: 'kz/id', label: 'Идентификатор' },
      ]}
    />,
  );
  expect(screen.getByRole('combobox').textContent).toContain('Выберите ответ');
  expect(changed).not.toHaveBeenCalled();
  const user = userEvent.setup();
  for (const [value, label] of [
    ['0', 'Ноль'],
    ['false', 'Нет'],
    ['kz/id', 'Идентификатор'],
  ]) {
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: label }));
    expect(changed).toHaveBeenLastCalledWith(value);
  }
  rerender(<Select aria-label="Ответ" value="KZ" options={options} onValueChange={changed} />);
  expect(screen.getByRole('combobox').textContent).toContain('Казахский');
});

it('skips disabled options, closes on Escape, and restores focus to the trigger', async () => {
  const changed = vi.fn();
  render(<Select aria-label="Язык" value="RU" options={options} onValueChange={changed} />);
  const user = userEvent.setup();
  const trigger = screen.getByRole('combobox');
  trigger.focus();
  await user.keyboard('{ArrowDown}');
  const disabled = screen.getByRole('option', { name: 'Английский' });
  expect(disabled.getAttribute('aria-disabled')).toBe('true');
  await user.keyboard('{End}');
  expect(document.activeElement?.textContent).toContain('Казахский');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(changed).not.toHaveBeenCalled();
});

it('keeps labels, helper text, invalid state and disabled state accessible', () => {
  render(
    <>
      <label htmlFor="select-language">Язык документа</label>
      <Select
        id="select-language"
        value="RU"
        options={options}
        onValueChange={() => {}}
        helperText="Язык исходного документа"
        aria-invalid
        disabled
      />
    </>,
  );
  const trigger = screen.getByRole('combobox', { name: 'Язык документа' });
  expect(trigger.hasAttribute('disabled')).toBe(true);
  expect(trigger.getAttribute('aria-invalid')).toBe('true');
  const helper = screen.getByText('Язык исходного документа');
  expect(trigger.getAttribute('aria-describedby')?.split(' ')).toContain(helper.id);
});

it('renders the popup inside a containing native dialog so it stays in the top layer', async () => {
  render(
    <dialog open aria-label="Импорт">
      <Select aria-label="Язык" value="RU" options={options} onValueChange={() => {}} />
    </dialog>,
  );
  await userEvent.click(screen.getByRole('combobox', { name: 'Язык' }));
  expect(within(screen.getByRole('dialog')).getByRole('listbox')).toBeTruthy();
});
