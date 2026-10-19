import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { SupplierBillingSnapshot } from "@super-canvas/db";
import { nodeParameterRouteBalance, nodeParameterRouteGroups, nodeParameterRoutePath, nodeParameterRouteRows, nodeParameterRouteSharedSupplierId, type NodeParameterRoute } from "./node-parameter-routes";
import { billingCompact } from "./supplier-billing-display";

const model = (currency: string, unitAmount: number): ModelDescriptor => ({
  id: "shared-full-model", name: "Shared model", operations: ["image.generate"],
  pricing: { kind: "per-request", currency, unitAmount, confidence: "exact", checkedAt: "2026-10-18T08:00:00Z" },
});
const connections: NodeParameterRoute[] = [
  { id: "same-prefix-1", name: "同名连接", provider: "openai", supplier: "supplier-a", supplierLabel: "供应商 A", supplierId: "account-a",
    group: "stable-7", groupLabel: "图片组", modelDescriptor: model("CNY", 0.4), switchModelId: "restored-other-model" },
  { id: "same-prefix-2", name: "同名连接", provider: "openai", supplier: "supplier-a", supplierLabel: "供应商 A", supplierId: "account-a",
    group: "stable-7", groupLabel: "图片组", modelDescriptor: model("USD", 0.8), switchModelId: "target-default-model", available: false, unavailableReason: "当前 Key 已停用" },
  { id: "another-group", name: "其他连接", provider: "rest", supplier: "supplier-a", supplierLabel: "供应商 A", supplierId: "account-a",
    group: "stable-8", groupLabel: "图片组", switchModelId: "new-default-model" },
];

