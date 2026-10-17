import { afterEach, describe, expect, it, vi } from "vitest";
import { createCatalogPipelineWakeLoop } from "./catalog-pipeline-wake";
import type { CatalogPipelineRunResult } from "./catalog-pipeline-service";
import type { CatalogSchedulerClock } from "./catalog-scheduler-store";

const day = 24 * 60 * 60_000;
const initialTime = Date.UTC(2001, 0, 1, 23, 59, 0);
const clock: CatalogSchedulerClock = { now: () => Date.now(), setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };
const complete = (extra: Partial<CatalogPipelineRunResult> = {}): CatalogPipelineRunResult => ({ enabled: true, published: 0, pending: 0, superseded: 0, ...extra });
const closers: Array<() => void> = [];
const loop = (options: Parameters<typeof createCatalogPipelineWakeLoop>[0]) => {
  const value = createCatalogPipelineWakeLoop(options); closers.push(() => value.close()); return value;
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  return { promise: new Promise<T>((yes, no) => { resolve = yes; reject = no; }), resolve: (value: T) => resolve(value), reject: (reason: unknown) => reject(reason) };
}
async function settle() { for (let index = 0; index < 10; index++) await Promise.resolve(); }
afterEach(() => { for (const close of closers.splice(0)) close(); vi.useRealTimers(); });

