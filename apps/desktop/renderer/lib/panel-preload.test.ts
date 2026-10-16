import { describe, expect, it, vi } from "vitest";
import { createPanelModulePreloader, schedulePanelPreload, type PanelIdleScheduler } from "./panel-preload";

function idleHost() {
  let next = 0;
  const callbacks = new Map<number, (deadline: { timeRemaining: () => number }) => void>();
  const host: PanelIdleScheduler = {
    requestIdleCallback: vi.fn(callback => { callbacks.set(++next, callback); return next; }),
    cancelIdleCallback: vi.fn(id => { callbacks.delete(id); }),
    setTimeout: vi.fn(() => 0), clearTimeout: vi.fn(),
  };
  return { host, callbacks, flush(remaining = 10) {
    const [id, callback] = callbacks.entries().next().value!;
    callbacks.delete(id);
    callback({ timeRemaining: () => remaining });
  } };
}

describe("panel module preloading", () => {
  it("shares an in-flight warmup and retains only its void completion", async () => {
    let resolve!: (value: unknown) => void;
    const load = vi.fn(() => new Promise(done => { resolve = done; }));
    const preload = createPanelModulePreloader(load);
    const first = preload();
    expect(preload()).toBe(first);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    resolve({ largeModule: true });
    expect(await first).toBeUndefined();
    expect(preload()).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not create an unhandled optional-load error and retries a failed import", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("chunk unavailable")).mockResolvedValueOnce({ ready: true });
    const preload = createPanelModulePreloader(load);
    await expect(preload()).resolves.toBeUndefined();
    await expect(preload()).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("also retries a synchronous loader error", async () => {
    const load = vi.fn().mockImplementationOnce(() => { throw new Error("sync failure"); }).mockResolvedValueOnce(undefined);
    const preload = createPanelModulePreloader(load);
    await preload(); await preload();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("cancelable idle panel warmup", () => {
  it("waits for an idle budget and runs only once", async () => {
    const { host, callbacks, flush } = idleHost();
    const work = vi.fn();
    schedulePanelPreload(work, host);
    flush(0);
    expect(work).not.toHaveBeenCalled();
    expect(callbacks.size).toBe(1);
    flush(10);
    await Promise.resolve();
    expect(work).toHaveBeenCalledTimes(1);
    expect(callbacks.size).toBe(0);
  });

  it("cancels a queued idle callback on navigation", async () => {
    const { host, callbacks } = idleHost();
    const work = vi.fn();
    const cancel = schedulePanelPreload(work, host);
    cancel(); cancel();
    await Promise.resolve();
    expect(callbacks.size).toBe(0);
    expect(host.cancelIdleCallback).toHaveBeenCalledTimes(1);
    expect(work).not.toHaveBeenCalled();
  });

  it("does not start a module when cancelled after the idle callback but before its microtask", async () => {
    const { host, flush } = idleHost();
    const work = vi.fn();
    const cancel = schedulePanelPreload(work, host);
    flush(); cancel();
    await Promise.resolve();
    expect(work).not.toHaveBeenCalled();
  });

  it("uses a cancellable delayed task when idle callbacks are unavailable", async () => {
    const timers = new Map<number, () => void>();
    let next = 0;
    const host: PanelIdleScheduler = {
      setTimeout: vi.fn(callback => { timers.set(++next, callback); return next; }),
      clearTimeout: vi.fn(id => { timers.delete(id); }),
    };
    const work = vi.fn();
    const cancel = schedulePanelPreload(work, host);
    expect(host.setTimeout).toHaveBeenCalledWith(expect.any(Function), 250);
    cancel();
    expect(timers.size).toBe(0);
    schedulePanelPreload(work, host);
    timers.get(next)!();
    await Promise.resolve();
    expect(work).toHaveBeenCalledTimes(1);
  });
});
