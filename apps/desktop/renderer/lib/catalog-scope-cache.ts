import type { Repository } from "@super-canvas/db";
import type { AsyncLocalStorage } from "node:async_hooks";

const runtime = globalThis as typeof globalThis & {
  __superCanvasCatalogRepositoryScope?: AsyncLocalStorage<Repository>;
  __superCanvasCatalogScopeCaches?: WeakMap<Repository, Map<string, unknown>>;
};
const scopedCaches = runtime.__superCanvasCatalogScopeCaches ??= new WeakMap<Repository, Map<string, unknown>>();

/** Automatic reads have disposable process caches. They never restore over, or
 * publish partial data into, a concurrent foreground price/document cache. */
export function catalogScopedValue<T>(key: string, create: () => T): T | undefined {
  const repository = runtime.__superCanvasCatalogRepositoryScope?.getStore();
  if (!repository) return undefined;
  let cache = scopedCaches.get(repository);
  if (!cache) { cache = new Map(); scopedCaches.set(repository, cache); }
  if (!cache.has(key)) cache.set(key, create());
  return cache.get(key) as T;
}
export function catalogScopedMap<K, V>(key: string): Map<K, V> {
  const foreground = new Map<K, V>();
  return new Proxy(foreground, {
    get(_target, property) {
      const target = catalogScopedValue(key, () => new Map<K, V>()) ?? foreground;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
export async function catalogScopeReadsComplete(repository: Repository): Promise<boolean> {
  const inspect = async (value: unknown): Promise<boolean> => {
    if (value instanceof Promise) return inspect(await value);
    if (!value || typeof value !== "object") return value !== undefined;
    if (value instanceof Map) {
      for (const entry of value.values()) if (!await inspect(entry)) return false;
      return true;
    }
    const row = value as Record<string, unknown>;
    if (row.complete === false || row.status === "failed" || row.status === "unauthorized") return false;
    if (row.snapshot && (row.snapshot as Record<string, unknown>).source !== "live") return false;
    if (row.result && !await inspect(row.result)) return false;
    if (row.text && !await inspect(row.text)) return false;
    return true;
  };
  try {
    for (const value of scopedCaches.get(repository)?.values() ?? []) if (!await inspect(value)) return false;
    return true;
  } catch { return false; }
}
