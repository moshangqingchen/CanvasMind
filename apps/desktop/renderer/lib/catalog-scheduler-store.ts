import { createHash, randomUUID } from "node:crypto";
import {
  assertCatalogSchedulerState, claimCatalogReadJob, compactCatalogSchedulerState,
  emptyCatalogSchedulerState, finishCatalogReadJob, recordCatalogHostResponse, recordCatalogHostStart,
  type CatalogDispatchGuards, type CatalogHostCooldown, type CatalogReadJob, type CatalogSchedulerReason, type CatalogSchedulerState,
} from "./catalog-read-scheduler";

export interface CatalogSchedulerPersistence {
  read(): Promise<CatalogSchedulerState>;
  /** The callback is synchronous and pure; durable CAS adapters may rebase it. */
  mutate<T>(reducer: (current: CatalogSchedulerState) => { state: CatalogSchedulerState; result: T }): Promise<T>;
}
export interface CatalogSchedulerCasStorage {
  load(): Promise<CatalogSchedulerState | undefined>;
  /** Must use the repository's short atomic barrier; never plain read-then-set. */
  compareAndSwap(expected: CatalogSchedulerState | undefined, next: CatalogSchedulerState): Promise<boolean>;
  /** Only this short mutation belongs in desktop write tracking. */
  trackWrite?<T>(work: () => Promise<T>): Promise<T>;
}

/** Pure reducers are retried after unrelated state contention; HTTP is never retried here. */
export function createCatalogSchedulerStore(storage: CatalogSchedulerCasStorage): CatalogSchedulerPersistence {
  let tail = Promise.resolve();
  return {
    async read() { const saved = await storage.load(); if (saved !== undefined) assertCatalogSchedulerState(saved); return structuredClone(saved ?? emptyCatalogSchedulerState()); },
    mutate<T>(reducer: (current: CatalogSchedulerState) => { state: CatalogSchedulerState; result: T }): Promise<T> {
      const work = async () => {
        for (let attempt = 0; attempt < 4; attempt++) {
          const saved = await storage.load();
          if (saved !== undefined) assertCatalogSchedulerState(saved);
          const next = reducer(structuredClone(saved ?? emptyCatalogSchedulerState()));
          assertCatalogSchedulerState(next.state);
          if (JSON.stringify(saved ?? emptyCatalogSchedulerState()) === JSON.stringify(next.state)) return next.result;
          const commit = () => storage.compareAndSwap(saved, next.state);
          if (await (storage.trackWrite ? storage.trackWrite(commit) : commit())) return next.result;
        }
        throw new Error("目录调度状态竞争，已保留待办，未重发请求");
      };
      const promise = tail.then(work);
      tail = promise.then(() => undefined, () => undefined);
      return promise;
    },
  };
}

export interface CatalogSchedulerClock {
  now(): number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}
