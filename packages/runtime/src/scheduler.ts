export interface RuntimeConcurrency {
  perRun: number;
  global: number;
  provider: number;
  connection: number;
}

function positiveLimit(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 64
    ? parsed
    : fallback;
}

export function runtimeConcurrency(
  options: Partial<RuntimeConcurrency> = {},
): RuntimeConcurrency {
  return {
    perRun: positiveLimit(
      options.perRun ?? process.env.RUNTIME_RUN_CONCURRENCY,
      2,
    ),
    global: positiveLimit(
      options.global ?? process.env.RUNTIME_GLOBAL_CONCURRENCY,
      4,
    ),
    provider: positiveLimit(
      options.provider ?? process.env.RUNTIME_PROVIDER_CONCURRENCY,
      2,
    ),
    connection: positiveLimit(
      options.connection ?? process.env.RUNTIME_CONNECTION_CONCURRENCY,
      2,
    ),
  };
}

interface ResourceKeys {
  provider?: string;
  connection?: string;
  connectionLimit?: number;
}

/** One admission queue reserves all resource dimensions together, avoiding nested-lock deadlocks. */
export class RuntimeScheduler {
  private active = 0;
  private readonly providers = new Map<string, number>();
  private readonly connections = new Map<string, number>();
  private readonly pending: Array<{
    keys: ResourceKeys;
    resolve: (release: () => void) => void;
  }> = [];
  private readonly runs = new Map<string, AbortController>();

  constructor(readonly limits: RuntimeConcurrency) {}

  /** Only one executor may own a run, including when two services share a repository. */
  beginRun(runId: string): { signal: AbortSignal; dispose: () => void } | null {
    if (this.runs.has(runId)) return null;
    const admission = new AbortController();
    this.runs.set(runId, admission);
    let disposed = false;
    return {
      signal: admission.signal,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (this.runs.get(runId) === admission) this.runs.delete(runId);
      },
    };
  }

  cancelRun(runId: string): void {
    this.runs.get(runId)?.abort();
  }

  private drain(): void {
    for (
      let index = 0;
      index < this.pending.length && this.active < this.limits.global;
    ) {
      const next = this.pending[index]!;
      const { provider, connection } = next.keys;
      if (
        (provider &&
          (this.providers.get(provider) ?? 0) >= this.limits.provider) ||
        (connection &&
          (this.connections.get(connection) ?? 0) >= (next.keys.connectionLimit ?? this.limits.connection))
      ) {
        index += 1;
        continue;
      }
      this.pending.splice(index, 1);
      this.active += 1;
      if (provider)
        this.providers.set(provider, (this.providers.get(provider) ?? 0) + 1);
      if (connection)
        this.connections.set(
          connection,
          (this.connections.get(connection) ?? 0) + 1,
        );
      let released = false;
      next.resolve(() => {
        if (released) return;
        released = true;
        this.active -= 1;
        for (const [map, key] of [
          [this.providers, provider],
          [this.connections, connection],
        ] as const) {
          if (!key) continue;
          const remaining = (map.get(key) ?? 1) - 1;
          if (remaining) map.set(key, remaining);
          else map.delete(key);
        }
        this.drain();
      });
    }
  }

  async withCapacity<T>(
    keys: ResourceKeys,
    execute: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const release = await new Promise<() => void>((resolve, reject) => {
      const request = {
        keys,
        resolve: (release: () => void) => {
          signal?.removeEventListener("abort", cancel);
          resolve(release);
        },
      };
      const cancel = () => {
        const index = this.pending.indexOf(request);
        if (index >= 0) this.pending.splice(index, 1);
        signal?.removeEventListener("abort", cancel);
        reject(signal?.reason);
        this.drain();
      };
      signal?.addEventListener("abort", cancel, { once: true });
      this.pending.push(request);
      this.drain();
    });
    try {
      signal?.throwIfAborted();
      return await execute();
    } finally {
      release();
    }
  }
}

const schedulers = new WeakMap<object, RuntimeScheduler>();

/** Services sharing the desktop repository must also share their admission limits. */
export function repositoryScheduler(
  repository: object,
  limits: RuntimeConcurrency,
): RuntimeScheduler {
  let scheduler = schedulers.get(repository);
  if (!scheduler) {
    scheduler = new RuntimeScheduler(limits);
    schedulers.set(repository, scheduler);
  }
  return scheduler;
}

/** Start a child immediately after its own dependencies settle, without a layer-wide barrier. */
export async function scheduleReadyNodes(
  nodeIds: readonly string[],
  dependencies: ReadonlyMap<string, readonly string[]>,
  concurrency: number,
  execute: (nodeId: string) => Promise<boolean>,
): Promise<boolean> {
  const pending = new Set(nodeIds);
  const active = new Set<Promise<void>>();
  const completed = new Set<string>();
  const selected = new Set(nodeIds);
  let stopped = false;
  let failure: unknown;
  let failed = false;
  while ((!stopped && pending.size > 0) || active.size > 0) {
    if (!stopped) {
      for (const nodeId of pending) {
        if (active.size >= concurrency) break;
        if (
          (dependencies.get(nodeId) ?? []).some(
            (id) => selected.has(id) && !completed.has(id),
          )
        )
          continue;
        pending.delete(nodeId);
        const operation = Promise.resolve()
          .then(() => (stopped ? false : execute(nodeId)))
          .then(
            (proceed) => {
              completed.add(nodeId);
              if (!proceed) stopped = true;
            },
            (error: unknown) => {
              if (!failed) failure = error;
              failed = true;
              stopped = true;
            },
          )
          .finally(() => {
            active.delete(operation);
          });
        active.add(operation);
      }
    }
    if (active.size === 0) {
      if (!stopped && pending.size > 0)
        throw new Error("Workflow dependencies could not be scheduled");
      break;
    }
    await Promise.race(active);
  }
  if (failed) throw failure;
  return !stopped;
}
