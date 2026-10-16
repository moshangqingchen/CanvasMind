import { describe, expect, it, vi } from "vitest";
import { createCanvasViewportHydration } from "./canvas-viewport-hydration";

const saved = { x: 40, y: 70, zoom: .75 };

function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>(yes => { resolve = yes; });
  return { promise, resolve };
}

describe("persisted canvas viewport hydration", () => {
  it("never applies an unstaged or differently owned viewport", async () => {
    const hydration = createCanvasViewportHydration();
    const apply = vi.fn(async () => true);
    expect(hydration.ready("a")).toBe(false);
    expect(await hydration.apply("a", apply)).toBe(false);
    hydration.stage("a", saved);
    expect(await hydration.apply("b", apply)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(hydration.ready("a")).toBe(false);
  });

  it("passes the saved target and becomes ready only after successful completion", async () => {
    const hydration = createCanvasViewportHydration();
    const pending = deferred();
    const apply = vi.fn(() => pending.promise);
    hydration.stage("next", saved);
    const result = hydration.apply("next", apply);
    expect(hydration.ready("next")).toBe(false);
    await Promise.resolve();
    expect(apply).toHaveBeenCalledExactlyOnceWith(saved);
    expect(hydration.ready("next")).toBe(false);
    pending.resolve(true);
    expect(await result).toBe(true);
    expect(hydration.ready("next")).toBe(true);
    expect(hydration.ready("previous")).toBe(false);
  });

  it("shares an in-flight attempt and does not reapply a ready snapshot", async () => {
    const hydration = createCanvasViewportHydration();
    const pending = deferred();
    const apply = vi.fn(() => pending.promise);
    const duplicate = vi.fn(async () => true);
    hydration.stage("a", saved);
    const first = hydration.apply("a", apply);
    const second = hydration.apply("a", duplicate);
    expect(second).toBe(first);
    await Promise.resolve();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(duplicate).not.toHaveBeenCalled();
    pending.resolve(true);
    expect(await second).toBe(true);
    expect(await hydration.apply("a", duplicate)).toBe(true);
    expect(duplicate).not.toHaveBeenCalled();
  });

  it("ignores an old project's completion without activating the next project", async () => {
    const hydration = createCanvasViewportHydration();
    const old = deferred();
    hydration.stage("old", { x: 0, y: 0, zoom: .85 });
    const previous = hydration.apply("old", () => old.promise);
    await Promise.resolve();
    hydration.stage("next", saved);
    old.resolve(true);
    expect(await previous).toBe(false);
    expect(hydration.ready("old")).toBe(false);
    expect(hydration.ready("next")).toBe(false);
    expect(await hydration.apply("next", async value => {
      expect(value).toEqual(saved);
      return true;
    })).toBe(true);
  });

  it("invalidates an in-flight attempt on reset, including a same-project restage", async () => {
    const hydration = createCanvasViewportHydration();
    const old = deferred();
    hydration.stage("a", saved);
    const previous = hydration.apply("a", () => old.promise);
    await Promise.resolve();
    hydration.reset();
    expect(hydration.ready("a")).toBe(false);
    hydration.stage("a", saved);
    old.resolve(true);
    expect(await previous).toBe(false);
    expect(hydration.ready("a")).toBe(false);
    expect(await hydration.apply("a", async () => true)).toBe(true);
  });

  it("does not let an obsolete same-project read replace or unset the newer ready snapshot", async () => {
    const hydration = createCanvasViewportHydration();
    const old = deferred();
    hydration.stage("a", { x: 0, y: 0, zoom: .85 });
    const previous = hydration.apply("a", () => old.promise);
    await Promise.resolve();
    hydration.stage("a", saved);
    expect(await hydration.apply("a", async value => {
      expect(value).toEqual(saved);
      return true;
    })).toBe(true);
    old.resolve(false);
    expect(await previous).toBe(false);
    expect(hydration.ready("a")).toBe(true);
  });

  it("does not invoke a superseded attempt that has not started yet", async () => {
    const hydration = createCanvasViewportHydration();
    const apply = vi.fn(async () => true);
    hydration.stage("a", saved);
    const previous = hydration.apply("a", apply);
    hydration.reset();
    expect(await previous).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  for (const failure of ["false", "rejected", "synchronous throw"] as const) {
    it(`keeps a ${failure} application pending and retries the same snapshot`, async () => {
      const hydration = createCanvasViewportHydration();
      hydration.stage("a", saved);
      expect(await hydration.apply("a", () => {
        if (failure === "synchronous throw") throw new Error("viewport unavailable");
        return failure === "false" ? Promise.resolve(false) : Promise.reject(new Error("viewport unavailable"));
      })).toBe(false);
      expect(hydration.ready("a")).toBe(false);
      expect(await hydration.apply("a", async value => {
        expect(value).toEqual(saved);
        return true;
      })).toBe(true);
      expect(hydration.ready("a")).toBe(true);
    });
  }

  it("copies the staged argument and isolates callback mutations from retries", async () => {
    const hydration = createCanvasViewportHydration();
    const input = { ...saved };
    hydration.stage("a", input);
    input.x = 900;
    expect(await hydration.apply("a", async value => {
      expect(value).toEqual(saved);
      expect(value).not.toBe(input);
      value.x = 1234;
      value.zoom = 20;
      return false;
    })).toBe(false);
    expect(await hydration.apply("a", async value => {
      expect(value).toEqual(saved);
      return true;
    })).toBe(true);
    hydration.reset();
    expect(hydration.ready("a")).toBe(false);
    expect(await hydration.apply("a", async () => true)).toBe(false);
  });
});
