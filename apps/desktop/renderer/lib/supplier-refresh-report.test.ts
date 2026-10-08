import { describe, expect, it } from "vitest";
import type { ProviderConnectionView } from "./client-api";
import type { SupplierRecord } from "./client-suppliers";
import type { ModelDescriptor } from "@super-canvas/providers";
import { buildSupplierRefreshResult, safeRefreshMessage, supplierRefreshStatus } from "./supplier-refresh-report";

const group = (id: string, label = id) => ({ id, label, source: "catalog" as const, models: [] });
const supplier = (patch: Partial<SupplierRecord> = {}): SupplierRecord => ({
  id: "supplier", name: "测试供应商", supplierKey: "custom", siteUrl: "https://example.invalid", apiUrl: "https://example.invalid/v1", kind: "newapi",
  catalog: { groups: [group("vip")] }, scanStatus: "live", scannedAt: "before", scanComplete: true,
  createdAt: "before", updatedAt: "before", ...patch,
});
const model = (id: string, price = 1, path = "/v1/images/generations"): ModelDescriptor => ({
  id, name: id, operations: ["image.generate"], metadata: { protocol: "openai-images", autoInterfacePath: path },
  pricing: { kind: "per-image", currency: "CNY", unitAmount: price, confidence: "exact", checkedAt: "before" },
});
const connection = (items: ModelDescriptor[], patch: Record<string, unknown> = {}): ProviderConnectionView => ({
  id: "connection", name: "创作组", provider: "openai", apiKey: "", apiKeySet: true,
  config: { supplierId: "supplier", modelGroup: "vip", modelCatalogModels: items as never, modelScanStatus: "live", modelScanCheckedAt: "before", ...patch } as ProviderConnectionView["config"],
});
describe("supplier refresh evidence", () => {
  it("reports newly imported conditional token rates without claiming an unknown price or task total", () => {
    const old: ModelDescriptor = { id: "doubao-seedance-2-0-260128", name: "Seedance", operations: ["video.generate"], metadata: { priceLabel: "价格未公布" } };
    const current: ModelDescriptor = { ...old, pricing: { kind: "token", currency: "CNY", confidence: "exact", checkedAt: "after",
      sourceUrl: "https://token.secure-skill.com/api/v1/pricing/channels", tiers: [
        { id: "output_price", label: "720p · 不含参考视频", price: 29, conditions: [
          { parameter: "token_kind", operator: "equals", value: "output" }, { parameter: "resolution", operator: "equals", value: "720p" }, { parameter: "has_reference_video", operator: "equals", value: "false" }] },
        { id: "reference_video_output_price", label: "720p · 含参考视频", price: 18.2, conditions: [
          { parameter: "token_kind", operator: "equals", value: "output" }, { parameter: "resolution", operator: "equals", value: "720p" }, { parameter: "has_reference_video", operator: "equals", value: "true" }] },
      ] }, parameters: [{ key: "resolution", label: "分辨率", control: "select", default: "720p" }] };
    const report = buildSupplierRefreshResult(supplier(), supplier({ scannedAt: "after" }), [connection([old])], [connection([current], { modelScanCheckedAt: "after" })]);
    expect(report.connections![0]!.priceChanges[0]!.after).toBe("720p · 输出 ¥18.2–29/1M tokens（参考视频条件未确认）");
    expect(report.connections![0]!.priceChanges[0]!.after).not.toContain("待确认");
    expect(report.connections![0]!.priceChanges[0]!.before).toBe("暂未取得报价");
  });
  it("reports this attempt's removals without counting cumulative removed history", () => {
    const before = connection([model("keep"), model("just-removed")]);
    const after = connection([model("keep"), model("new")], { modelScanCheckedAt: "after", modelRemovedModels: [{ id: "ancient", name: "旧历史" }, { id: "just-removed", name: "just-removed" }] });
    const report = buildSupplierRefreshResult(supplier(), supplier({ scannedAt: "after" }), [before], [after]);
    expect(report.status).toBe("updated");
    expect(report.connections![0]!.modelAddedIds).toEqual(["new"]);
    expect(report.connections![0]!.modelRemovedModels.map(item => item.id)).toEqual(["just-removed"]);
    expect(report.message).toContain("未再返回 1");
    expect(JSON.stringify(report)).not.toContain("ancient");
  });
  it("ignores stale successful inventories and failed attempts when computing changes", () => {
    const before = connection([model("old")]);
    const cached = connection([model("old")], { modelAddedIds: ["cached-addition"], modelRemovedModels: [{ id: "cached-removal", name: "old" }] });
    const report = buildSupplierRefreshResult(supplier(), supplier({ scannedAt: "after" }), [before], [cached]);
    expect(report.connections![0]!.status).toBe("unconfirmed");
    expect(report.connections![0]!.modelAddedIds).toEqual([]);
    const failed = connection([], { modelScanCheckedAt: "after", modelScanStatus: "empty", modelScanAttemptStatus: "failed", modelScanError: "模型接口暂不可用（HTTP 502）" });
    const failure = buildSupplierRefreshResult(supplier(), supplier({ scannedAt: "after" }), [before], [failed]);
    expect(failure.connections![0]!.status).toBe("failed");
    expect(failure.connections![0]!.message).toContain("502");
    expect(failure.connections![0]!.modelRemovedModels).toEqual([]);
  });
  it("requires an explicitly complete directory before reporting missing groups", () => {
    const before = supplier({ catalog: { groups: [group("old"), group("vip", "旧名称")] } });
    const after = supplier({ scannedAt: "after", scanComplete: false, catalog: { groups: [group("new"), group("vip", "新名称")] } });
    const partial = buildSupplierRefreshResult(before, after, [], []);
    expect(partial.groupChanges!.added).toEqual([{ id: "new", label: "new" }]);
    expect(partial.groupChanges!.missing).toEqual([]);
    expect(partial.groupChanges!.renamed).toEqual([{ id: "vip", before: "旧名称", after: "新名称" }]);
    const complete = buildSupplierRefreshResult(before, { ...after, scanComplete: true }, [], []);
    expect(complete.groupChanges!.missing).toEqual([{ id: "old", label: "old" }]);
  });
  it("does not infer removals from an old record lacking completeness metadata", () => {
    const before = supplier({ catalog: { groups: [group("old")] } });
    const after = supplier({ scannedAt: "after", scanComplete: undefined, catalog: { groups: [] } });
    expect(buildSupplierRefreshResult(before, after, [], []).groupChanges!.missing).toEqual([]);
  });
  it("keeps exact empty models distinct from failed reads and identifies an unconfigured new group", () => {
    const before = connection([model("old")]);
    const after = connection([], { modelScanCheckedAt: "after", modelScanStatus: "empty", modelScanAttemptStatus: "empty" });
    const report = buildSupplierRefreshResult(supplier(), supplier({ scannedAt: "after", catalog: { groups: [group("vip"), group("new")] } }), [before], [after]);
    expect(report.connections![0]!.status).toBe("empty");
    expect(report.connections![0]!.modelRemovedModels.map(item => item.id)).toEqual(["old"]);
    expect(report.connections!.find(item => item.groupId === "new")!.status).toBe("unconfigured");
    expect(report.status).toBe("partial");
  });
  it("records interface and numerical price changes while ignoring newer pricing timestamps", () => {
    const old = model("keep");
    const changed = model("keep", 2, "/v2/images/generations");
    const report = buildSupplierRefreshResult(supplier(), supplier({ scannedAt: "after" }), [connection([old])], [connection([changed], { modelScanCheckedAt: "after" })]);
    expect(report.connections![0]!.interfaceChanges[0]!.before).toContain("/v1/images/generations");
    expect(report.connections![0]!.interfaceChanges[0]!.after).toContain("/v2/images/generations");
    expect(report.connections![0]!.priceChanges).toHaveLength(1);
    const retimed = { ...old, pricing: { ...old.pricing!, checkedAt: "after" } } as ModelDescriptor;
    expect(buildSupplierRefreshResult(supplier(), supplier({ scannedAt: "after" }), [connection([old])], [connection([retimed], { modelScanCheckedAt: "after" })]).connections![0]!.priceChanges).toEqual([]);
  });
  it("shows the prices of all changed tiers and keeps unresolved interfaces actionable", () => {
    const old = { ...model("tiered"), pricing: { kind: "tiered", currency: "CNY", checkedAt: "before", confidence: "exact",
      tiers: [{ id: "2k", label: "2K", price: 1 }, { id: "4k", label: "4K", price: 2 }] } } as ModelDescriptor;
    const next = { ...old, pricing: { ...old.pricing!, tiers: [{ id: "2k", label: "2K", price: 1 }, { id: "4k", label: "4K", price: 3 }] },
      metadata: { ...old.metadata, canvasRunnable: false, canvasUnavailableReason: "新接口缺少完整结果定义" } } as ModelDescriptor;
    const report = buildSupplierRefreshResult(supplier(), supplier({ scannedAt: "after" }), [connection([old])], [connection([next], { modelScanCheckedAt: "after" })]);
    expect(report.connections![0]!.priceChanges[0]!.before).toContain("4K 2 CNY");
    expect(report.connections![0]!.priceChanges[0]!.after).toContain("4K 3 CNY");
    expect(report.connections![0]!.modelIssues).toEqual([{ id: "tiered", name: "tiered", message: "新接口缺少完整结果定义" }]);
    expect(report.status).toBe("partial");
    expect(report.message).toContain("部分接口待确认");
    const perSecond = { ...old, pricing: { ...old.pricing!, billingUnit: "second" } } as ModelDescriptor;
    const units = buildSupplierRefreshResult(supplier(), supplier({ scannedAt: "after" }), [connection([old])], [connection([perSecond], { modelScanCheckedAt: "after" })]);
    expect(units.connections![0]!.priceChanges[0]!.before).toContain("CNY/张");
    expect(units.connections![0]!.priceChanges[0]!.after).toContain("CNY/秒");
  });
  it("separates a successful model list from a failed price lookup without reporting the cached price as changed", () => {
    const old = { ...model("keep"), pricing: undefined, metadata: { priceLabel: "$0.2/张", priceStatus: "available" } } as ModelDescriptor;
    const failed = { ...old, metadata: { priceLabel: "$0.2/张（上次价格）", priceStatus: "failed" } } as ModelDescriptor;
    const report = buildSupplierRefreshResult(supplier(), supplier({ scannedAt: "after" }), [connection([old])], [connection([failed], { modelScanCheckedAt: "after" })]);
    expect(report.connections![0]!.status).toBe("updated");
    expect(report.connections![0]!.priceChanges).toEqual([]);
    expect(report.connections![0]!.priceIssues).toMatchObject([{ failed: true, message: "本次价格读取失败；$0.2/张（上次价格）" }]);
    expect(report.status).toBe("partial");
    expect(report.message).toContain("部分价格未读取");
  });
  it("does not manufacture changes from saved status without a baseline", () => {
    const record = supplier();
    const saved = connection([model("existing")], { modelAddedIds: ["existing"], modelRemovedModels: [{ id: "history", name: "history" }] });
    const report = supplierRefreshStatus(record, [saved]);
    expect(report.status).toBe("updated");
    expect(report.connections![0]!.modelAddedIds).toEqual([]);
    expect(report.connections![0]!.modelRemovedModels).toEqual([]);
    expect(report.groupChanges).toEqual({ added: [], missing: [], renamed: [] });
  });
  it("does not treat the start of a superseding request as a completed directory refresh", () => {
    const before = supplier({ state: { sourceId: "source", scanId: "old" } as SupplierRecord["state"] });
    const after = supplier({ state: { sourceId: "source", scanId: "new-in-progress" } as SupplierRecord["state"] });
    const report = buildSupplierRefreshResult(before, after, [], []);
    expect(report.directory!.status).toBe("unconfirmed");
    expect(report.groupChanges!.missing).toEqual([]);
    expect(report.message).toContain("目录未确认");
  });
  it("discards cross-source comparisons and credential-bearing upstream diagnostics", () => {
    const before = supplier({ state: { sourceId: "old" } as SupplierRecord["state"] });
    const after = supplier({ state: { sourceId: "new" } as SupplierRecord["state"], scannedAt: "after", scanError: "Bearer secret-value https://user:password@example.invalid?token=secret-value apiKey=other-secret" });
    const report = buildSupplierRefreshResult(before, after, [connection([model("old")])], [connection([model("new")], { modelScanCheckedAt: "after" })]);
    expect(report.groupChanges!.missing).toEqual([]);
    expect(report.connections![0]!.modelAddedIds).toEqual([]);
    expect(JSON.stringify(report)).not.toMatch(/secret-value|other-secret|user:password/);
    expect(safeRefreshMessage("HTTP 401", "读取失败")).toBe("HTTP 401");
  });
});
