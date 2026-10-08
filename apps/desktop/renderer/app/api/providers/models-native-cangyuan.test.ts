import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";

const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, scan: vi.fn(), publicPricing: vi.fn(), genericPrices: vi.fn() }));
vi.mock("../../../lib/server", () => ({ get repository() { return mocks.repository; }, jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("../../../lib/master-key", () => ({ requireServerMasterKey: () => "synthetic-unit-master" }));
vi.mock("@super-canvas/providers", async original => ({ ...await original<typeof import("@super-canvas/providers")>(),
  decryptSecret: () => "synthetic-unit-key", fetchProviderJson: mocks.scan, providerFetch: mocks.publicPricing }));
vi.mock("../../../lib/supplier-model-pricing", async original => ({ ...await original<typeof import("../../../lib/supplier-model-pricing")>(), enrichSupplierModelPrices: mocks.genericPrices }));
vi.mock("../../../lib/agent-model-discovery", () => ({ discoverAgentModelCapabilities: async (_connection: unknown, models: readonly ModelDescriptor[]) => [...models] }));
import { GET } from "./[id]/models/route";

const id = "doubao-seedance-2-0-260128";
beforeEach(() => {
  mocks.repository = new MemoryRepository();
  mocks.scan.mockReset().mockResolvedValue({ data: [{ id }] });
  mocks.genericPrices.mockReset().mockImplementation(async (_connection: unknown, models: readonly ModelDescriptor[]) => models.map(model => ({ ...model,
    pricing: { kind: "per-request", currency: "CNY", unitAmount: 0, checkedAt: "generic", confidence: "snapshot" },
    metadata: { ...model.metadata, priceLabel: "¥0/次", priceSource: "supplier-catalog" } })));
  mocks.publicPricing.mockReset().mockImplementation(async () => Response.json({
    group_ratio: { "VIDEO-Seedance官转": 0.5, "全模型-无claude/gpt": 2 }, data: [{ model_name: id, tags: "video", request_unit: "request",
      enable_groups: ["VIDEO-Seedance官转", "全模型-无claude/gpt"], billing_mode: "tiered_expr",
      billing_expr: 'param("has_reference_video") ? tier("含参考视频", tok / 1e6 * 10) : tier("无参考视频", tok / 1e6 * 20)' }],
  }));
});

it("persists the exact native group's token quote after generic enrichment during explicit model refresh", async () => {
  const connection = await mocks.repository.saveConnection({ id: "native-cangyuan", provider: "openai", name: "Synthetic native group", encryptedSecret: "synthetic-encrypted",
    config: { supplierKey: "cangyuan", baseUrl: "https://ai.cangyuansuanli.cn", modelGroup: "VIDEO-Seedance官转", accountKeyGroup: "VIDEO-Seedance官转", customGroup: true, usage: "canvas" } });
  const response = await GET(new Request("http://localhost/api/providers/native-cangyuan/models?refresh=1"), { params: Promise.resolve({ id: connection.id }) });
  expect(response.status).toBe(200);
  const models: ModelDescriptor[] = await response.json();
  expect(models.map(model => model.id)).toEqual([id]);
  expect(models[0]?.pricing).toBeUndefined();
  expect(models[0]?.metadata).toMatchObject({ canvasRunnable: true, priceSource: "billing-expression", priceLabel: "含参考视频 ¥5/1M 视频 tokens · 无参考视频 ¥10/1M 视频 tokens" });
  expect(models[0]?.parameters?.find(parameter => parameter.key === "duration")).toMatchObject({ min: 4, max: 15, default: 4 });
  const saved = await mocks.repository.getConnection(connection.id);
  expect(saved?.provider).toBe("openai");
  expect(saved?.encryptedSecret).toBe(connection.encryptedSecret);
  expect(saved?.config.scannedModelIds).toEqual([id]);
  expect(saved?.config.modelCatalogModels).toEqual(models);
  expect(mocks.genericPrices).toHaveBeenCalled();
  expect(mocks.publicPricing.mock.calls.map(([url]) => url)).toEqual([
    "https://ai.cangyuansuanli.cn/", "https://ai.cangyuansuanli.cn/docs/api", "https://ai.cangyuansuanli.cn/api/pricing",
  ]);
  expect(mocks.scan).toHaveBeenCalledOnce();
});