describe("parameter route menu display projection", () => {
  it("keeps every connection and stable group, disambiguates duplicate names, and retains exact account identities", () => {
    const before = JSON.stringify(connections);
    const rows = nodeParameterRouteRows(connections, "same-prefix-1");
    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.connection.id)).toEqual(connections.map(connection => connection.id));
    expect(rows[0]?.connectionLabel).toBe("同名连接 · same-prefix-1");
    expect(rows[1]?.connectionLabel).toBe("同名连接 · same-prefix-2");
    expect(rows[0]?.connection.group).toBe("stable-7");
    expect(rows[2]?.connection.group).toBe("stable-8");
    expect(rows.map(row => row.connection.supplierId)).toEqual(["account-a", "account-a", "account-a"]);
    expect(rows[0]?.current).toBe(true);
    expect(rows[1]?.unavailableReason).toBe("当前 Key 已停用");
    expect(JSON.stringify(connections)).toBe(before);
  });

  it("keeps same-ID comparison prices separate from the model each switch will actually restore", () => {
    const rows = nodeParameterRouteRows(connections, "same-prefix-1");
    expect(rows[0]?.comparisonPrice).toBe("0.4 CNY / 次");
    expect(rows[1]?.comparisonPrice).toBe("0.8 USD / 次");
    expect(rows[0]?.switchModelId).toBe("restored-other-model");
    expect(rows[1]?.switchModelId).toBe("target-default-model");
    expect(rows[2]?.comparisonPrice).toBe("—");
    expect(rows[2]?.switchModelId).toBe("new-default-model");
    expect(rows[0]?.connection.modelDescriptor?.id).toBe("shared-full-model");
  });

  it("groups stable supplier identities without merging equal labels or changing candidate prices", () => {
    const candidates = [...connections, { ...connections[0]!, id: "other-supplier", supplier: "supplier-b" }];
    const groups = nodeParameterRouteGroups(nodeParameterRouteRows(candidates, "same-prefix-1"));
    expect(groups.map(group => [group.supplier, group.label, group.rows.map(row => row.connection.id)])).toEqual([
      ["supplier-a", "供应商 A", ["same-prefix-1", "same-prefix-2", "another-group"]],
      ["supplier-b", "供应商 A", ["other-supplier"]],
    ]);
    expect(groups[0]?.rows.map(row => row.comparisonPrice)).toEqual(["0.4 CNY / 次", "0.8 USD / 次", "—"]);
  });

  it("shows readable short identities and only calls an exact matching full model the same model", () => {
    const candidates = [
      { ...connections[0]!, id: "named", name: "供应商 A · 主连接", switchModelId: "current-model", switchModelName: "共同显示名" },
      { ...connections[2]!, id: "different", name: "供应商 A · 图片组", switchModelId: "different-model", switchModelName: "共同显示名" },
      { ...connections[2]!, id: "unknown", switchModelId: undefined },
      { ...connections[2]!, id: "space-prefix", name: "供应商 A 主连接" },
    ];
    const rows = nodeParameterRouteRows(candidates, "named", "current-model");
    expect(rows[0]?.shortLabel).toBe("图片组 · 主连接");
    expect(rows[0]?.path).toBe("供应商 A › 图片组 › 供应商 A · 主连接");
    expect(rows[0]?.switchLabel).toBe("同型号");
    expect(rows[1]?.shortLabel).toBe("图片组");
    expect(rows[1]?.switchLabel).toBe("切换后将使用：共同显示名");
    expect(rows[1]?.switchModelId).toBe("different-model");
    expect(rows[2]?.switchLabel).toBeUndefined();
    expect(rows[3]?.shortLabel).toBe("图片组 · 主连接");
    expect(nodeParameterRouteRows([candidates[2]!], "unknown", "—")[0]?.switchLabel).toBeUndefined();
    expect(nodeParameterRouteRows([{ ...candidates[2]!, switchModelId: "", switchModelName: "过期名称" }], "unknown")[0]?.switchLabel).toBeUndefined();
  });

  it("uses the longer normalized group or connection prefix once, retaining unrelated names separately", () => {
    const route = (name: string, groupLabel: string): NodeParameterRoute => ({ ...connections[0]!, name, groupLabel });
    for (const [name, groupLabel, primaryLabel, secondaryLabel] of [
      ["供应商 A · 图片组", "图片组", "图片组", undefined],
      ["供应商 A › 图片组-备用", "图片组", "图片组-备用", undefined],
      ["图片组", "图片组-高质量", "图片组-高质量", undefined],
      [" 供应商 A · · 图片组 › ", " · 供应商 A › 图片组 · ", "图片组", undefined],
      ["供应商 A 主连接", "图片组", "图片组", "主连接"],
    ] as const) {
      const candidate = route(name, groupLabel);
      const before = JSON.stringify(candidate);
      const row = nodeParameterRouteRows([candidate], candidate.id)[0]!;
      expect([row.primaryLabel, row.secondaryLabel]).toEqual([primaryLabel, secondaryLabel]);
      expect(row.path).toBe(`供应商 A › ${groupLabel} › ${name.trim()}`);
      expect(JSON.stringify(candidate)).toBe(before);
    }
  });

  it("keeps duplicate group IDs and same-group connection short IDs visibly distinct", () => {
    const rows = nodeParameterRouteRows(connections, "same-prefix-1");
    expect(rows.map(row => row.primaryLabel)).toEqual(["图片组", "图片组", "图片组"]);
    expect(rows.map(row => row.groupIdLabel)).toEqual(["stable-7", "stable-7", "stable-8"]);
    expect(rows.map(row => row.secondaryLabel)).toEqual(["同名连接 · same-prefix-1", "同名连接 · same-prefix-2", "其他连接"]);
    const repeated = connections.slice(0, 2).map(connection => ({ ...connection, name: "供应商 A · 图片组" }));
    const repeatedRows = nodeParameterRouteRows(repeated, "same-prefix-1");
    expect(repeatedRows.map(row => row.primaryLabel)).toEqual(["图片组 · same-prefix-1", "图片组 · same-prefix-2"]);
    expect(repeatedRows.every(row => row.secondaryLabel === undefined)).toBe(true);
    const normalizedGroups = [
      { ...connections[0]!, name: "图片组-备用", groupLabel: "供应商 A · 图片组" },
      { ...connections[2]!, groupLabel: "图片组" },
      { ...connections[2]!, id: "separate-supplier", supplier: "supplier-b", groupLabel: "图片组" },
    ];
    const normalizedRows = nodeParameterRouteRows(normalizedGroups, "");
    expect(normalizedRows.map(row => row.primaryLabel)).toEqual(["图片组-备用", "图片组", "图片组"]);
    expect(normalizedRows.map(row => row.groupIdLabel)).toEqual(["stable-7", "stable-8", undefined]);
  });

  it("keeps duplicate group identity separate from a long clamped display name", () => {
    const groupLabel = "极长的分组显示名称需要在窄屏下折行并截断".repeat(12);
    const candidates = [connections[0]!, connections[2]!].map(connection => ({ ...connection, groupLabel, name: groupLabel }));
    const rows = nodeParameterRouteRows(candidates, "");
    expect(rows.map(row => row.primaryLabel)).toEqual([groupLabel, groupLabel]);
    expect(rows.map(row => row.groupIdLabel)).toEqual(["stable-7", "stable-8"]);
    expect(rows.every(row => row.secondaryLabel === undefined)).toBe(true);
  });

  it("reproduces the legacy mojibake projection and preserves its original text in the new hierarchy", () => {
    const candidate = { ...connections[0]!, supplierLabel: "供应商 A", name: "供应商 A Â· AZURE-openai", groupLabel: "AZURE-openai" };
    const row = nodeParameterRouteRows([candidate], candidate.id)[0]!;
    expect(row.shortLabel).toBe("AZURE-openai · Â· AZURE-openai");
    expect(row.primaryLabel).toBe("AZURE-openai");
    expect(row.secondaryLabel).toBe("Â· AZURE-openai");
    expect(row.connectionLabel).toBe(candidate.name);
    expect(row.path).toBe("供应商 A › AZURE-openai › 供应商 A Â· AZURE-openai");
    expect(candidate.name).toBe("供应商 A Â· AZURE-openai");
  });

  it("lifts a balance only for one shared nonempty supplier account, including unread balances", () => {
    const rows = nodeParameterRouteRows(connections, "same-prefix-1");
    expect(nodeParameterRouteSharedSupplierId(rows)).toBe("account-a");
    expect(nodeParameterRouteSharedSupplierId(rows.slice(0, 1))).toBe("account-a");
    const candidates = (supplierId: string | undefined) => nodeParameterRouteRows([connections[0]!, { ...connections[1]!, supplierId }], "same-prefix-1");
    expect(nodeParameterRouteSharedSupplierId(candidates("account-b"))).toBeUndefined();
    expect(nodeParameterRouteSharedSupplierId(candidates(undefined))).toBeUndefined();
    expect(nodeParameterRouteSharedSupplierId(candidates(""))).toBeUndefined();
    expect(nodeParameterRouteSharedSupplierId(nodeParameterRouteRows(connections.map(connection => ({ ...connection, supplierId: " " })), ""))).toBeUndefined();
    expect(nodeParameterRouteSharedSupplierId([])).toBeUndefined();
    const accounts: Array<{ id: string; billing?: SupplierBillingSnapshot }> = [{ id: "account-a" }];
    expect(billingCompact(accounts.find(account => account.id === nodeParameterRouteSharedSupplierId(rows))?.billing)).toBe("余额未读取");
    expect(nodeParameterRouteSharedSupplierId(candidates("account-b"))).toBeUndefined();
  });

  it("shows only finite recorded compact balances, preserving zero, currency and stale evidence", () => {
    const billing: SupplierBillingSnapshot = { sourceId: "a", status: "live", checkedAt: "2026-10-18T08:00:00Z", sourceUrl: "https://billing.invalid", unit: "USD", balance: 0 };
    expect(nodeParameterRouteBalance(billing)).toBe("余额 0 USD");
    expect(nodeParameterRouteBalance({ ...billing, status: "failed", balance: 22, balanceUnit: "CNY" })).toBe("余额 22 CNY（上次）");
    expect(nodeParameterRouteBalance()).toBe("");
    expect(nodeParameterRouteBalance({ ...billing, balance: undefined })).toBe("");
    expect(nodeParameterRouteBalance({ ...billing, balance: Number.NaN })).toBe("");
    expect(nodeParameterRouteBalance({ ...billing, balance: Number.POSITIVE_INFINITY })).toBe("");
  });

  it("preserves the current missing connection and keeps a unique connection's compact path readable", () => {
    expect(nodeParameterRoutePath(connections, "same-prefix-1")).toBe("供应商 A › 图片组 › 同名连接 · same-prefix-1");
    expect(nodeParameterRoutePath(connections, "another-group")).toBe("供应商 A › 图片组");
    expect(nodeParameterRoutePath(connections, "deleted-id")).toBe("原连接已不可用");
    expect(nodeParameterRoutePath(connections, "")).toBe("未配置 API");
    expect(nodeParameterRouteRows([{ ...connections[2]!, available: false }], "")[0]?.unavailableReason).toBe("密钥未配置或不可用");
  });
});
