import { afterEach, describe, expect, it, vi } from "vitest";
import vm from "node:vm";
import {
  normalizeThemePreference, readUiPreference, resolveTheme, THEME_BOOTSTRAP_SCRIPT,
  THEME_MEDIA_QUERY, THEME_PREFERENCE_KEY, writeUiPreference,
} from "./ui-preferences";

afterEach(() => vi.unstubAllGlobals());
describe("optional UI preference storage", () => {
  it("does not interrupt opening an editor when the browser blocks storage", () => {
    vi.stubGlobal("window", { get localStorage() { throw new DOMException("Blocked", "SecurityError"); } });
    expect(readUiPreference("agent-task:canvas")).toBeNull();
    expect(writeUiPreference("agent-model:canvas", "saved-model")).toBe(false);
  });
  it("keeps exact values and tolerates a full quota", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { if (value === "full") throw new Error("QuotaExceeded"); values.set(key, value); },
    } });
    expect(writeUiPreference("panel", "360")).toBe(true);
    expect(readUiPreference("panel")).toBe("360");
    expect(writeUiPreference("panel", "full")).toBe(false);
    expect(readUiPreference("panel")).toBe("360");
  });
});

describe("appearance preference and first-paint bootstrap", () => {
  it("defaults missing, corrupt, and unsupported preferences to the system", () => {
    for (const value of [null, undefined, "", "auto", "DARK", {}, true])
      expect(normalizeThemePreference(value)).toBe("system");
    for (const value of ["light", "dark", "system"])
      expect(normalizeThemePreference(value)).toBe(value);
  });

  it("resolves explicit themes independently of the system and follows both system schemes", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("applies the persisted choice and native controls before any application code", () => {
    for (const saved of [null, "system", "light", "dark", "corrupt"]) {
      for (const systemDark of [false, true]) {
        const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
        vm.runInNewContext(THEME_BOOTSTRAP_SCRIPT, {
          localStorage: { getItem: (key: string) => { expect(key).toBe(THEME_PREFERENCE_KEY); return saved; } },
          matchMedia: (query: string) => { expect(query).toBe(THEME_MEDIA_QUERY); return { matches: systemDark }; },
          document: { documentElement: root },
        });
        const preference = normalizeThemePreference(saved);
        expect(root.dataset.theme).toBe(resolveTheme(preference, systemDark));
        expect(root.dataset.themePreference).toBe(preference);
        expect(root.style.colorScheme).toBe(root.dataset.theme);
      }
    }
  });

  it("still paints the system theme when storage is blocked and tolerates missing matchMedia", () => {
    const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
    vm.runInNewContext(THEME_BOOTSTRAP_SCRIPT, {
      get localStorage() { throw new Error("SecurityError"); },
      matchMedia: () => ({ matches: true }), document: { documentElement: root },
    });
    expect(root.dataset.theme).toBe("dark");
    vm.runInNewContext(THEME_BOOTSTRAP_SCRIPT, {
      localStorage: { getItem: () => "dark" }, document: { documentElement: root },
    });
    expect(root.dataset.theme).toBe("dark");
  });
});