describe("backend catalog wake loop", () => {
  it("leaves the stable sixty-second startup eligibility to the service", async () => {
    vi.useFakeTimers(); vi.setSystemTime(initialTime);
    const startedAt = Date.now(), eligibleAt = startedAt + 60_000;
    let requests = 0;
    const run = vi.fn(async () => {
      if (Date.now() < eligibleAt) return complete({ pending: 1, nextWakeAt: eligibleAt });
      requests++; return complete({ published: 1, nextWakeAt: Date.now() + day });
    });
    const value = loop({ clock, connectionIds: async () => ["fixture-connection"], run, canContinue: () => true, close: vi.fn() });
    await value.wake();
    await vi.advanceTimersByTimeAsync(20_000); await value.wake();
    expect(requests).toBe(0); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(39_999); expect(requests).toBe(0);
    await vi.advanceTimersByTimeAsync(1); expect(requests).toBe(1);
    expect(Date.now()).toBe(startedAt + 60_000);
  });
  it("coalesces repeated wakes while a backend round is already running", async () => {
    vi.useFakeTimers(); vi.setSystemTime(initialTime);
    const gate = deferred<CatalogPipelineRunResult>();
    const run = vi.fn(() => gate.promise);
    const value = loop({ clock, connectionIds: async () => ["fixture-connection", "fixture-connection"], run, canContinue: () => true, close: vi.fn() });
    const first = value.wake(), second = value.wake(), third = value.wake();
    expect(second).toBe(first); expect(third).toBe(first);
    await settle(); expect(run).toHaveBeenCalledTimes(1);
    gate.resolve(complete()); await first;
    expect(vi.getTimerCount()).toBe(1);
    expect(value.diagnostics().running).toBe(false);
  });
  it("a coalesced follow-up cannot create a second attempt in an already consumed service cycle", async () => {
    vi.useFakeTimers(); vi.setSystemTime(initialTime);
    const gate = deferred<void>(); let consumed = false, requests = 0;
    const run = vi.fn(async () => {
      await gate.promise;
      if (!consumed) { consumed = true; requests++; }
      return complete({ nextWakeAt: initialTime + day });
    });
    const value = loop({ clock, connectionIds: async () => ["fixture-connection"], run, canContinue: () => true, close: vi.fn() });
    const first = value.wake(); void value.wake(); gate.resolve(); await first;
    await vi.advanceTimersByTimeAsync(1500);
    expect(run).toHaveBeenCalledTimes(2); expect(requests).toBe(1);
    expect(run.mock.calls[0]).toEqual(run.mock.calls[1]);
    expect(vi.getTimerCount()).toBe(1);
  });
  it("continues pending work after midnight at its returned eligibility, without inventing an extra retry", async () => {
    vi.useFakeTimers(); vi.setSystemTime(initialTime);
    const eligibleAt = initialTime + 2 * 60 * 60_000;
    let requests = 0;
    const cycles: string[] = [];
    const run = vi.fn(async (id: string, cycleId: string) => {
      void id;
      cycles.push(cycleId);
      if (Date.now() < eligibleAt) return complete({ pending: 1, nextWakeAt: eligibleAt });
      requests++; return complete({ published: 1, nextWakeAt: Date.now() + day });
    });
    const value = loop({ clock, connectionIds: async () => ["fixture-connection"], run, canContinue: () => true, close: vi.fn() });
    await value.wake(); await vi.advanceTimersByTimeAsync(2 * 60 * 60_000 - 1);
    expect(run).toHaveBeenCalledTimes(1); expect(requests).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toBe(1); expect(cycles).toEqual(["daily:2001-01-01", "daily:2001-01-02"]);
    // These are wake hints. The service retains the deferred job's persisted cycle.
    expect(vi.getTimerCount()).toBe(1);
  });
  it("keeps one timer for a forty-eight-hour cooldown and close never waits for it", async () => {
    vi.useFakeTimers(); vi.setSystemTime(initialTime);
    const run = vi.fn(async () => complete({ pending: 2, nextWakeAt: initialTime + day * 2 })), close = vi.fn();
    const value = loop({ clock, connectionIds: async () => ["fixture-a", "fixture-b"], run, canContinue: () => true, close });
    await value.wake(); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(day * 2 - 1); expect(run).toHaveBeenCalledTimes(2);
    value.close(); expect(close).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(day); expect(run).toHaveBeenCalledTimes(2);
    await value.wake(); expect(run).toHaveBeenCalledTimes(2);
  });
  it("uses the earliest pending eligibility and clamps already-due hints to avoid a hot loop", async () => {
    vi.useFakeTimers(); vi.setSystemTime(initialTime);
    const run = vi.fn(async (id: string) => complete({ pending: 1, nextWakeAt: initialTime + (id === "fixture-a" ? 10_000 : 20_000) }));
    const value = loop({ clock, connectionIds: async () => ["fixture-a", "fixture-b"], run, canContinue: () => true, close: vi.fn() });
    await value.wake(); await vi.advanceTimersByTimeAsync(9999); expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1499); expect(run).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(1);
  });
  it("off before a wake clears pending timers and performs no run", async () => {
    vi.useFakeTimers(); vi.setSystemTime(initialTime);
    let allowed = true;
    const run = vi.fn(async () => complete({ nextWakeAt: initialTime + 1000 }));
    const value = loop({ clock, connectionIds: async () => ["fixture-connection"], run, canContinue: () => allowed, close: vi.fn() });
    await value.wake(); allowed = false; await value.wake();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(day * 2); expect(run).toHaveBeenCalledTimes(1);
  });
  it.each(["off", "drain", "close"] as const)("rechecks %s after asynchronously loading connection ids", async action => {
    vi.useFakeTimers(); vi.setSystemTime(initialTime);
    let allowed = true;
    const ids = deferred<string[]>(), run = vi.fn(async () => complete()), close = vi.fn();
    const value = loop({ clock, connectionIds: () => ids.promise, run, canContinue: () => allowed, close });
    const running = value.wake();
    if (action === "close") value.close(); else allowed = false;
    ids.resolve(["fixture-connection"]); await running;
    expect(run).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("close cancels the backend synchronously, is idempotent, and does not await an in-flight round", async () => {
    vi.useFakeTimers(); vi.setSystemTime(initialTime);
    const pending = deferred<CatalogPipelineRunResult>(), close = vi.fn();
    const run = vi.fn(() => pending.promise);
    const value = loop({ clock, connectionIds: async () => ["fixture-connection"], run, canContinue: () => true, close });
    const running = value.wake(); await settle();
    value.close(); value.close();
    expect(close).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    pending.reject(new Error("fixture cancelled by drain")); await running;
    expect(run).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("contains individual fixture run rejections and continues other connections without unhandled rejection", async () => {
    vi.useFakeTimers(); vi.setSystemTime(initialTime);
    const unhandled = vi.fn(), run = vi.fn(async (id: string) => {
      if (id === "fixture-rejected") throw new Error("fixture-only upstream failure");
      return complete({ nextWakeAt: initialTime + 30_000 });
    });
    process.on("unhandledRejection", unhandled);
    try {
      const value = loop({ clock, connectionIds: async () => ["fixture-rejected", "fixture-ok"], run, canContinue: () => true, close: vi.fn() });
      await expect(value.wake()).resolves.toBeUndefined(); await settle();
      expect(run).toHaveBeenCalledTimes(2); expect(unhandled).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(30_000); expect(run).toHaveBeenCalledTimes(4); expect(unhandled).not.toHaveBeenCalled();
    } finally { process.off("unhandledRejection", unhandled); }
  });
});
