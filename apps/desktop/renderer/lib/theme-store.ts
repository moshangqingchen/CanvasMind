import {
  normalizeThemePreference, readUiPreference, resolveTheme, THEME_MEDIA_QUERY,
  THEME_PREFERENCE_KEY, writeUiPreference, type ResolvedTheme, type ThemePreference,
} from "./ui-preferences";

interface ThemeEnvironment {
  read: () => string | null;
  write: (value: ThemePreference) => unknown;
  systemDark: () => boolean;
  onSystemChange: (callback: (dark: boolean) => void) => () => void;
  onStorageChange: (callback: (value: string | null) => void) => () => void;
  apply: (theme: ResolvedTheme, preference: ThemePreference) => void;
}

/** A small external store keeps theme changes out of the canvas component tree. */
export function createThemeStore(environment: ThemeEnvironment) {
  let preference = normalizeThemePreference(environment.read());
  let systemDark = environment.systemDark();
  const listeners = new Set<() => void>();
  let stop: (() => void) | undefined;
  const apply = () => environment.apply(resolveTheme(preference, systemDark), preference);
  const notify = () => { for (const listener of listeners) listener(); };
  const update = (next: ThemePreference) => {
    if (preference === next) return;
    preference = next;
    apply();
    notify();
  };
  return {
    getSnapshot: () => preference,
    getServerSnapshot: (): ThemePreference => "system",
    setPreference(value: ThemePreference) {
      const next = normalizeThemePreference(value);
      // A blocked/quota-full storage still allows switching for this session.
      environment.write(next);
      update(next);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!stop) {
        systemDark = environment.systemDark();
        const stopSystem = environment.onSystemChange(dark => {
          systemDark = dark;
          if (preference === "system") apply();
        });
        const stopStorage = environment.onStorageChange(value => update(normalizeThemePreference(value)));
        stop = () => { stopSystem(); stopStorage(); };
        apply();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { stop?.(); stop = undefined; }
      };
    },
  };
}

type ThemeStore = ReturnType<typeof createThemeStore>;
let browserStore: ThemeStore | undefined;
const serverStore = { getSnapshot: (): ThemePreference => "system", getServerSnapshot: (): ThemePreference => "system", subscribe: () => () => {}, setPreference: () => {} };

export function getThemeStore(): ThemeStore {
  if (typeof window === "undefined") return serverStore;
  if (browserStore) return browserStore;
  const media = typeof window.matchMedia === "function" ? window.matchMedia(THEME_MEDIA_QUERY) : null;
  browserStore = createThemeStore({
    read: () => readUiPreference(THEME_PREFERENCE_KEY),
    write: value => writeUiPreference(THEME_PREFERENCE_KEY, value),
    systemDark: () => media?.matches ?? false,
    onSystemChange(callback) {
      const change = (event: MediaQueryListEvent) => callback(event.matches);
      media?.addEventListener("change", change);
      return () => media?.removeEventListener("change", change);
    },
    onStorageChange(callback) {
      const change = (event: StorageEvent) => {
        // sessionStorage has the same event shape but is not this preference.
        try { if (event.storageArea && event.storageArea !== window.localStorage) return; } catch { return; }
        if (event.key === THEME_PREFERENCE_KEY || event.key === null) callback(event.newValue);
      };
      window.addEventListener("storage", change);
      return () => window.removeEventListener("storage", change);
    },
    apply(theme, preference) {
      const root = document.documentElement;
      root.dataset.theme = theme;
      root.dataset.themePreference = preference;
      root.style.colorScheme = theme;
      try { void window.superCanvasDesktop?.setThemeSource?.(preference).catch(() => {}); }
      catch { /* Older desktop bridges and unavailable IPC must not block appearance. */ }
    },
  });
  return browserStore;
}
