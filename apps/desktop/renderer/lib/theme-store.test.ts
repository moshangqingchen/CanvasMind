import { describe, expect, it, vi } from "vitest";
import { createThemeStore } from "./theme-store";
import type { ThemePreference } from "./ui-preferences";

function fixture(saved: string | null = null, systemDark = false) {
  let systemCallback: ((dark: boolean) => void) | undefined;
  let storageCallback: ((value: string | null) => void) | undefined;
  const apply = vi.fn();
  const stopSystem = vi.fn(() => { systemCallback = undefined; });
  const stopStorage = vi.fn(() => { storageCallback = undefined; });
  const write = vi.fn((value: ThemePreference) => { saved = value; return true; });
  const store = createThemeStore({
    read: () => saved, write, systemDark: () => systemDark, apply,
    onSystemChange: callback => { systemCallback = callback; return stopSystem; },
    onStorageChange: callback => { storageCallback = callback; return stopStorage; },
  });
  return { store, apply, write, stopSystem, stopStorage,
    system: (dark: boolean) => { systemDark = dark; systemCallback?.(dark); },
    storage: (value: string | null) => { saved = value; storageCallback?.(value); },
  };
}

describe("isolated theme external store", () => {
  it("defaults to system and follows live system changes without React snapshot changes", () => {
    const f = fixture(null, false);
    const changed = vi.fn();
    const stop = f.store.subscribe(changed);
    expect(f.store.getSnapshot()).toBe("system");
    expect(f.store.getServerSnapshot()).toBe("system");
    expect(f.apply).toHaveBeenLastCalledWith("light", "system");
    f.system(true);
    expect(f.apply).toHaveBeenLastCalledWith("dark", "system");
    expect(changed).not.toHaveBeenCalled();
    stop();
  });

  it("persists explicit choices, notifies only controls, and ignores OS changes while explicit", () => {
    const f = fixture("light", true);
    const changed = vi.fn();
    const stop = f.store.subscribe(changed);
    expect(f.apply).toHaveBeenLastCalledWith("light", "light");
    f.store.setPreference("dark");
    expect(f.write).toHaveBeenLastCalledWith("dark");
    expect(f.apply).toHaveBeenLastCalledWith("dark", "dark");
    expect(changed).toHaveBeenCalledTimes(1);
    f.apply.mockClear();
    f.system(false);
    expect(f.apply).not.toHaveBeenCalled();
    f.store.setPreference("system");
    expect(f.apply).toHaveBeenLastCalledWith("light", "system");
    stop();
  });

  it("receives cross-tab preferences and clear/corrupt values without writing them back", () => {
    const f = fixture("dark", true);
    const changed = vi.fn();
    const stop = f.store.subscribe(changed);
    f.storage("light");
    expect(f.store.getSnapshot()).toBe("light");
    expect(f.apply).toHaveBeenLastCalledWith("light", "light");
    f.storage(null);
    expect(f.store.getSnapshot()).toBe("system");
    expect(f.apply).toHaveBeenLastCalledWith("dark", "system");
    f.storage("broken");
    expect(changed).toHaveBeenCalledTimes(2);
    expect(f.write).not.toHaveBeenCalled();
    stop();
  });

  it("keeps a blocked-storage choice for the session and avoids redundant DOM applications", () => {
    const f = fixture("system");
    f.write.mockImplementation(() => false);
    const stop = f.store.subscribe(vi.fn());
    f.store.setPreference("dark");
    expect(f.store.getSnapshot()).toBe("dark");
    expect(f.apply).toHaveBeenLastCalledWith("dark", "dark");
    const calls = f.apply.mock.calls.length;
    f.store.setPreference("dark");
    expect(f.apply).toHaveBeenCalledTimes(calls);
    stop();
  });

  it("shares one event subscription and cleans both listeners after the final observer leaves", () => {
    const f = fixture("light");
    const first = f.store.subscribe(vi.fn());
    const second = f.store.subscribe(vi.fn());
    expect(f.apply).toHaveBeenCalledTimes(1);
    first();
    expect(f.stopSystem).not.toHaveBeenCalled();
    second();
    expect(f.stopSystem).toHaveBeenCalledTimes(1);
    expect(f.stopStorage).toHaveBeenCalledTimes(1);
    f.system(true); f.storage("dark");
    expect(f.store.getSnapshot()).toBe("light");
    const third = f.store.subscribe(vi.fn());
    expect(f.apply).toHaveBeenLastCalledWith("light", "light");
    third();
    expect(f.stopSystem).toHaveBeenCalledTimes(2);
  });
});
