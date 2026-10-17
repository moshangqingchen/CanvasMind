export * from "./supplier-verification.js";
export * from "./types.js";
export * from "./supplier-state.js";
export * from "./memory.js";
export * from "./file.js";

import { MemoryRepository } from "./memory.js";
import { FileRepository } from "./file.js";
import type { Repository } from "./types.js";
import { join } from "node:path";
import type { AsyncLocalStorage } from "node:async_hooks";

const globalKey = "__superCanvasRepository";

export function getRepository(): Repository {
  // Automatic catalog reads use an async-local in-memory staging repository.
  // Native supplier adapters also call this factory directly; they must never
  // escape the same scope by reopening the live repository singleton.
  const staged = (globalThis as typeof globalThis & {
    __superCanvasCatalogRepositoryScope?: AsyncLocalStorage<Repository>;
  }).__superCanvasCatalogRepositoryScope?.getStore();
  if (staged) return staged;
  const globalScope = globalThis as typeof globalThis & {
    [globalKey]?: Repository;
  };
  if (globalScope[globalKey]) return globalScope[globalKey];
  const repository: Repository =
    process.env.USE_MEMORY_STORE === "ephemeral"
      ? new MemoryRepository()
      : new FileRepository(process.env.LOCAL_DATABASE_PATH ?? join(process.cwd(), "data", "super-canvas.json"));
  globalScope[globalKey] = repository;
  return repository;
}
