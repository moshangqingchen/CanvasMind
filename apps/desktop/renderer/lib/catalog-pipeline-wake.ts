import type { CatalogSchedulerClock } from "./catalog-scheduler-store";
import type { CatalogPipelineRunResult } from "./catalog-pipeline-service";

/** Backend-owned event timer. It neither holds a write lease nor polls per page. */
export function createCatalogPipelineWakeLoop(options: {
  clock: CatalogSchedulerClock;
  connectionIds(): Promise<string[]>;
  run(connectionId: string, cycleId: string): Promise<CatalogPipelineRunResult>;
  canContinue(): boolean;
  close(): void;
}) {
  let timer: unknown, running: Promise<void> | undefined, closed = false, rerun = false;
  const clear = () => { if (timer !== undefined) options.clock.clearTimeout(timer); timer = undefined; };
  const schedule = (at: number) => {
    clear();
    if (!closed && options.canContinue()) timer = options.clock.setTimeout(() => { timer = undefined; void wake(); },
      Math.min(2_147_483_647, Math.max(1500, at - options.clock.now())));
  };
  async function pump() {
    if (closed || !options.canContinue()) { clear(); return; }
    const ids = [...new Set(await options.connectionIds())];
    if (closed || !options.canContinue()) return;
    const cycleId = `daily:${new Date(options.clock.now()).toISOString().slice(0, 10)}`;
    const results: CatalogPipelineRunResult[] = [];
    let cursor = 0;
    // Limit repository contention as well as HTTP. The transport retains its
    // independent global two / one-per-host limits and fair dispatch policy.
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (!closed && options.canContinue() && cursor < ids.length) {
        const id = ids[cursor++]!;
        try { results.push(await options.run(id, cycleId)); }
        catch { results.push({ enabled: true, published: 0, pending: 0, superseded: 1, nextWakeAt: options.clock.now() + 60_000 }); }
      }
    }));
    // A source's persisted eligibility is still authoritative. The backend timer
    // only wakes the queue and cannot create a second attempt or confirmation.
    const times = results.flatMap(result => result?.nextWakeAt !== undefined ? [result.nextWakeAt] : []);
    schedule(times.length ? Math.min(...times) : options.clock.now() + 24 * 60 * 60_000);
  }
  function wake(): Promise<void> {
    if (closed) return Promise.resolve();
    if (running) { rerun = true; return running; }
    clear();
    const work = pump(); running = work;
    void work.finally(() => { running = undefined; if (rerun) { rerun = false; schedule(options.clock.now()); } }).catch(() => undefined);
    return work;
  }
  return { wake, close() { if (closed) return; closed = true; clear(); options.close(); }, diagnostics: () => ({ timerScheduled: timer !== undefined, running: Boolean(running) }) };
}
