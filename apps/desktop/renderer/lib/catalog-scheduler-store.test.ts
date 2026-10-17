import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogReadItemSpec } from "./catalog-read-contracts";
import { emptyCatalogSchedulerState, enqueueCatalogReadJobs, recoverCatalogReadJobs, type CatalogSchedulerState } from "./catalog-read-scheduler";
import { createCatalogHttpDispatcher, createCatalogSchedulerStore, createCatalogTransportCoordinator, type CatalogHttpDispatcherOptions, type CatalogSchedulerClock } from "./catalog-scheduler-store";

const baseTime = 100_000;
const spec = (sourceKey: string, supplierId = "supplier-1", host = "fixture.invalid", role: CatalogReadItemSpec["role"] = "key-membership"): CatalogReadItemSpec => ({
  sourceKey, entryId: sourceKey, sourceUrl: `https://${host}/models`, parserVersion: "fixture", authScope: { kind: "connection-key", principalRef: "fixture", credentialEpoch: "fixture" },
  applyScope: { supplierId, supplierSourceId: "fixture-source", connectionIds: ["fixture-connection"] }, role, requiredForMembership: role === "key-membership",
});
function fixture(specs = [spec("models")], mode: "daily" | "manual" = "daily") {
  let saved: CatalogSchedulerState | undefined = enqueueCatalogReadJobs(emptyCatalogSchedulerState(), specs, { now: baseTime, mode,
    identityEpoch: "identity-1", observationCycleId: "cycle-1", revision: "revision-1", sessionStartedAt: 0 }).state;
  const cas = vi.fn(async (expected, next) => {
    if (JSON.stringify(expected) !== JSON.stringify(saved)) return false;
    saved = structuredClone(next); return true;
  });
  let tracked = 0;
  const trackWrite = async <T>(work: () => Promise<T>) => { tracked++; try { return await work(); } finally { tracked--; } };
  const store = createCatalogSchedulerStore({ load: async () => structuredClone(saved), compareAndSwap: cas, trackWrite });
  return { store, cas, trackWrite, get tracked() { return tracked; }, ids: Object.keys(saved.jobs), get state() { return saved!; } };
}
const guards = () => ({ mode: "daily" as const, draining: false, identityEpoch: () => "identity-1" });
const clock: CatalogSchedulerClock = { now: () => Date.now(), setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };
const closers: Array<() => Promise<void>> = [];
const dispatcher = (options: CatalogHttpDispatcherOptions) => { const result = createCatalogHttpDispatcher(options); closers.push(() => result.close()); return result; };
async function settle() { for (let index = 0; index < 20; index++) await Promise.resolve(); }
afterEach(async () => { for (const close of closers.splice(0)) await close(); vi.useRealTimers(); });

describe("durable scheduler CAS adapter", () => {
  it("rebases pure state changes but never repeats an external request", async () => {
    let saved: CatalogSchedulerState | undefined;
    const cas = vi.fn(async (_expected, value) => { if (cas.mock.calls.length === 1) return false; saved = structuredClone(value); return true; });
    const store = createCatalogSchedulerStore({ load: async () => saved, compareAndSwap: cas });
    expect(await store.mutate(state => ({ state: { ...state, nextOrder: state.nextOrder + 1 }, result: "done" }))).toBe("done");
    expect(cas).toHaveBeenCalledTimes(2);
    expect((await store.read()).nextOrder).toBe(2);
  });
  it("bounds CAS retries and does not overwrite state on failure", async () => {
    const cas = vi.fn(async () => false), store = createCatalogSchedulerStore({ load: async () => undefined, compareAndSwap: cas });
    await expect(store.mutate(state => ({ state: { ...state, nextOrder: 2 }, result: undefined }))).rejects.toThrow("状态竞争");
    expect(cas).toHaveBeenCalledTimes(4);
    expect((await store.read()).nextOrder).toBe(1);
  });
  it("read is side effect free and caller mutations are isolated", async () => {
    const f = fixture(), read = await f.store.read(); read.nextOrder = 99;
    expect((await f.store.read()).nextOrder).not.toBe(99);
    expect(f.cas).not.toHaveBeenCalled();
  });
  it("one owner per store rejects duplicate POST workers", () => {
    const f = fixture(), first = dispatcher({ store: f.store, fetch: vi.fn(), guards });
    expect(() => createCatalogHttpDispatcher({ store: f.store, fetch: vi.fn(), guards })).toThrow("已有所有者");
    expect(first.diagnostics().active).toBe(0);
  });
});

