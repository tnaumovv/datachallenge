import { useEffect, useState } from 'react';
export function DisplaySettings() {
  const [theme, setTheme] = useState(() => {
      try {
        return localStorage.getItem('cqa-theme') ?? 'system';
      } catch {
        return 'system';
      }
    }),
    [large, setLarge] = useState(() => {
      try {
        return localStorage.getItem('cqa-large-text') === 'true';
      } catch {
        return false;
      }
    });
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (query?.matches ? 'dark' : 'light') : theme;
    };
    apply();
    query?.addEventListener('change', apply);
    try {
      localStorage.setItem('cqa-theme', theme);
    } catch {}
    return () => query?.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.text = large ? 'large' : 'normal';
    try {
      localStorage.setItem('cqa-large-text', String(large));
    } catch {}
  }, [large]);
  return (
    <details className="display-settings">
      <summary>Вид</summary>
      <label>
        Тема
        <select className="field" value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="system">Системная</option>
          <option value="light">Светлая</option>
          <option value="dark">Тёмная</option>
        </select>
      </label>
      <label>
        <input type="checkbox" checked={large} onChange={(e) => setLarge(e.target.checked)} />{' '}
        Крупный текст
      </label>
    </details>
  );
}
