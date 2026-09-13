import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
const mocks = vi.hoisted(() => ({
  repository: undefined as unknown as MemoryRepository,
  fetch: vi.fn(),
  syncCangyuan: vi.fn(),
}));
vi.mock("../../../lib/cangyuan-catalog", async (original) => ({
  ...(await original<typeof import("../../../lib/cangyuan-catalog")>()),
  syncCangyuanConnection: mocks.syncCangyuan,
}));
vi.mock("../../../lib/server", () => ({
  get repository() {
    return mocks.repository;
  },
  jsonError: (error: string, status: number) =>
    Response.json({ error }, { status }),
}));
vi.mock("@super-canvas/providers", async (original) => ({
  ...(await original<typeof import("@super-canvas/providers")>()),
  providerFetch: mocks.fetch,
}));
import { encryptSecret } from "@super-canvas/providers";
import {
  createSupplierRecord,
  patchSupplierRecord,
} from "../../../lib/supplier-service";
import { GET } from "./[id]/models/route";
import {
  mikotoConnectorForGroup,
  MIKOTO_IMAGE_GROUP,
} from "../../../lib/mikoto-presets";
const refresh = (id: string, enabled = true) =>
  GET(
    new Request(
      `http://localhost/api/providers/${id}/models${enabled ? "?refresh=1" : ""}`,
    ),
    { params: Promise.resolve({ id }) },
  );
