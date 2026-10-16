import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "./contracts.js";
import type { SupplierCatalogDiscovery } from "./supplier-catalog.js";
import { applySupplierModelAvailability, SUPPLIER_MEDIA_REMOVALS_20261014 } from "./supplier-model-availability.js";

const descriptor = (id: string): ModelDescriptor => ({ id, name: id, operations: ["video.generate"],
  parameters: [{ key: "duration", label: "时长", control: "number", default: 5 }],
  pricing: { kind: "per-request", currency: "CNY", unitAmount: 3, checkedAt: "historical", confidence: "snapshot" },
  metadata: { canvasRunnable: true, originalRequestId: "historical-task" } });
const catalog = (group: string, ids: string[], overrides: Partial<SupplierCatalogDiscovery> = {}): SupplierCatalogDiscovery => ({
  kind: "newapi", status: "live", complete: true, checkedAt: "2026-10-15T00:00:00Z",
  groups: [{ id: group === "27" ? "视频" : group, label: group, source: "catalog", ...(group === "27" ? { supplierGroupId: group } : {}),
    models: ids.map(id => ({ id, capability: "video" })) }], ...overrides,
});

describe("2026-10-14 exact supplier media removals", () => {
  it.each(SUPPLIER_MEDIA_REMOVALS_20261014)("keeps $host / $group / $model history but stops selecting the removed catalog entry", row => {
    const model = descriptor(row.model), before = structuredClone(model);
    const incoming = catalog(row.group, ["another-current-model"]);
    const args = [row.group, incoming, `https://${row.host}/v1`, row.group === "27" ? "27" : undefined] as const;
    const result = applySupplierModelAvailability([model], ...args)[0]!;
    expect(result.metadata).toMatchObject({ canvasRunnable: false, originalRequestId: "historical-task" });
    expect(result.pricing).toEqual(model.pricing);
    expect(result.parameters).toEqual(model.parameters);
    expect(result.operations).toEqual(model.operations);
    expect(model).toEqual(before);
    expect(applySupplierModelAvailability([result], ...args)[0]).toEqual(result);
    const returned = applySupplierModelAvailability([result], row.group, catalog(row.group, [row.model]), `https://${row.host}/v1`, args[3])[0]!;
    expect(returned).toEqual(before);
    expect(applySupplierModelAvailability([model], "different-group", incoming, `https://${row.host}/v1`)[0]).toEqual(before);
    expect(applySupplierModelAvailability([model], row.group, incoming, "https://unrelated.example/v1", args[3])[0]).toEqual(before);
  });
  it.each([
    { status: "failed" as const }, { status: "unauthorized" as const }, { status: "empty" as const },
    { complete: false }, { checkedAt: "2026-10-12T00:00:00Z" }, { checkedAt: "invalid" },
  ])("does not turn incomplete or older reads into removals: %j", overrides => {
    const model = descriptor("sd-2.0-mini-J1");
    expect(applySupplierModelAvailability([model], "vip", catalog("vip", ["current"], overrides), "https://ai.jiasuapi.com")).toEqual([model]);
  });
  it("does not treat an empty group, ambiguous stable identity, or another group's same model as removed", () => {
    const model = descriptor("sd10-seedance-2.0");
    expect(applySupplierModelAvailability([model], "视频", catalog("27", []), "https://vapi.chuangxiangai.asia", "27")).toEqual([model]);
    const duplicate = catalog("27", ["current"]); duplicate.groups.push({ ...duplicate.groups[0]! });
    expect(applySupplierModelAvailability([model], "视频", duplicate, "https://vapi.chuangxiangai.asia", "27")).toEqual([model]);
    expect(applySupplierModelAvailability([model], "视频", catalog("28", ["current"]), "https://vapi.chuangxiangai.asia", "28")).toEqual([model]);
  });
});
