import { describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import { parseTk1688Marketplace } from "@super-canvas/providers";

const state = vi.hoisted(() => ({ repository: null as unknown as MemoryRepository }));
vi.mock("./server", () => ({ get repository() { return state.repository; } }));
import { loadAgentModels, resolveAgentModel } from "./agent-models";

describe("Tk1688 agent model display facts", () => {
  it("returns the merchant description and token price without granting a catalog alias to a Key", async () => {
    state.repository = new MemoryRepository();
    const base = "gpt-6-sol";
    const alias = `${base}@s47c261`;
    const descriptors = parseTk1688Marketplace({ success: true, data: { total: 1, items: [{
      id: 47, base_model: base, alias, supplier_id: 47, channel_no: "ID00261", charge_type: "per_token",
      input_price_usd: 0.9, output_price_usd: 5, description: "商家文本服务说明",
      status: "active", channel_alive: true, modalities: ["text"],
    }] } }, { success: true, data: {} }, {
      checkedAt: "2026-10-04T00:00:00.000Z", keyModelIds: [base], accountModelIds: [alias],
    }).models;
    await state.repository.saveConnection({ id: "tk-key", name: "词元", provider: "openai", encryptedSecret: "fixture",
      config: { baseUrl: "https://api.tk1688.com/v1", supplierKey: "tk1688", modelScanStatus: "live",
        scannedModelIds: [base], modelCatalogModels: descriptors } });
    const models = await loadAgentModels();
    expect(models.find(model => model.modelId === base)).toMatchObject({ available: true, supplierKey: "tk1688",
      metadata: { tk1688Routing: "smart" } });
    expect(models.find(model => model.modelId === alias)).toMatchObject({ available: false, supplierKey: "tk1688",
      description: "商家文本服务说明", metadata: { tk1688BaseModel: base, tk1688Routing: "merchant" },
      pricing: { kind: "token", currency: "USD", inputPerMillion: 0.9, outputPerMillion: 5 } });
    await expect(resolveAgentModel("tk-key", alias)).rejects.toThrow("当前 Key 未返回此模型");
  });
});
