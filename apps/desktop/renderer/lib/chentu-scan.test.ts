import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProviderConnectionRecord } from "@super-canvas/db";
import { encryptSecret } from "@super-canvas/providers";
import { chentuCatalogFromPricing } from "./chentu-catalog";
import { scanChentuConnection } from "./chentu-server";
import { CHENTU_PRESET_ID } from "./chentu-presets";

vi.mock("./chentu-catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./chentu-catalog")>()),
  loadChentuCatalog: vi.fn(async () => chentuCatalogFromPricing({ data: [] })),
}));

const masterKey = "chentu-key-persistence-test";
let current: ProviderConnectionRecord;
const savedKey = () => current.encryptedSecret;
beforeEach(() => {
  vi.stubEnv("MASTER_KEY", masterKey);
  current = {
    id: "chentu-group",
    name: "辰途低价 Gemini",
    provider: "openai",
    encryptedSecret: encryptSecret("test-only-key", masterKey),
    config: {
      preset: CHENTU_PRESET_ID,
      supplierKey: "chentu",
      baseUrl: "https://tu.988236.xyz/v1",
      modelGroup: "低价gemni生图",
      usage: "canvas",
    },
    createdAt: "2026-09-10T00:00:00Z",
    updatedAt: "initial",
  };
  (globalThis as Record<string, unknown>).__superCanvasRepository = {
    getConnection: vi.fn(async () => current),
    saveConnection: vi.fn(async (input) => {
      current = { ...current, ...input, updatedAt: "saved" };
      return current;
    }),
  };
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).__superCanvasRepository;
  vi.unstubAllEnvs();
});

it.each(["canvas", "agent", "disabled"])(
  "keeps the saved key and %s usage after successful scans with no runnable protocol",
  async (usage) => {
    current.config.usage = usage;
    const encrypted = savedKey();
    const ids = [
      "unknown-gemini-image-a",
      "unknown-gemini-image-b",
      "unknown-gemini-image-c",
    ];
    const fetchImpl = vi.fn(async () =>
      Response.json({ data: ids.map((id) => ({ id })) }),
    ) as unknown as typeof fetch;
    // Repeated scans must not move the connection out of its selected UI slot.
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await scanChentuConnection(current.id, {
        fetch: fetchImpl,
      });
      expect(result.status).toBe("live");
      expect(result.canvasModels).toHaveLength(0);
      expect(current.config).toMatchObject({
        usage,
        modelGroup: "低价gemni生图",
        scannedModelIds: ids,
      });
      expect(current.config.disabledReason).toContain("3 个模型");
      expect(savedKey()).toBe(encrypted);
    }
  },
);

it("keeps an empty inventory in the saved canvas slot without retaining a stale connector", async () => {
  current.config.connector = { stale: true };
  const encrypted = savedKey();
  await scanChentuConnection(current.id, {
    fetch: vi.fn(async () =>
      Response.json({ data: [] }),
    ) as unknown as typeof fetch,
  });
  expect(current.config).toMatchObject({
    usage: "canvas",
    modelScanStatus: "empty",
    scannedModelIds: [],
  });
  expect(current.config.connector).toBeUndefined();
  expect(savedKey()).toBe(encrypted);
});

it("does not reactivate a manually disabled connection when image models are found", async () => {
  current.config.usage = "disabled";
  await scanChentuConnection(current.id, {
    fetch: vi.fn(async () =>
      Response.json({ data: [{ id: "gpt-image-2.5-flare" }] }),
    ) as unknown as typeof fetch,
  });
  expect(current.config.usage).toBe("disabled");
  expect(current.config.scannedModelIds).toEqual(["gpt-image-2.5-flare"]);
});

it("binds verified Gemini aliases to REST native transport while preserving the key and usage", async () => {
  const encrypted = savedKey();
  const id = "ad-gemini-3-pro-image-preview";
  await scanChentuConnection(current.id, {
    fetch: vi.fn(async () =>
      Response.json({ data: [{ id }] }),
    ) as unknown as typeof fetch,
  });
  expect(current.provider).toBe("rest");
  expect(current.config.usage).toBe("canvas");
  expect(current.config.disabledReason).toBeUndefined();
  expect(current.config.connector).toMatchObject({
    auth: { type: "header", headerName: "x-goog-api-key" },
    models: [{ id, metadata: { protocol: "gemini-generate-content" } }],
  });
  expect(savedKey()).toBe(encrypted);
});
