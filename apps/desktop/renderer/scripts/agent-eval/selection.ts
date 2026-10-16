import { MemoryRepository, type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import type { AgentModelOption } from "../../lib/agent-models";
import type { ResolvedDirectorConnection } from "@super-canvas/director";
import type { SelectionSnapshot } from "./fixture";
import { blockedOperation } from "./guard";
import { writeExclusiveJson } from "./budget";
import { validateSnapshot } from "./runner";

export interface ReadonlyConnectionSource {
  record: ProviderConnectionRecord;
  supplier?: SupplierRecord;
  masterKey: string;
  providerProxy?: string;
  modelId: string;
  capturedAt: string;
  selectionSource: string;
}

/** Uses the app's actual saved-directory/capability/protocol resolution in memory. */
export async function resolveIsolatedSelection(source: ReadonlyConnectionSource, runtimeDirectory: string): Promise<SelectionSnapshot> {
  vi.resetModules();
  const repository = new MemoryRepository();
  await repository.saveConnection(structuredClone(source.record));
  if (source.supplier) await repository.saveSupplier(structuredClone(source.supplier));
  vi.doMock(join(runtimeDirectory, "server.ts"), () => ({ repository }));
  vi.doUnmock(join(runtimeDirectory, "agent-models.ts"));
  vi.doUnmock("@super-canvas/providers");
  vi.stubGlobal("fetch", () => blockedOperation("network during selection resolution"));
  const previousMasterKey = process.env.MASTER_KEY;
  try {
    process.env.MASTER_KEY = source.masterKey;
    const models = await import(/* @vite-ignore */ join(runtimeDirectory, "agent-models.ts")) as {
      loadAgentModels: () => Promise<AgentModelOption[]>;
      resolveAgentModel: (id: string, model: string, effort: string) => Promise<ResolvedDirectorConnection>;
    };
    const option = (await models.loadAgentModels()).find(candidate =>
      candidate.connectionId === source.record.id && candidate.modelId === source.modelId);
    if (!option?.available) throw new Error("用户已选模型不在保存的可用目录，停止，不刷新、不替换");
    const connection = await models.resolveAgentModel(source.record.id, source.modelId, "auto");
    const snapshot: SelectionSnapshot = { schemaVersion: 1, selectedAt: source.capturedAt,
      selectionSource: source.selectionSource, connection, record: structuredClone(source.record), option,
      ...(source.providerProxy ? { providerProxy: source.providerProxy } : {}) };
    validateSnapshot(snapshot);
    return snapshot;
  } finally {
    if (previousMasterKey === undefined) delete process.env.MASTER_KEY; else process.env.MASTER_KEY = previousMasterKey;
  }
}

/** Only reads the isolated one-shot source file; original DB/DPAPI are never reopened. */
export async function finalizeSelectionSnapshot(directory: string, runtimeDirectory: string): Promise<SelectionSnapshot> {
  mkdirSync(directory, { recursive: true });
  const destination = join(directory, "selection.secret.json");
  if (existsSync(destination)) throw new Error("隔离模型快照已存在，禁止重新读取或覆盖");
  const source = JSON.parse(readFileSync(join(directory, "source.secret.json"), "utf8")) as ReadonlyConnectionSource;
  const snapshot = await resolveIsolatedSelection(source, runtimeDirectory);
  writeExclusiveJson(destination, snapshot);
  return snapshot;
}
