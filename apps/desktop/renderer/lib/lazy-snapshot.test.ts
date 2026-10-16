import { describe, expect, it } from "vitest";
import { createLazySnapshot } from "./lazy-snapshot";

describe("lazy dependency snapshots", () => {
  it("does no directory work while closed and shares the first value across event/render consumers", () => {
    let calls = 0;
    const getModels = createLazySnapshot(() => { calls++; return [{ id: "model-a" }]; });
    expect(calls).toBe(0);
    const preferredModels = getModels();
    expect(getModels()).toBe(preferredModels);
    expect(getModels()).toBe(preferredModels);
    expect(calls).toBe(1);
  });

  it("creates a fresh value after a dependency snapshot changes without reusing old evidence", () => {
    let calls = 0;
    const oldGetter = createLazySnapshot(() => { calls++; return ["old-model"]; });
    const oldValue = oldGetter();
    const newGetter = createLazySnapshot(() => { calls++; return ["new-model"]; });
    expect(calls).toBe(1);
    expect(newGetter()).toEqual(["new-model"]);
    expect(newGetter()).not.toBe(oldValue);
    expect(calls).toBe(2);
  });

  it("caches empty/undefined results and does not poison the getter when computation throws", () => {
    let calls = 0;
    const empty = createLazySnapshot(() => { calls++; return undefined; });
    expect(empty()).toBeUndefined(); expect(empty()).toBeUndefined();
    expect(calls).toBe(1);
    let attempts = 0;
    const retry = createLazySnapshot(() => { if (++attempts === 1) throw new Error("temporary"); return []; });
    expect(retry).toThrow("temporary");
    const value = retry(); expect(retry()).toBe(value);
    expect(attempts).toBe(2);
  });
});