beforeEach(() => {
  mocks.repository = new MemoryRepository();
  mocks.fetch.mockReset();
  mocks.syncCangyuan.mockReset();
  process.env.MASTER_KEY = "isolated-test-master";
});
async function fixture(supplierKey?: string) {
  const supplier = await createSupplierRecord({
    name: "Instance",
    supplierKey,
    siteUrl: "https://instance.example.com/prefix",
    apiUrl: "https://instance.example.com/prefix/v1",
  });
  const connection = await mocks.repository.saveConnection({
    id: "group",
    name: "Group",
    provider: "openai",
    encryptedSecret: encryptSecret("mock-key", "isolated-test-master"),
    config: {
      supplierId: supplier.id,
      supplierSourceId: supplier.state!.sourceId,
      supplierKey: supplier.supplierKey,
      baseUrl: supplier.apiUrl,
      modelGroup: "same-name",
      customGroup: true,
      manualModels: [
        { id: "manual-only", capability: "image", protocol: "openai-images" },
      ],
    },
  });
  return { supplier, connection };
}
describe("model refresh source boundary", () => {
  it("uses freshly synchronized Cangyuan transport instead of an unavailable cached catalog entry", async () => {
    const model = {id: "happyhorse-1.1", name: "HappyHorse", operations: ["video.generate"], outputKinds: ["video"], metadata: {priceLabel: "¥2.8/次"}};
    const connector = {submit: {path: "/v1/videos", mappings: [{target: "/model", source: {kind: "request", path: "$.model"}}]}, output: {path: "$.url", kind: "video"}, models: [model]};
    await mocks.repository.saveConnection({id: "cangyuan-fresh", name: "Cangyuan", provider: "rest", encryptedSecret: encryptSecret("mock-key", "isolated-test-master"), config: {
      supplierKey: "cangyuan", preset: "cangyuan-gpt-image-2", baseUrl: "https://ai.cangyuansuanli.cn", modelGroup: "全模型-无claude/gpt", usage: "canvas",
      modelCatalogModels: [{...model, operations: [], metadata: {canvasRunnable: false, canvasUnavailableReason: "此模型已扫描到，但生成协议尚未验证"}}],
      connector: {...connector, models: []},
    }});
    mocks.fetch.mockResolvedValue(Response.json({data: [{id: model.id}]}));
    mocks.syncCangyuan.mockImplementation(async (id: string) => {
      const previous = (await mocks.repository.getConnection(id))!;
      return mocks.repository.saveConnection({...previous, config: {...previous.config, connector}});
    });
    const result = await refresh("cangyuan-fresh");
    expect(result.status).toBe(200);
    const models = await result.json();
    expect(models).toHaveLength(1);
    expect(models[0].operations).toEqual(["video.generate"]);
    expect(models[0].metadata.canvasRunnable).not.toBe(false);
    expect(models[0].metadata.canvasUnavailableReason).toBeUndefined();
  });
  it("automatically prices a newly scanned model from its own group's marketplace", async () => {
    await fixture();
    mocks.fetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/api/pricing")) {
        expect(new Headers(init?.headers).get("authorization")).toBeNull();
        return Response.json({ group_ratio: { "same-name": 0.5 }, data: [
          { model_name: "future-image-v99", quota_type: 1, model_price: 0.08, request_unit: "image", enable_groups: ["same-name"] },
          { model_name: "not-in-key", quota_type: 1, model_price: 0.01, enable_groups: ["same-name"] },
        ] });
      }
      if (String(url).endsWith("/api/status")) return Response.json({ data: { quota_display_type: "CNY", usd_exchange_rate: 1 } });
      return Response.json({ data: [{ id: "future-image-v99" }] });
    });
    const response = await refresh("group");
    expect(response.status).toBe(200);
    const models = await response.json();
    expect(models.map((m: { id: string }) => m.id)).toEqual(["future-image-v99"]);
    expect(models[0].metadata).toMatchObject({ priceLabel: "¥0.04/张", priceSource: "supplier-catalog" });
    const saved = await mocks.repository.getConnection("group");
    expect((saved?.config.modelCatalogModels as Array<{ metadata: { priceLabel: string } }>)[0]?.metadata.priceLabel).toBe("¥0.04/张");
  });

  it("repairs old Chentu protocol decisions in cached keyed models without rescanning or widening inventory", async () => {
    const cached = ["gpt-image-2-low", "gpt-image-2.5"].map((id) => ({
      id,
      name: `${id} · ￥ 0.0154 / 请求`,
      operations: ["image.generate", "image.edit"],
      metadata: {
        canvasRunnable: false,
        canvasUnavailableReason: "尚无已验证的画布生成协议",
        priceLabel: "￥ 0.0154 / 请求",
      },
    }));
    const denied = {
      ...cached[0]!,
      id: "gpt-image-denied",
      metadata: {
        canvasRunnable: false,
        canvasUnavailableReason: "403 权限拒绝",
      },
    };
    await mocks.repository.saveConnection({
      id: "chentu-cached",
      provider: "openai",
      name: "Chentu",
      encryptedSecret: encryptSecret("mock-key", "isolated-test-master"),
      config: {
        supplierKey: "chentu",
        baseUrl: "https://tu.988236.xyz/v1",
        modelGroup: "1k低价生图",
        usage: "canvas",
        modelScanStatus: "live",
        scannedModelIds: [...cached.map((model) => model.id), denied.id],
        modelCatalogModels: [...cached, denied],
      },
    });
    const result = await refresh("chentu-cached", false);
    expect(result.status).toBe(200);
    const models = await result.json();
    expect(models.map((model: { id: string }) => model.id)).toEqual([
      ...cached.map((model) => model.id),
      denied.id,
    ]);
    expect(
      models
        .slice(0, 2)
        .every(
          (model: { metadata: { canvasRunnable: boolean } }) =>
            model.metadata.canvasRunnable,
        ),
    ).toBe(true);
    expect(models[0].metadata.priceLabel).toBe("￥ 0.0154 / 请求");
    expect(models[0].metadata.canvasUnavailableReason).toBeUndefined();
    expect(models[2].metadata.canvasRunnable).toBe(false);
    expect(
      (await mocks.repository.getConnection("chentu-cached"))?.config
        .modelCatalogModels,
    ).toEqual(models);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(await (await refresh("chentu-cached", false)).json()).toEqual(
      models,
    );
  });
  it("persists refreshed REST models into the runnable connector and restores them after an empty scan", async () => {
    const { connection } = await fixture();
    const connector = mikotoConnectorForGroup(MIKOTO_IMAGE_GROUP);
    await mocks.repository.saveConnection({
      ...connection,
      provider: "rest",
      config: {
        ...connection.config,
        connector: { ...connector, allowedHosts: ["instance.example.com"] },
      },
    });
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ data: [{ id: "gpt-image-2.5-flare" }] }),
    );
    const result = await refresh(connection.id);
    expect(result.status).toBe(200);
    expect((await result.json())[0].metadata.canvasRunnable).toBe(true);
    const saved = await mocks.repository.getConnection(connection.id);
    expect(saved?.config.defaultModel).toBe("gpt-image-2.5-flare");
    expect(saved?.config.connector).toMatchObject({
      models: [{ id: "gpt-image-2.5-flare" }],
    });
    expect(
      (await (await refresh(connection.id, false)).json())[0].metadata
        .canvasRunnable,
    ).toBe(true);
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: [] }));
    expect(await (await refresh(connection.id)).json()).toEqual([]);
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ data: [{ id: "gpt-image-2.6" }] }),
    );
    expect(
      (await (await refresh(connection.id)).json())[0].metadata.canvasRunnable,
    ).toBe(true);
    expect(
      (await mocks.repository.getConnection(connection.id))?.config.connector,
    ).toMatchObject({ models: [{ id: "gpt-image-2.6" }] });
  });
  it("replaces disappeared models and returns an authoritative empty list despite manual entries", async () => {
    const { connection } = await fixture();
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ data: [{ id: "gpt-image-2" }, { id: "gone" }] }),
    );
    expect((await refresh(connection.id)).status).toBe(200);
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ data: [{ id: "gpt-image-2" }] }),
    );
    const updated = await refresh(connection.id);
    expect((await updated.json()).map((m: { id: string }) => m.id)).toEqual([
      "gpt-image-2",
    ]);
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: [] }));
    expect(await (await refresh(connection.id)).json()).toEqual([]);
    expect(await (await refresh(connection.id, false)).json()).toEqual([]);
    expect(
      (await mocks.repository.getConnection(connection.id))?.config
        .manualModels,
    ).toHaveLength(1);
  });
  it("keeps a same-source cache after network failure but never after explicit authorization denial", async () => {
    const { connection } = await fixture();
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ data: [{ id: "gpt-image-2" }] }),
    );
    await refresh(connection.id);
    mocks.fetch.mockRejectedValue(new Error("offline"));
    const stale = await refresh(connection.id);
    expect(stale.headers.get("X-Model-Scan-Status")).toBe("stale");
    expect((await stale.json()).map((m: { id: string }) => m.id)).toEqual([
      "gpt-image-2",
    ]);
    expect(
      (await (await refresh(connection.id, false)).json()).map(
        (m: { id: string }) => m.id,
      ),
    ).toEqual(["gpt-image-2"]);
    mocks.fetch.mockResolvedValue(Response.json({}, { status: 401 }));
    expect((await refresh(connection.id)).status).toBe(401);
    expect((await refresh(connection.id, false)).status).toBe(401);
    expect(
      (await mocks.repository.getConnection(connection.id))?.config
        .modelScanStatus,
    ).toBe("unauthorized");
  });
  it.each(["empty", "unauthorized"])(
    "a later network failure cannot undo %s availability",
    async (status) => {
      const { connection } = await fixture();
      mocks.fetch.mockResolvedValueOnce(
        status === "empty"
          ? Response.json({ data: [] })
          : Response.json({}, { status: 401 }),
      );
      await refresh(connection.id);
      mocks.fetch.mockRejectedValue(new Error("offline"));
      await refresh(connection.id);
      expect(
        (await mocks.repository.getConnection(connection.id))?.config
          .modelScanStatus,
      ).toBe(status);
      const cached = await refresh(connection.id, false);
      if (status === "empty") expect(await cached.json()).toEqual([]);
      else expect(cached.status).toBe(401);
    },
  );
  it("discards slower refreshes even if the old result contains more models", async () => {
    const { connection } = await fixture();
    let finish!: (r: Response) => void;
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const old = refresh(connection.id);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: [{ id: "new" }] }));
    await refresh(connection.id);
    finish(Response.json({ data: [{ id: "old" }] }));
    expect((await old).status).toBe(409);
    expect(
      (await mocks.repository.getConnection(connection.id))?.config
        .scannedModelIds,
    ).toEqual(["new"]);
  });
  it("cannot write an old key scan into an archived source or transfer its key", async () => {
    const { supplier, connection } = await fixture();
    let finish!: (r: Response) => void;
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const old = refresh(connection.id);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await patchSupplierRecord(supplier.id, {
      apiUrl: "https://new.example.com/v1",
    });
    finish(Response.json({ data: [{ id: "old" }] }));
    expect((await old).status).toBe(409);
    expect(
      (await mocks.repository.getConnection(connection.id))?.config
        .modelCatalogModels,
    ).toBeUndefined();
    expect((await refresh(connection.id)).status).toBe(409);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(String(mocks.fetch.mock.calls[0]![0])).toContain(
      "instance.example.com/prefix",
    );
  });
  it.each([
    ["chentu", "chentu-openai-images"],
    ["cyberafei", "cyberafei-api"],
    ["mikoto", "mikoto-pro"],
    ["miaowu", "miaowu-openai-videos"],
    ["frimodel", "frimodel-openai-images"],
    ["cangyuan", "cangyuan-gpt-image-2"],
    ["weai", ""],
  ])(
    "%s at another instance queries its configured gateway without template models",
    async (key, preset) => {
      const { connection } = await fixture(key);
      await mocks.repository.saveConnection({
        ...connection,
        config: {
          ...connection.config,
          preset,
          customGroup: false,
        },
      });
      mocks.fetch.mockResolvedValue(
        Response.json({ data: [{ id: "instance-only" }] }),
      );
      const result = await refresh(connection.id);
      expect(result.status).toBe(200);
      expect((await result.json()).map((m: { id: string }) => m.id)).toEqual([
        "instance-only",
      ]);
      expect(
        mocks.fetch.mock.calls.every((call) =>
          String(call[0]).startsWith("https://instance.example.com/prefix/"),
        ),
      ).toBe(true);
      expect(
        (await mocks.repository.getConnection(connection.id))?.config.baseUrl,
      ).toBe(connection.config.baseUrl);
    },
  );
});
