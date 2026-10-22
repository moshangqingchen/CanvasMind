import { afterEach, expect, it, vi } from "vitest";
vi.mock("@super-canvas/providers", async original => ({ ...await original<typeof import("@super-canvas/providers")>(),
  assertSafeProviderEndpoint: vi.fn(async () => undefined) }));
vi.mock("./supplier-service", () => ({ getSupplierRecord: vi.fn(() => { throw Error("No ambient repository"); }) }));
vi.mock("./supplier-site-session", () => ({ openSupplierSiteSession: vi.fn(() => { throw Error("No ambient login"); }), supplierSiteLoginCacheIdentity: vi.fn() }));
import { readCatalogLoaderText } from "./catalog-loader-http";
import { collectCatalogReadTask } from "./catalog-read-task";
import { emptyCatalogSchedulerState, enqueueCatalogReadJobs } from "./catalog-read-scheduler";
import { createCatalogHttpDispatcher, createCatalogSchedulerStore } from "./catalog-scheduler-store";
import type { CatalogReadItemSpec } from "./catalog-read-contracts";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); vi.useRealTimers(); });
const settle = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };

it("bounds a hanging document body with the real dispatcher, records timeout and frees the same host for the next source", async () => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  const specs: CatalogReadItemSpec[] = ["hung", "next"].map(id => ({ sourceKey: id, entryId: `schema-document:https://fixture.invalid/${id}`,
    sourceUrl: `https://fixture.invalid/${id}`, parserVersion: "fixture", authScope: { kind: "anonymous", principalRef: "fixture", credentialEpoch: "fixture" },
    applyScope: { supplierId: "supplier", supplierSourceId: "source", connectionIds: ["connection"] }, role: "schema", requiredForMembership: false }));
  let saved = enqueueCatalogReadJobs(emptyCatalogSchedulerState(), specs, { now: Date.now(), mode: "manual", identityEpoch: "epoch",
    observationCycleId: "cycle", revision: "revision", sessionStartedAt: 0 }).state;
  const store = createCatalogSchedulerStore({ load: async () => structuredClone(saved), compareAndSwap: async (previous, next) => {
    if (JSON.stringify(previous) !== JSON.stringify(saved)) return false;
    saved = structuredClone(next); return true;
  } });
  const cancelled = vi.fn();
  const fetcher = vi.fn<typeof fetch>(async input => String(input).endsWith("/hung")
    ? new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("partial doc")); }, cancel: cancelled }))
    : new Response("next source completed"));
  const dispatcher = createCatalogHttpDispatcher({ store, fetch: fetcher, random: () => .5,
    guards: () => ({ mode: "daily", draining: false, identityEpoch: () => "epoch" }) });
  closers.push(() => dispatcher.close());
  const ids = Object.keys(saved.jobs), reading = collectCatalogReadTask({ spec: specs[0]! }, { id: "connection", name: "Fixture", provider: "openai",
    config: { baseUrl: "https://fixture.invalid/v1" }, createdAt: "before", updatedAt: "before" }, undefined, [],
  { enabled: true, apiKey: "", fetchFor: () => dispatcher.fetchFor(ids[0]!), now: () => new Date().toISOString(),
    context: { runId: "run", observationCycleId: "cycle", identityEpoch: "epoch", dispatchSeq: 1 } });
  await settle();
  expect(dispatcher.diagnostics().active).toBe(1);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(cancelled).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await reading).toMatchObject({ observation: { receipt: { status: "failed", complete: false, reason: "network", failureCode: "timeout" },
    facts: { models: [], contracts: [], interfaceDocuments: [] } }, discovered: [] });
  expect(cancelled).toHaveBeenCalledTimes(1);
  await settle();
  expect(dispatcher.diagnostics().active).toBe(0);
  const next = readCatalogLoaderText(specs[1]!.sourceUrl, { fetch: dispatcher.fetchFor(ids[1]!) });
  await vi.advanceTimersByTimeAsync(0);
  expect(await next).toBe("next source completed");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(Object.values(saved.jobs)[0]?.attemptConsumedAt).toBe(100_000);
});

it("bounds missing headers even if a custom transport ignores abort and cancels a response arriving after the deadline", async () => {
  vi.useFakeTimers();
  let deliver: ((response: Response) => void) | undefined;
  const fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => { deliver = resolve; }));
  const reading = readCatalogLoaderText("https://fixture.invalid/docs", { fetch: fetcher, timeoutMs: 50 });
  const rejected = expect(reading).rejects.toMatchObject({ code: "timeout" });
  await vi.advanceTimersByTimeAsync(50); await rejected;
  const cancel = vi.fn();
  deliver!(new Response(new ReadableStream({ cancel })));
  await settle();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});

it("keeps caller cancellation distinct and cancels a pending body without waiting for another chunk", async () => {
  vi.useFakeTimers();
  const abort = new AbortController(), reason = new Error("caller cancelled"), cancel = vi.fn();
  const reading = readCatalogLoaderText("https://fixture.invalid/docs", { signal: abort.signal,
    fetch: vi.fn(async () => new Response(new ReadableStream({ cancel }))) });
  const rejected = expect(reading).rejects.toBe(reason);
  await settle(); abort.abort(reason); await rejected;
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
