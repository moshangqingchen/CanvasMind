type IdleDeadlineLike = { timeRemaining: () => number };
export type PanelIdleScheduler = {
  requestIdleCallback?: (callback: (deadline: IdleDeadlineLike) => void) => number;
  cancelIdleCallback?: (id: number) => void;
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (id: number) => void;
};

/** A module-only warmup: one in-flight/resolved promise, with no mounted UI. */
export function createPanelModulePreloader(load: () => Promise<unknown>): () => Promise<void> {
  let pending: Promise<void> | undefined;
  return () => {
    pending ??= Promise.resolve().then(load).then(
      () => {},
      () => { pending = undefined; },
    );
    return pending;
  };
}

/** Warm code in a real idle slot; navigation can cancel work before it starts. */
export function schedulePanelPreload(work: () => void | Promise<unknown>, scheduler?: PanelIdleScheduler): () => void {
  const host = scheduler ?? (typeof window === "undefined" ? undefined : window);
  if (!host) return () => {};
  let cancelled = false;
  let handle: number | undefined;
  const nativeIdle = Boolean(host.requestIdleCallback && host.cancelIdleCallback);
  const run = () => {
    handle = undefined;
    void Promise.resolve().then(() => {
      if (!cancelled) return work();
    }).catch(() => { /* Preloading is optional; normal panel loading still owns errors. */ });
  };
  const idle = (deadline: IdleDeadlineLike) => {
    handle = undefined;
    if (cancelled) return;
    if (deadline.timeRemaining() < 4) { queue(); return; }
    run();
  };
  const queue = () => {
    handle = nativeIdle ? host.requestIdleCallback?.(idle) : host.setTimeout(run, 250);
  };
  queue();
  return () => {
    cancelled = true;
    if (handle === undefined) return;
    if (nativeIdle) host.cancelIdleCallback?.(handle);
    else host.clearTimeout(handle);
    handle = undefined;
  };
}
