export * from "./supplier-verification.js";
export * from "./types.js";
export * from "./supplier-state.js";
export * from "./memory.js";
export * from "./file.js";

import { MemoryRepository } from "./memory.js";
import { FileRepository } from "./file.js";
import type { Repository } from "./types.js";
import { join } from "node:path";

const globalKey = "__superCanvasRepository";

export function getRepository(): Repository {
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
