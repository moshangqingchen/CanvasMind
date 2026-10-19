import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { nodeParameterRoutePath, nodeParameterRouteRows, type NodeParameterRoute } from "./node-parameter-routes";

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

  it("preserves the current missing connection and keeps a unique connection's compact path readable", () => {
    expect(nodeParameterRoutePath(connections, "same-prefix-1")).toBe("供应商 A › 图片组 › 同名连接 · same-prefix-1");
    expect(nodeParameterRoutePath(connections, "another-group")).toBe("供应商 A › 图片组");
    expect(nodeParameterRoutePath(connections, "deleted-id")).toBe("原连接已不可用");
    expect(nodeParameterRoutePath(connections, "")).toBe("未配置 API");
    expect(nodeParameterRouteRows([{ ...connections[2]!, available: false }], "")[0]?.unavailableReason).toBe("密钥未配置或不可用");
  });
});
