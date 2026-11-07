import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import {
  applyTheme,
  readLargeText,
  readTheme,
  savePreference,
  type Theme,
} from './display-preferences';

const themes = [
  { value: 'light', label: 'Светлая', icon: 'sun' },
  { value: 'dark', label: 'Тёмная', icon: 'moon' },
  { value: 'black', label: 'Чёрная', icon: 'contrast' },
] as const;

export function DisplaySettings() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [large, setLarge] = useState(readLargeText);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => applyTheme(theme, query?.matches);
    apply();
    if (theme === 'system') query?.addEventListener('change', apply);
    savePreference('cqa-theme', theme);
    return () => query?.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.text = large ? 'large' : 'normal';
    savePreference('cqa-large-text', String(large));
  }, [large]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (!event.key || event.key === 'cqa-theme') setTheme(readTheme());
      if (!event.key || event.key === 'cqa-large-text') setLarge(readLargeText());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  return (
    <section className="display-settings" aria-label="Оформление">
      <span className="theme-label">Оформление</span>
      <div className="theme-switcher" role="group" aria-label="Тема оформления">
        {themes.map(({ value, label, icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={theme === value}
            onClick={() => setTheme(value)}
          >
            <Icon name={icon} size={18} />
            <span>{label}</span>
            <span className="theme-selected" aria-hidden="true">
              <Icon name="check" size={15} />
            </span>
          </button>
        ))}
      </div>
      <details className="display-options">
        <summary>Настройки вида</summary>
        <label>
          <input
            type="checkbox"
            checked={theme === 'system'}
            onChange={(e) => setTheme(e.target.checked ? 'system' : 'light')}
          />{' '}
          Как в системе
        </label>
        <label>
          <input type="checkbox" checked={large} onChange={(e) => setLarge(e.target.checked)} />{' '}
          Крупный текст
        </label>
      </details>
    </section>
  );
}
