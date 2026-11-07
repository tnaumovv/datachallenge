export type Theme = 'light' | 'dark' | 'black' | 'system';
export function readTheme(): Theme {
  try {
    const value = localStorage.getItem('cqa-theme');
    if (value === 'dark' || value === 'black' || value === 'system') return value;
  } catch {
    /* Storage may be disabled. Preferences still work in this tab. */
  }
  return 'light';
}
export function readLargeText() {
  try {
    return localStorage.getItem('cqa-large-text') === 'true';
  } catch {
    return false;
  }
}
export function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Keep the in-memory preference. */
  }
}
export function applyTheme(
  theme: Theme,
  systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
) {
  document.documentElement.dataset.theme =
    theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}
export function initializeDisplayPreferences() {
  applyTheme(readTheme());
  document.documentElement.dataset.text = readLargeText() ? 'large' : 'normal';
}
