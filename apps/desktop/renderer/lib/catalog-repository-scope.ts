import { AsyncLocalStorage } from "node:async_hooks";
import type { Repository } from "@super-canvas/db";

const runtime = globalThis as typeof globalThis & { __superCanvasCatalogRepositoryScope?: AsyncLocalStorage<Repository> };
const scope = runtime.__superCanvasCatalogRepositoryScope ??= new AsyncLocalStorage<Repository>();

/** Existing scanners keep their repository API; automatic reads write only to
 * an isolated snapshot. Other requests retain the normal repository. */
export function scopedCatalogRepository(fallback: Repository): Repository {
  return new Proxy(fallback, {
    get(_target, property) {
      const target = scope.getStore() ?? fallback;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function withCatalogRepository<T>(repository: Repository, work: () => Promise<T>): Promise<T> {
  return scope.run(repository, work);
}
export function outsideCatalogRepository<T>(work: () => Promise<T>): Promise<T> {
  return scope.exit(work);
}