const systemClock: CatalogSchedulerClock = {
  now: () => Date.now(), setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
export class CatalogDispatchDeferredError extends Error {
  constructor(readonly reason: CatalogSchedulerReason, readonly nextEligibleAt?: number) {
    super(`目录读取已延后：${reason}`); this.name = "CatalogDispatchDeferredError";
  }
}
interface PendingRequest {
  jobId: string;
  input: Parameters<typeof fetch>[0];
  init?: Parameters<typeof fetch>[1];
  fetch: typeof fetch;
  host: string;
  supplierId: string;
  priority: number;
  order: number;
  requestKey: string;
  signal?: AbortSignal;
  resolve(value: Response): void;
  reject(reason: unknown): void;
  removeAbort?: () => void;
}
export interface CatalogHttpDispatcherOptions {
  store: CatalogSchedulerPersistence;
  /** Required explicitly. A production global fetch is never selected implicitly. */
  fetch: typeof fetch;
  guards(): Omit<CatalogDispatchGuards, "now" | "owner" | "identityEpoch"> & { identityEpoch(job: CatalogReadJob): string };
  clock?: CatalogSchedulerClock;
  random?: () => number;
  owner?: string;
  maxPending?: number;
  /** One coordinator per backend repository, shared by all supplier stores. */
  coordinator?: ReturnType<typeof createCatalogTransportCoordinator>;
}
const owners = new WeakMap<CatalogSchedulerPersistence, object>();

export function createCatalogTransportCoordinator() {
  const activeHosts = new Set<string>(), hosts = new Map<string, { nextStartAt: number; cooldownUntil: number }>();
  const listeners = new Set<() => void>();
  const requests = new Map<object, { supplierId: string; host: string; priority: number; eligibleAt: number; order: number }>();
  let order = 1, lastSupplier = "";
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    /** Startup must absorb every saved supplier before any dispatch is enabled. */
    absorb(saved: Record<string, CatalogHostCooldown>) {
      for (const [host, value] of Object.entries(saved)) {
        const old = hosts.get(host);
        hosts.set(host, { nextStartAt: Math.max(old?.nextStartAt ?? 0, value.nextStartAt), cooldownUntil: Math.max(old?.cooldownUntil ?? 0, value.cooldownUntil) });
      }
    },
    nextEligibleAt(host: string) { const value = hosts.get(host); return Math.max(value?.nextStartAt ?? 0, value?.cooldownUntil ?? 0); },
    cooldownUntil(host: string) { return hosts.get(host)?.cooldownUntil ?? 0; },
    isHostActive(host: string) { return activeHosts.has(host); },
    get activeCount() { return activeHosts.size; },
    queue(key: object, request: { supplierId: string; host: string; priority: number; eligibleAt: number }) {
      requests.set(key, { ...request, order: order++ }); notify();
    },
    dequeue(key: object) { requests.delete(key); },
    preferredRequest(now: number): object | undefined {
      return [...requests.entries()].filter(([, item]) => !activeHosts.has(item.host) && item.eligibleAt <= now && this.nextEligibleAt(item.host) <= now)
        .sort(([, a], [, b]) => a.priority - b.priority || Number(a.supplierId === lastSupplier) - Number(b.supplierId === lastSupplier) || a.order - b.order)[0]?.[0];
    },
    acquire(host: string, now: number, key: object) {
      if (activeHosts.size >= 2 || activeHosts.has(host) || this.nextEligibleAt(host) > now) return false;
      if (this.preferredRequest(now) !== key) return false;
      lastSupplier = requests.get(key)!.supplierId;
      requests.delete(key); activeHosts.add(host); return true;
    },
    release(host: string) { activeHosts.delete(host); notify(); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** One backend owner; every actual HTTP (including candidates and pages) passes here.
 * Waiting occupies neither a network slot nor a desktop write lease. */
export function createCatalogHttpDispatcher(options: CatalogHttpDispatcherOptions) {
  if (owners.has(options.store)) throw new Error("目录调度已有所有者");
  const token = {}, owner = options.owner ?? randomUUID(), clock = options.clock ?? systemClock;
  const coordinator = options.coordinator ?? createCatalogTransportCoordinator();
  owners.set(options.store, token);
  const queue: PendingRequest[] = [], running = new Map<PendingRequest, AbortController>(), activeHosts = new Set<string>();
  let pendingOrder = 1, timer: unknown, pumping = false, repump = false, closed = false, lastSupplier = "";
  const clearTimer = () => { if (timer !== undefined) clock.clearTimeout(timer); timer = undefined; };
  const rejectQueued = (item: PendingRequest, error: Error) => {
    const index = queue.indexOf(item); if (index >= 0) queue.splice(index, 1);
    coordinator.dequeue(item);
    item.removeAbort?.(); item.reject(error);
  };
  const schedule = (at: number) => {
    clearTimer();
    timer = clock.setTimeout(() => { timer = undefined; void pump(); }, Math.min(2_147_483_647, Math.max(1, at - clock.now())));
  };
  const release = (item: PendingRequest) => {
    if (!running.delete(item)) return;
    activeHosts.delete(item.host); item.removeAbort?.();
    coordinator.release(item.host);
    void pump();
  };
  const execute = async (item: PendingRequest) => {
    const controller = new AbortController(); running.set(item, controller); activeHosts.add(item.host);
    const abort = () => controller.abort(item.signal?.reason);
    item.signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => { item.signal?.removeEventListener("abort", abort); release(item); };
    try {
      const response = await item.fetch(item.input, { ...item.init, signal: controller.signal });
      const hosts = await options.store.mutate(state => { const next = recordCatalogHostResponse(state, item.host, clock.now(), response.status, response.headers.get("retry-after"));
        return { state: next, result: next.hosts }; });
      coordinator.absorb(hosts);
      if (closed || controller.signal.aborted) { await response.body?.cancel().catch(() => undefined); cleanup(); item.reject(new CatalogDispatchDeferredError("cancelled")); return; }
      if (!response.body) { cleanup(); item.resolve(response); return; }
      // Keep the slot until the body is consumed, cancelled or fails; headers alone
      // do not mean that an HTTP transfer has finished.
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(stream) {
          try { const part = await reader.read(); if (part.done) { stream.close(); cleanup(); } else stream.enqueue(part.value); }
          catch (error) { stream.error(error); cleanup(); }
        },
        async cancel(reason) { try { await reader.cancel(reason); } finally { cleanup(); } },
      });
      const wrapped = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      Object.defineProperty(wrapped, "url", { value: response.url });
      Object.defineProperty(wrapped, "redirected", { value: response.redirected });
      item.resolve(wrapped);
    } catch (error) { cleanup(); item.reject(error); }
  };
  async function pump() {
    if (closed) return;
    if (pumping) { repump = true; return; }
    pumping = true; clearTimer();
    let reservedHost: string | undefined;
    try {
      let earliest = Infinity;
      while (queue.length && coordinator.activeCount < 2 && !closed) {
        const state = await options.store.read(), now = clock.now(), guard = options.guards();
        coordinator.absorb(state.hosts);
        if (guard.draining) {
          for (const item of [...queue]) rejectQueued(item, new CatalogDispatchDeferredError("draining"));
          for (const controller of running.values()) controller.abort();
          break;
        }
        const candidates: PendingRequest[] = [];
        earliest = Infinity;
        for (const item of [...queue]) {
          const job = state.jobs[item.jobId];
          if (job && job.mode !== "manual" && guard.mode === "off") {
            rejectQueued(item, new CatalogDispatchDeferredError("mode-off")); continue;
          }
          if (!job || item.signal?.aborted || job.identityEpoch !== guard.identityEpoch(job) ||
            !["queued", "deferred", "running"].includes(job.status)) {
            rejectQueued(item, new CatalogDispatchDeferredError(item.signal?.aborted ? "cancelled" : "identity-changed")); continue;
          }
          if (coordinator.isHostActive(item.host)) continue;
          const host = state.hosts[item.host];
          const cooldownUntil = Math.max(host?.cooldownUntil ?? 0, coordinator.cooldownUntil(item.host));
          if (cooldownUntil > now) {
            // A durable deferred job ends this round instead of keeping its
            // supplier owner (or an HTTP handler) pending for hours.
            if (job.attemptConsumedAt === undefined) await options.store.mutate(current => {
              const pending = current.jobs[item.jobId];
              if (pending && pending.attemptConsumedAt === undefined && ["queued", "deferred"].includes(pending.status)) {
                pending.status = "deferred"; pending.reason = "host-cooldown";
                pending.nextAttemptEligibleAt = Math.max(pending.nextAttemptEligibleAt, cooldownUntil);
              }
              return { state: current, result: undefined };
            });
            rejectQueued(item, new CatalogDispatchDeferredError("host-cooldown", cooldownUntil)); continue;
          }
          const eligible = Math.max(job.nextAttemptEligibleAt, host?.cooldownUntil ?? 0, host?.nextStartAt ?? 0, coordinator.nextEligibleAt(item.host));
          if (eligible > now) { earliest = Math.min(earliest, eligible); continue; }
          candidates.push(item);
        }
        candidates.sort((a, b) => a.priority - b.priority || Number(a.supplierId === lastSupplier) - Number(b.supplierId === lastSupplier) || a.order - b.order);
        const preferred = coordinator.preferredRequest(now), item = candidates.find(candidate => candidate === preferred);
        if (!item) break;
        if (!coordinator.acquire(item.host, clock.now(), item)) break;
        reservedHost = item.host;
        const started = await options.store.mutate<"started" | "blocked" | "attempt-consumed" | "budget">(current => {
          const liveGuard = options.guards(), job = current.jobs[item.jobId];
          if (!job || item.signal?.aborted || closed) return { state: current, result: "blocked" };
          if (job.dispatchedRequestKeys?.includes(item.requestKey)) return { state: current, result: "attempt-consumed" };
          if ((job.dispatchedRequestKeys?.length ?? 0) >= 4096) return { state: current, result: "budget" };
          const host = current.hosts[item.host];
          if (Math.max(host?.cooldownUntil ?? 0, host?.nextStartAt ?? 0, coordinator.nextEligibleAt(item.host)) > clock.now()) return { state: current, result: "blocked" };
          const claim = claimCatalogReadJob(current, item.jobId, { ...liveGuard, now: clock.now(), owner, identityEpoch: liveGuard.identityEpoch(job) });
          if (claim.claimed) (claim.state.jobs[item.jobId]!.dispatchedRequestKeys ??= []).push(item.requestKey);
          return { state: claim.claimed ? recordCatalogHostStart(claim.state, item.host, clock.now(), options.random?.() ?? Math.random()) : claim.state, result: claim.claimed ? "started" : "blocked" };
        });
        if (started !== "started") { coordinator.release(item.host); reservedHost = undefined; rejectQueued(item, new CatalogDispatchDeferredError(started === "blocked" ? "cancelled" : started)); continue; }
        coordinator.absorb((await options.store.read()).hosts);
        const beforeHttp = options.guards();
        if (closed || item.signal?.aborted || beforeHttp.draining || beforeHttp.mode === "off" && state.jobs[item.jobId]?.mode !== "manual") {
          coordinator.release(item.host); reservedHost = undefined; rejectQueued(item, new CatalogDispatchDeferredError(beforeHttp.draining || closed ? "draining" : item.signal?.aborted ? "cancelled" : "mode-off")); continue;
        }
        queue.splice(queue.indexOf(item), 1); item.removeAbort?.();
        lastSupplier = item.supplierId;
        reservedHost = undefined;
        void execute(item);
      }
      if (queue.length && Number.isFinite(earliest) && !closed) schedule(earliest);
    } catch (error) { if (reservedHost) coordinator.release(reservedHost); for (const item of [...queue]) rejectQueued(item, error instanceof Error ? error : new Error("目录调度失败")); }
    finally { pumping = false; if (repump) { repump = false; void pump(); } }
  }
  const unsubscribe = coordinator.subscribe(() => { void pump(); });
  return {
    owner,
    fetchFor(jobId: string, signal?: AbortSignal): typeof fetch {
      return async (input, init) => {
        if (closed) throw new CatalogDispatchDeferredError("draining");
        const guard = options.guards();
        if (guard.draining) throw new CatalogDispatchDeferredError("draining");
        const signals = [init?.signal, signal].filter((value): value is AbortSignal => value !== null && value !== undefined);
        const combinedSignal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
        if (combinedSignal?.aborted) throw new CatalogDispatchDeferredError("cancelled");
        const state = await options.store.read(), job = state.jobs[jobId];
        if (!job) throw new CatalogDispatchDeferredError("identity-changed");
        if (job.mode !== "manual" && guard.mode === "off") throw new CatalogDispatchDeferredError("mode-off");
        const url = new URL(input instanceof Request ? input.url : String(input));
        const configuredHttp = url.protocol === "http:" && job.spec.authScope.kind === "connection-key" && new URL(job.spec.sourceUrl).origin === url.origin;
        if (url.protocol !== "https:" && !configuredHttp || url.username || url.password || url.hash ||
          [...url.searchParams.keys()].some(key => /key|token|secret|password|cookie|auth/iu.test(key)))
          throw new Error("目录请求来源不安全");
        if (queue.length >= (options.maxPending ?? 2048)) throw new CatalogDispatchDeferredError("budget");
        return new Promise<Response>((resolve, reject) => {
          const item: PendingRequest = { jobId, input, init, fetch: options.fetch, host: url.host, supplierId: job.supplierId,
            priority: job.mode === "manual" ? 0 : job.spec.role === "key-membership" ? 1 : 2,
            order: pendingOrder++, requestKey: createHash("sha256").update(`${(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()} ${url.href}`).digest("hex"),
            signal: combinedSignal ?? undefined, resolve, reject };
          const abort = () => { rejectQueued(item, new CatalogDispatchDeferredError("cancelled")); void pump(); };
          combinedSignal?.addEventListener("abort", abort, { once: true });
          item.removeAbort = () => combinedSignal?.removeEventListener("abort", abort);
          queue.push(item); coordinator.queue(item, { supplierId: job.supplierId, host: item.host, priority: item.priority, eligibleAt: job.nextAttemptEligibleAt }); void pump();
        });
      };
    },
    async complete(jobId: string, resultRef: string) {
      return options.store.mutate(state => ({ state: compactCatalogSchedulerState(finishCatalogReadJob(state, jobId, owner, clock.now(), { status: "completed", resultRef })), result: undefined }));
    },
    async fail(jobId: string, reason: CatalogSchedulerReason, resultRef?: string) {
      return options.store.mutate(state => ({ state: finishCatalogReadJob(state, jobId, owner, clock.now(), { status: "failed", reason, resultRef }), result: undefined }));
    },
    /** Call on mode/identity changes and lifecycle drain; never waits for cooldown. */
    async close(reason: "cancelled" | "mode-off" | "draining" = "draining") {
      if (closed) return;
      closed = true; clearTimer();
      unsubscribe();
      for (const item of [...queue]) rejectQueued(item, new CatalogDispatchDeferredError(reason));
      for (const [item, controller] of [...running]) { controller.abort(); item.reject(new CatalogDispatchDeferredError(reason)); release(item); }
      await options.store.mutate(state => {
        for (const job of Object.values(state.jobs)) if (job.status === "running" && job.lease?.owner === owner) {
          job.status = job.attemptConsumedAt === undefined ? "deferred" : "unknown"; job.reason = reason; delete job.lease;
        }
        return { state, result: undefined };
      });
      if (owners.get(options.store) === token) owners.delete(options.store);
    },
    /** Event-driven wake, not a polling loop. */
    wake() { void pump(); },
    diagnostics() { return { queued: queue.length, active: running.size, globalActive: coordinator.activeCount, activeHosts: [...activeHosts], timerScheduled: timer !== undefined }; },
  };
}
