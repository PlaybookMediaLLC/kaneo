export type SiteTheme = "light" | "dark" | "system";
export type ResolvedSiteTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "kaneo-site-theme";
export const THEME_CHANGE_EVENT = "site-theme-change";

export function getStoredTheme(): SiteTheme {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Follow system appearance when storage is unavailable.
  }
  return "system";
}

export function resolveIsDark(theme: SiteTheme = getStoredTheme()): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applySiteTheme(theme: SiteTheme = getStoredTheme()): boolean {
  const isDark = resolveIsDark(theme);
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  }
  return isDark;
}

export function setSiteTheme(theme: SiteTheme): boolean {
  if (typeof window !== "undefined") {
    try {
      if (theme === "system") {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      }
    } catch {
      // Ignore storage failures in restricted contexts.
    }
    const isDark = applySiteTheme(theme);
    window.dispatchEvent(
      new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme, isDark } }),
    );
    return isDark;
  }
  return resolveIsDark(theme);
}
