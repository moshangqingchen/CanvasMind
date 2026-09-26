import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JsonObject, ProviderConnectionRecord } from "@super-canvas/db";

const mocks = vi.hoisted(() => ({
  records: new Map<string, ProviderConnectionRecord>(),
  check: vi.fn(), describe: vi.fn(), save: vi.fn(),
}));
vi.mock("./server", () => ({
  repository: {
    getConnection: vi.fn(async (id: string) => structuredClone(mocks.records.get(id) ?? null)),
    saveConnection: mocks.save,
  },
  maskConnection: (value: unknown) => value,
  redactPublicText: (value: string) => value.replace(/token=\S+/gu, "token=[redacted]"),
  jsonError: (error: string, status = 400) => Response.json({ error }, { status }),
}));
vi.mock("@super-canvas/runtime", () => ({ getRunService: () => ({
  adapters: () => new Map([["cli", { checkConnection: mocks.check, describe: mocks.describe }]]),
}) }));

import { probeCliConnection, saveCliConnection } from "./cli-connections-server";

const cli = { version: 1, siteId: "jimeng", siteName: "即梦", accountLabel: "个人账号", executable: process.execPath,
  args: ["C:\\example\\bridge.mjs"], enabled: true, commandTimeoutMs: 30000, submitTimeoutMs: 60000, pollIntervalMs: 10000, taskTimeoutMs: 7200000 };
const model = { id: "demo-video", name: "模拟视频", operations: ["video.generate"], parameters: [] };

beforeEach(() => {
  vi.clearAllMocks(); mocks.records.clear();
  mocks.save.mockImplementation(async (record: Omit<ProviderConnectionRecord, "createdAt" | "updatedAt">) => {
    const saved = { ...structuredClone(record), createdAt: "2026-09-22", updatedAt: new Date().toISOString() };
    mocks.records.set(record.id, saved); return structuredClone(saved);
  });
  mocks.check.mockResolvedValue({ ready: true, supportsCancel: true });
  mocks.describe.mockResolvedValue({ models: [model], supportsCancel: true });
});

async function create(config: JsonObject = cli) {
  const response = await saveCliConnection({ name: "即梦 · 个人账号", config: { cli: config } });
  expect(response.status).toBe(201);
  return response.json();
}

describe("personal CLI connections", () => {
  it("saves a blank disabled draft without executing a program or trusting browser catalogs", async () => {
    const response = await saveCliConnection({ name: "即梦待接入", config: {
      cli: { ...cli, executable: "", args: [], enabled: false },
      cliStatus: { state: "ready" }, modelCatalogModels: [model],
      __runtimeConnection: { executable: "untrusted" },
    } });
    expect(response.status).toBe(201);
    const saved = await response.json();
    expect(saved.config.cliStatus.state).toBe("unconfigured");
    expect(saved.config.modelCatalogModels).toEqual([]);
    expect(saved.config.__runtimeConnection).toBeUndefined();
    expect(saved.encryptedSecret).toBeNull();
    expect(mocks.check).not.toHaveBeenCalled(); expect(mocks.describe).not.toHaveBeenCalled();
  });

  it("persists actual describe results, and preserves them across a display-name edit", async () => {
    const created = await create();
    const response = await probeCliConnection(created.id, "describe");
    expect(response.status).toBe(200);
    const { connection } = await response.json();
    expect(connection.config.cliStatus).toMatchObject({ state: "ready", supportsCancel: true });
    expect(connection.config.modelCatalogModels).toEqual([model]);
    const renamed = await saveCliConnection({ id: created.id, name: "新名字", config: { cli, modelCatalogModels: [] } });
    expect((await renamed.json()).config.modelCatalogModels).toEqual([model]);
  });

  it("invalidates authentication and capabilities when the program or account changes", async () => {
    const created = await create(); await probeCliConnection(created.id, "describe");
    const changed = await saveCliConnection({ id: created.id, name: "即梦", config: { cli: { ...cli, accountLabel: "另一个账号" }, cliStatus: { state: "ready" } } });
    const saved = await changed.json();
    expect(saved.config.cliStatus.state).toBe("unconfigured");
    expect(saved.config.modelCatalogModels).toEqual([]);
  });

  it("marks login expiry without calling describe or erasing the saved catalog", async () => {
    const created = await create(); await probeCliConnection(created.id, "describe");
    mocks.describe.mockClear();
    mocks.check.mockResolvedValue({ ready: false, loginRequired: true, supportsCancel: false });
    const response = await probeCliConnection(created.id, "describe");
    const saved = (await response.json()).connection;
    expect(saved.config.cliStatus.state).toBe("login_required");
    expect(saved.config.modelCatalogModels).toEqual([model]);
    expect(mocks.describe).not.toHaveBeenCalled();
  });

  it("drops late probe results after a connection edit", async () => {
    const created = await create();
    let release!: (value: unknown) => void;
    mocks.describe.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = probeCliConnection(created.id, "describe");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await saveCliConnection({ id: created.id, name: "changed", config: { cli: { ...cli, args: ["different.mjs"] } } });
    release({ models: [model], supportsCancel: true });
    expect((await pending).status).toBe(409);
    expect(mocks.records.get(created.id)!.config.modelCatalogModels).toEqual([]);
  });

  it("marks login expiry during describe after a successful check", async () => {
    const created = await create();
    mocks.describe.mockRejectedValue(Object.assign(new Error("请重新登录"), { code: "LOGIN_REQUIRED" }));
    const response = await probeCliConnection(created.id, "describe");
    expect(response.status).toBe(401);
    expect((await response.json()).connection.config.cliStatus.state).toBe("login_required");
  });

  it("redacts diagnostics and marks a failed probe without deleting saved configuration", async () => {
    const created = await create(); mocks.check.mockRejectedValue(new Error("failure token=private-value"));
    const response = await probeCliConnection(created.id, "test");
    expect(response.status).toBe(502);
    const result = await response.json();
    expect(result.error).not.toContain("private-value");
    expect(result.connection.config.cliStatus.state).toBe("error");
    expect(result.connection.config.cli.executable).toBe(process.execPath);
  });

  it("does not repurpose an API connection or accept a key for a CLI", async () => {
    mocks.records.set("old", { id: "old", name: "old", provider: "rest", config: {}, encryptedSecret: "ciphertext", createdAt: "2026-09-22", updatedAt: "2026-09-22" });
    expect((await saveCliConnection({ id: "old", name: "bad", config: { cli } })).status).toBe(409);
    expect((await saveCliConnection({ name: "bad", apiKey: "secret", config: { cli } })).status).toBe(400);
  });
});
