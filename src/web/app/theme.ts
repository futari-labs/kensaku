export type Theme = "dark" | "light";

export const THEME_KEY = "kensaku.theme.v1";

/** Dark unless the stored value is exactly "light". Any other value, or no storage, is dark. */
export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
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
