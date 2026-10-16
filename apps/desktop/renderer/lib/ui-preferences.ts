/** UI preferences are optional: blocked/full browser storage must not break an editor. */
export function readUiPreference(key: string): string | null {
  try { return typeof window === "undefined" ? null : window.localStorage.getItem(key); }
  catch { return null; }
}

export function writeUiPreference(key: string, value: string): boolean {
  try {
    if (typeof window === "undefined") return false;
    window.localStorage.setItem(key, value);
    return true;
  } catch { return false; }
}

export const THEME_PREFERENCE_KEY = "supercanvas:appearance";
export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

/** Runs synchronously in the document head, before the page can paint. */
export const THEME_BOOTSTRAP_SCRIPT = `(()=>{let p="system";try{const v=localStorage.getItem(${JSON.stringify(THEME_PREFERENCE_KEY)});if(v==="light"||v==="dark")p=v}catch{}let d=false;try{d=matchMedia(${JSON.stringify(THEME_MEDIA_QUERY)}).matches}catch{}const t=p==="system"?(d?"dark":"light"):p;const r=document.documentElement;r.dataset.theme=t;r.dataset.themePreference=p;r.style.colorScheme=t})()`;
