import { vi } from "vitest";
import { join } from "node:path";
import type { MemoryRepository } from "@super-canvas/db";
import type { AgentEvent, AgentSession, AgentTurnInput, AgentTurnStatus } from "../../lib/agent-contracts";
import type { EvaluationSender } from "./transport";
import type { SelectionSnapshot } from "./fixture";
import { resolveSnapshotModel, SYNTHETIC_CATALOG } from "./fixture";
import { blockedOperation } from "./guard";

interface RuntimeModule {
  createAgentSession: (canvasId: string) => Promise<AgentSession>;
  getAgentSession: (id: string) => Promise<AgentSession>;
  runAgentTurn: (input: AgentTurnInput, emit: (event: AgentEvent) => void, signal?: AbortSignal) => Promise<AgentTurnStatus>;
}
export interface IsolatedRuntime extends RuntimeModule { setRepository: (repository: MemoryRepository) => void }

/**
 * Test-runner isolation is intentional: mocking server before import prevents its
 * eager run recovery/verification initialization and any FileRepository access.
 * Actual agent/model-call/adapter code remains unchanged, including repair/fallback.
 */
export async function loadIsolatedRuntime(options: {
  runtimeDirectory: string;
  snapshot: SelectionSnapshot;
  fetch: EvaluationSender;
}): Promise<IsolatedRuntime> {
  vi.resetModules();
  let repository: MemoryRepository | undefined;
  const serverPath = join(options.runtimeDirectory, "server.ts");
  const modelsPath = join(options.runtimeDirectory, "agent-models.ts");
  const catalogPath = join(options.runtimeDirectory, "agent-catalog.ts");
  vi.doMock(serverPath, () => ({
    get repository() { if (!repository) return blockedOperation("uninitialized repository"); return repository; },
    storage: new Proxy({}, { get: (_, name) => () => blockedOperation(`storage.${String(name)}`) }),
    runService: new Proxy({}, { get: (_, name) => name === "getRun" ? async () => undefined : () => blockedOperation(`runService.${String(name)}`) }),
    publicRunSnapshot: (value: unknown) => value,
  }));
  vi.doMock(modelsPath, () => ({
    loadAgentModels: async () => [structuredClone(options.snapshot.option)],
    resolveAgentModel: async (id: string, model: string, effort?: string) => resolveSnapshotModel(options.snapshot, id, model, effort),
  }));
  vi.doMock(catalogPath, () => ({ loadAgentCatalog: async () => structuredClone(SYNTHETIC_CATALOG) }));
  vi.doMock("@super-canvas/providers", async () => ({
    ...await vi.importActual<typeof import("@super-canvas/providers")>("@super-canvas/providers"),
    providerFetch: options.fetch,
  }));
  // Any unexpected direct fetch bypassing the adapter boundary is forbidden.
  vi.stubGlobal("fetch", () => blockedOperation("unmetered global fetch"));
  const agentRuntime = await import(/* @vite-ignore */ join(options.runtimeDirectory, "agent-service.ts")) as RuntimeModule;
  // Expose only chat/plan calls. No materialize/preflight/execute API is available.
  return { createAgentSession: agentRuntime.createAgentSession, getAgentSession: agentRuntime.getAgentSession,
    runAgentTurn: agentRuntime.runAgentTurn, setRepository: value => { repository = value; } };
}

/**
 * Reuse the app's existing npm-undici proxy/TUN transport. Its test shortcut
 * normally calls global fetch; select production transport synchronously only
 * for this already-metered call, then restore isolated-process env immediately.
 * No original server module or background runtime is imported during this scope.
 */
export async function originalProviderSender(proxy?: string): Promise<EvaluationSender> {
  const actual = await vi.importActual<typeof import("@super-canvas/providers")>("@super-canvas/providers");
  return (input, init) => {
    const oldNode = process.env.NODE_ENV;
    const oldVitest = process.env.VITEST;
    try {
      Reflect.set(process.env, "NODE_ENV", "production");
      process.env.VITEST = "false";
      return actual.fetchWithProviderHttpProxy(input, init, proxy);
    } finally {
      if (oldNode === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Reflect.set(process.env, "NODE_ENV", oldNode);
      if (oldVitest === undefined) delete process.env.VITEST; else process.env.VITEST = oldVitest;
    }
  };
}
