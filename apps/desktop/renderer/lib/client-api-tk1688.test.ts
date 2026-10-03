import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderConnectionRequestSchema } from "./api-validation";
import { tk1688ConnectionWriteConfig } from "./tk1688-connection-write";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("词元商家目录的连接设置保存", () => {
  it("keeps a large merchant inventory on the server while saving editable settings", async () => {
    const config = { supplierId: "supplier", supplierSourceId: "source", supplierKey: "custom-tk1688",
      baseUrl: "https://api.tk1688.com/v1", modelGroup: "default", usage: "canvas", protocol: "openai-images",
      defaultModel: "gpt-image-2.5-sunburst@s47c261", modelScanStatus: "live", scannedModelIds: ["gpt-image-2.5-sunburst@s47c261"],
      modelCatalogModels: Array.from({ length: 500 }, (_, index) => ({ id: `model-${index}`, name: `model-${index}`,
        operations: ["image.generate"], metadata: Object.fromEntries(Array.from({ length: 25 }, (_, field) => [`fact-${field}`, field])) })),
      modelScanGroups: { all: [] }, autoModelInterfaces: { all: {} }, manualModels: [{ id: "custom", capability: "image" }],
      accountKeyGroup: "default" };
    const input = { id: "connection", name: "词元", provider: "openai", config };
    expect(ProviderConnectionRequestSchema.safeParse(input).success).toBe(false);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: input.id, config, apiKeySet: true }));
    vi.stubGlobal("fetch", fetcher);
    const { saveConnection } = await import("./client-api");
    await saveConnection(input);
    const posted = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(ProviderConnectionRequestSchema.safeParse(posted).success).toBe(true);
    expect(posted.config).toMatchObject({ defaultModel: input.config.defaultModel, supplierSourceId: "source",
      accountKeyGroup: "default", scannedModelIds: input.config.scannedModelIds, manualModels: input.config.manualModels });
    expect(posted.config).not.toHaveProperty("modelCatalogModels");
    expect(posted.config).not.toHaveProperty("autoModelInterfaces");
    expect(input.config.modelCatalogModels).toHaveLength(500);
  });

  it("keeps other suppliers, new connections and manual connector definitions unchanged", () => {
    const config = { supplierId: "supplier", baseUrl: "https://api.mikoto.vip", modelCatalogModels: ["saved"],
      connector: { models: ["manual"] }, manualModels: ["manual"] };
    expect(tk1688ConnectionWriteConfig("existing", config)).toBe(config);
    expect(tk1688ConnectionWriteConfig(undefined, { ...config, baseUrl: "https://api.tk1688.com/v1" }).modelCatalogModels).toEqual(["saved"]);
    const scoped = tk1688ConnectionWriteConfig("existing", { ...config, baseUrl: "https://api.tk1688.com/v1" });
    expect(scoped.connector).toEqual(config.connector);
    expect(scoped.manualModels).toEqual(config.manualModels);
  });
});
