import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type ProviderConnectionRecord } from "@super-canvas/db";
import { encryptSecret } from "@super-canvas/providers";
import { syncMikotoConnection } from "./mikoto-server";
import { MIKOTO_IMAGE_GROUP, mikotoConnectionConfig, mikotoGroup } from "./mikoto-presets";
import { scanCyberAfeiConnection } from "./cyberafei-server";
import { CYBERAFEI_BASE_URL, CYBERAFEI_PRESET_ID } from "./cyberafei-catalog";
import { loadCangyuanCatalog, syncCangyuanConnection } from "./cangyuan-catalog";
import { cangyuanImageConnectionConfig } from "./provider-presets";

const globals = globalThis as Record<string, unknown>;
const masterKey = "offline-default-preservation-master";
let repository: MemoryRepository;

beforeEach(() => {
  repository = new MemoryRepository();
  globals.__superCanvasRepository = repository;
  process.env.MASTER_KEY = masterKey;
  delete globals.__superCanvasCyberAfeiCatalog;
  delete globals.__superCanvasCangyuanCatalog;
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Real network forbidden"); }));
});
afterEach(() => {
  delete globals.__superCanvasRepository;
  delete globals.__superCanvasCyberAfeiCatalog;
  delete globals.__superCanvasCangyuanCatalog;
  delete process.env.MASTER_KEY;
  vi.unstubAllGlobals();
});

async function saveConnection(config: ProviderConnectionRecord["config"], provider = "rest") {
  return repository.saveConnection({ id: "owned-default-test", name: "User chosen name", provider,
    encryptedSecret: encryptSecret("offline-only-key", masterKey), config });
}
function expectIdentity(before: ProviderConnectionRecord, after: ProviderConnectionRecord | null) {
  expect(after).toMatchObject({ id: before.id, name: before.name, encryptedSecret: before.encryptedSecret, createdAt: before.createdAt });
}

describe("supplier refresh preserves saved default IDs independently of current availability", () => {
  it.each(["removed-user-model", " exact-user-model "])("Mikoto preset sync preserves %s and becomes idempotent", async defaultModel => {
    const before = await saveConnection({ ...mikotoConnectionConfig(MIKOTO_IMAGE_GROUP), defaultModel });
    const first = await syncMikotoConnection(before.id);
    expectIdentity(before, first);
    expect(first?.config.defaultModel).toBe(defaultModel);
    const save = vi.spyOn(repository, "saveConnection");
    expect(await syncMikotoConnection(before.id)).toEqual(first);
    expect(save).not.toHaveBeenCalled();
  });
  it("Mikoto selects the current group default only for an empty saved choice", async () => {
    const before = await saveConnection({ ...mikotoConnectionConfig(MIKOTO_IMAGE_GROUP), defaultModel: "" });
    const after = await syncMikotoConnection(before.id);
    expect(after?.config.defaultModel).toBe(mikotoGroup(MIKOTO_IMAGE_GROUP)?.defaultModel);
  });

  it.each(["removed-user-model", " exact-user-model ", ""])("Cangyuan live catalog sync handles original choice %s without replacing nonempty IDs", async defaultModel => {
    const upstream = vi.fn(async () => Response.json({ data: [{ model_name: "gpt-image-2", model_price: 0.017, request_unit: "image", enable_groups: ["IMAGE"] }] }));
    await loadCangyuanCatalog({ force: true, fetch: upstream });
    const before = await saveConnection({ ...cangyuanImageConnectionConfig("IMAGE"), defaultModel });
    const after = await syncCangyuanConnection(before.id);
    expectIdentity(before, after);
    expect(after?.config.defaultModel).toBe(defaultModel || "gpt-image-2");
    expect(upstream).toHaveBeenCalledTimes(3);
    const save = vi.spyOn(repository, "saveConnection");
    expect(await syncCangyuanConnection(before.id)).toEqual(after);
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    { usage: "canvas", ids: ["gpt-image-2"], defaultModel: "removed-user-model", expected: "removed-user-model" },
    { usage: "canvas", ids: ["gpt-image-2"], defaultModel: "", expected: "gpt-image-2" },
    { usage: "agent", ids: ["gpt-4o"], defaultModel: "removed-user-chat", expected: "removed-user-chat" },
    { usage: "agent", ids: ["gpt-4o"], defaultModel: "", expected: "gpt-4o" },
    { usage: "canvas", ids: [], defaultModel: "removed-user-model", expected: "removed-user-model" },
    { usage: "canvas", ids: [], defaultModel: "", expected: "" },
  ])("Cyber keyed persisted $usage/$ids refresh keeps the saved choice and authoritative inventory", async row => {
    const group = "图片视频模型综合分组";
    const before = await saveConnection({ preset: CYBERAFEI_PRESET_ID, supplierKey: "cyberafei", baseUrl: CYBERAFEI_BASE_URL,
      modelGroup: group, usage: row.usage, defaultModel: row.defaultModel });
    const upstream = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method ?? "GET").toBe("GET");
      if (String(url).endsWith("/v1/models")) return Response.json({ data: row.ids.map(id => ({ id })) });
      return Response.json({ group_ratio: { [group]: 1 }, usable_group: { [group]: group }, data: [
        { model_name: "gpt-image-2", quota_type: 1, model_price: 0.01, enable_groups: [group], supported_endpoint_types: ["image-generation"] },
        { model_name: "gpt-4o", quota_type: 0, model_ratio: 1, completion_ratio: 1, enable_groups: [group], supported_endpoint_types: ["openai"] },
      ] });
    });
    const scan = await scanCyberAfeiConnection(before.id, { fetch: upstream, forcePricing: true });
    expect(scan.status).toBe(row.ids.length ? "live" : "empty");
    expectIdentity(before, scan.connection);
    expect(scan.connection?.config.defaultModel).toBe(row.expected);
    expect(scan.connection?.config.scannedModelIds).toEqual(row.ids);
    if (!row.ids.length) expect(scan.connection?.config.usage).toBe("disabled");
    if (row.usage === "agent" && row.ids.length) expect(scan.connection?.config.allowedModels).toEqual(row.ids);
    expect(await repository.getConnection(before.id)).toEqual(scan.connection);
  });
  it("Cyber permission denial retains the original default and never persists a replacement", async () => {
    const before = await saveConnection({ preset: CYBERAFEI_PRESET_ID, supplierKey: "cyberafei", baseUrl: CYBERAFEI_BASE_URL,
      modelGroup: "图片视频模型综合分组", usage: "canvas", defaultModel: "my-unavailable-model" });
    const save = vi.spyOn(repository, "saveConnection");
    const upstream = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/v1/models")
      ? Response.json({ error: { message: "permission denied" } }, { status: 403 })
      : Response.json({ data: [] }));
    const scan = await scanCyberAfeiConnection(before.id, { fetch: upstream, forcePricing: true });
    expect(scan.status).toBe("unauthorized");
    expect(scan.connection).toEqual(before);
    expect(await repository.getConnection(before.id)).toEqual(before);
    expect(save).not.toHaveBeenCalled();
  });
});