describe("actual HTTP dispatcher with fake clock", () => {
  it("is idle with zero timers and zero writes", () => {
    vi.useFakeTimers(); vi.setSystemTime(baseTime);
    const f = fixture(), fetcher = vi.fn(), d = dispatcher({ store: f.store, fetch: fetcher, guards, clock });
    expect(d.diagnostics()).toMatchObject({ queued: 0, active: 0, timerScheduled: false });
    expect(vi.getTimerCount()).toBe(0); expect(fetcher).not.toHaveBeenCalled(); expect(f.cas).not.toHaveBeenCalled();
  });
  it("spaces every same-host HTTP, including pages of one logical source", async () => {
    vi.useFakeTimers(); vi.setSystemTime(baseTime);
    const f = fixture(), starts: number[] = [];
    const fetcher = vi.fn(async () => { starts.push(Date.now()); return new Response("fixture"); });
    const d = dispatcher({ store: f.store, fetch: fetcher, guards, clock, random: () => 0.5 });
    const transport = d.fetchFor(f.ids[0]!);
    expect(await (await transport("https://fixture.invalid/models?page=1")).text()).toBe("fixture");
    const second = transport("https://fixture.invalid/models?page=2").then(response => response.text());
    await settle(); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await second;
    expect(starts).toEqual([baseTime, baseTime + 2000]);
    expect(f.state.sources.models!.lastAttemptAt).toBe(baseTime);
  });
  it("keeps the network slot through body completion, not just headers", async () => {
    vi.useFakeTimers(); vi.setSystemTime(baseTime);
    const f = fixture([spec("a"), spec("b")]);
    let body: ReadableStreamDefaultController<Uint8Array> | undefined;
    const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { body = controller; } })));
    const d = dispatcher({ store: f.store, fetch: fetcher, guards, clock, random: () => 0.5 });
    const first = await d.fetchFor(f.ids[0]!)("https://fixture.invalid/models");
    const second = d.fetchFor(f.ids[1]!)("https://fixture.invalid/models").then(response => response.body?.cancel());
    await vi.advanceTimersByTimeAsync(3000); expect(fetcher).toHaveBeenCalledTimes(1);
    body!.close(); await first.text(); await settle();
    await second; expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("enforces global two and per-host one across independent supplier stores", async () => {
    vi.useFakeTimers(); vi.setSystemTime(baseTime);
    const coordinator = createCatalogTransportCoordinator();
    const a = fixture([spec("a", "supplier-a", "same.invalid"), spec("c", "supplier-a", "other.invalid")]);
    const b = fixture([spec("b", "supplier-b", "same.invalid"), spec("d", "supplier-b", "third.invalid")]);
    const bodies: Array<ReadableStreamDefaultController<Uint8Array>> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => { void input; return new Response(new ReadableStream<Uint8Array>({ start(controller) { bodies.push(controller); } })); });
    const da = dispatcher({ store: a.store, fetch: fetcher, guards, clock, coordinator, random: () => 0.5 });
    const db = dispatcher({ store: b.store, fetch: fetcher, guards, clock, coordinator, random: () => 0.5 });
    const requests = [da.fetchFor(a.ids[0]!)("https://same.invalid/models"), db.fetchFor(b.ids[0]!)("https://same.invalid/models"),
      da.fetchFor(a.ids[1]!)("https://other.invalid/models"), db.fetchFor(b.ids[1]!)("https://third.invalid/models")];
    const consumed = requests.map(async request => (await request).text());
    await settle(); expect(fetcher).toHaveBeenCalledTimes(2); expect(coordinator.activeCount).toBe(2);
    expect(fetcher.mock.calls.filter(call => String(call[0]).includes("same.invalid"))).toHaveLength(1);
    bodies[0]!.close(); bodies[1]!.close();
    await settle();
    await vi.advanceTimersByTimeAsync(2000); await settle();
    expect(fetcher).toHaveBeenCalledTimes(4);
    bodies[2]!.close(); bodies[3]!.close();
    await Promise.all(consumed);
  });
  it("honors a persisted 48-hour Retry-After across restart without a write lease while waiting", async () => {
    vi.useFakeTimers(); vi.setSystemTime(baseTime);
    const f = fixture([spec("a"), spec("b")]);
    const fetcher = vi.fn(async () => new Response("limited", { status: 429, headers: { "Retry-After": "172800" } }));
    const first = dispatcher({ store: f.store, fetch: fetcher, guards, clock, random: () => 0.5 });
    await (await first.fetchFor(f.ids[0]!)("https://fixture.invalid/models")).text();
    await first.fail(f.ids[0]!, "upstream", "receipt:limited");
    await first.close();
    const resumedFetch = vi.fn(async () => new Response("resumed"));
    const resumed = dispatcher({ store: f.store, fetch: resumedFetch, guards, clock, random: () => 0.5 });
    await expect(resumed.fetchFor(f.ids[1]!)("https://fixture.invalid/models")).rejects.toMatchObject({ reason: "host-cooldown", nextEligibleAt: baseTime + 172800_000 });
    expect(resumedFetch).not.toHaveBeenCalled(); expect(f.tracked).toBe(0);
    expect(f.state.jobs[f.ids[1]!]!.attemptConsumedAt).toBeUndefined();
    expect(resumed.diagnostics().timerScheduled).toBe(false);
    await vi.advanceTimersByTimeAsync(172800_000 - 1); expect(resumedFetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await (await resumed.fetchFor(f.ids[1]!)("https://fixture.invalid/models")).text()).toBe("resumed");
    expect(resumedFetch).toHaveBeenCalledTimes(1);
  });
  it("off/cancelled guards dispatch zero HTTP and consume no attempt", async () => {
    vi.useFakeTimers(); vi.setSystemTime(baseTime);
    const f = fixture(), fetcher = vi.fn(), d = dispatcher({ store: f.store, fetch: fetcher, guards: () => ({ ...guards(), mode: "off" }), clock });
    await expect(d.fetchFor(f.ids[0]!)("https://fixture.invalid/models")).rejects.toMatchObject({ reason: "mode-off" });
    expect(fetcher).not.toHaveBeenCalled(); expect(f.state.jobs[f.ids[0]!]!.attemptConsumedAt).toBeUndefined();
    expect(f.cas).not.toHaveBeenCalled();
  });
  it("manual uses the transport safety limits while bypassing automatic mode off", async () => {
    vi.useFakeTimers(); vi.setSystemTime(baseTime);
    const f = fixture(undefined, "manual"), fetcher = vi.fn(async () => new Response("manual"));
    const d = dispatcher({ store: f.store, fetch: fetcher, guards: () => ({ ...guards(), mode: "off" }), clock });
    expect(await (await d.fetchFor(f.ids[0]!)("https://fixture.invalid/models")).text()).toBe("manual");
  });
  it("cancels waiting requests before dispatch and drains without waiting for cooldown", async () => {
    vi.useFakeTimers(); vi.setSystemTime(baseTime);
    const f = fixture([spec("a"), spec("b")]), fetcher = vi.fn(async () => new Response("ok"));
    const d = dispatcher({ store: f.store, fetch: fetcher, guards, clock, random: () => 0.5 });
    await (await d.fetchFor(f.ids[0]!)("https://fixture.invalid/models")).text();
    const pending = d.fetchFor(f.ids[1]!)("https://fixture.invalid/models");
    const rejected = expect(pending).rejects.toMatchObject({ reason: "draining" });
    await settle(); expect(d.diagnostics().timerScheduled).toBe(true);
    await d.close(); await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0); expect(f.tracked).toBe(0);
  });
  it("an aborted in-flight request becomes unknown and is not resent after recovery", async () => {
    vi.useFakeTimers(); vi.setSystemTime(baseTime);
    const f = fixture(), fetcher = vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("fixture aborted")))));
    const d = dispatcher({ store: f.store, fetch: fetcher, guards, clock });
    const request = d.fetchFor(f.ids[0]!)("https://fixture.invalid/models");
    const rejected = expect(request).rejects.toThrow(); await settle();
    expect(fetcher).toHaveBeenCalledTimes(1); await d.close(); await rejected;
    expect(recoverCatalogReadJobs(f.state, Date.now()).jobs[f.ids[0]!]!.status).toBe("unknown");
    expect(f.state.sources.models!.nextEligibleAt).toBe(baseTime + 86400_000);
  });
  it("rejects unsafe authentication query without dispatching", async () => {
    const f = fixture(), fetcher = vi.fn(), d = dispatcher({ store: f.store, fetch: fetcher, guards });
    await expect(d.fetchFor(f.ids[0]!)("https://fixture.invalid/models?api_key=fictional")).rejects.toThrow("不安全");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not replay a failed page under the same logical attempt", async () => {
    vi.useFakeTimers(); vi.setSystemTime(baseTime);
    const f = fixture(), fetcher = vi.fn(async () => new Response("upstream failed", { status: 500 }));
    const d = dispatcher({ store: f.store, fetch: fetcher, guards, clock, random: () => 0.5 });
    await (await d.fetchFor(f.ids[0]!)("https://fixture.invalid/models?page=2")).text();
    const repeated = d.fetchFor(f.ids[0]!)("https://fixture.invalid/models?page=2");
    const rejected = expect(repeated).rejects.toMatchObject({ reason: "attempt-consumed" });
    await vi.advanceTimersByTimeAsync(2000); await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(f.state.jobs[f.ids[0]!]!.dispatchedRequestKeys).toHaveLength(1);
  });
  it("permits configured Key HTTP only on its exact configured origin", async () => {
    const source = spec("models"); source.sourceUrl = "http://fixture.invalid/v1/models";
    const f = fixture([source]), fetcher = vi.fn(async () => new Response("fixture"));
    const d = dispatcher({ store: f.store, fetch: fetcher, guards });
    await expect(d.fetchFor(f.ids[0]!)("http://other.invalid/models")).rejects.toThrow("不安全");
    expect(await (await d.fetchFor(f.ids[0]!)(source.sourceUrl)).text()).toBe("fixture");
  });
  it("coordinator rotates suppliers and prioritizes Key inventory over auxiliary pages", () => {
    const coordinator = createCatalogTransportCoordinator(), a = {}, b = {}, c = {}, key = {};
    coordinator.queue(a, { supplierId: "supplier-a", host: "a.invalid", priority: 2, eligibleAt: 0 });
    coordinator.queue(b, { supplierId: "supplier-a", host: "b.invalid", priority: 2, eligibleAt: 0 });
    coordinator.queue(c, { supplierId: "supplier-b", host: "c.invalid", priority: 2, eligibleAt: 0 });
    expect(coordinator.acquire("a.invalid", 0, a)).toBe(true); coordinator.release("a.invalid");
    expect(coordinator.preferredRequest(0)).toBe(c);
    coordinator.queue(key, { supplierId: "supplier-a", host: "key.invalid", priority: 1, eligibleAt: 0 });
    expect(coordinator.preferredRequest(0)).toBe(key);
  });
});
