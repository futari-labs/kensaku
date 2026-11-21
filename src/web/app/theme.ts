export type Theme = "dark" | "light";

export const THEME_KEY = "kensaku.theme.v1";

/** The theme public/theme-init.js applied before first paint; that script is the only parser of stored values. Its storage key must match THEME_KEY. */
export function readTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // The theme still applies to this page.
  }
}
