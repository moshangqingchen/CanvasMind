export * from "./schema.js";
export * from "./types.js";
export * from "./memory.js";
export * from "./file.js";
export * from "./postgres.js";

import { MemoryRepository } from "./memory.js";
import { FileRepository } from "./file.js";
import { PostgresRepository } from "./postgres.js";
import type { Repository } from "./types.js";
import { join } from "node:path";

const globalKey = "__superCanvasRepository";

export function getRepository(): Repository {
  const globalScope = globalThis as typeof globalThis & {
    [globalKey]?: Repository;
  };
  if (globalScope[globalKey]) return globalScope[globalKey];
  const useLocalStore = process.env.USE_MEMORY_STORE !== "false";
  const repository: Repository =
    process.env.USE_MEMORY_STORE === "ephemeral"
      ? new MemoryRepository()
      : useLocalStore || !process.env.DATABASE_URL
        ? new FileRepository(
            process.env.LOCAL_DATABASE_PATH ??
              join(process.cwd(), "data", "super-canvas.json"),
          )
        : new PostgresRepository(process.env.DATABASE_URL);
  globalScope[globalKey] = repository;
  return repository;
}
