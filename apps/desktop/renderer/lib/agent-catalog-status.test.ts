import { describe, expect, it } from "vitest";
import { agentCatalogSnapshot, unreadAgentCatalogConnections, AGENT_UNREAD_CATALOG_MESSAGE, agentSavedCatalogDescription } from "./agent-catalog-status";

describe("assistant saved catalog presentation", () => {
  it("presents saved scanner provenance without claiming a new upstream read", () => {
    expect(agentSavedCatalogDescription("由当前供应商 API 实时返回的模型。")).toBe("来自已保存的供应商目录。");
    expect(agentSavedCatalogDescription("由当前供应商 API 实时返回；画布协议尚未验证。")).toBe("来自已保存的供应商目录；画布协议尚未验证。");
    expect(agentSavedCatalogDescription("支持长文写作的模型说明")).toBe("支持长文写作的模型说明");
    expect(agentSavedCatalogDescription()).toBeUndefined();
  });
  it("keeps complete saved models and connection state without adding candidates", () => {
    const model = { id: "full/model-id", parameters: [{ key: "quality", options: ["high"] }], pricing: { label: "saved quote" } };
    const snapshot = { models: [model], connections: [{ connectionId: "saved", connectionName: "已存连接", status: "saved" as const }] };
    expect(agentCatalogSnapshot(snapshot)).toBe(snapshot);
    expect(unreadAgentCatalogConnections(snapshot.connections)).toEqual([]);
    expect(agentCatalogSnapshot([model])).toEqual({ models: [model], connections: [] });
  });

  it("names unread connections and searches the supplier without judging capability", () => {
    const unread = { connectionId: "unread", connectionName: "待读取分组", supplierName: "晨星供应商", status: "unread" as const };
    expect(unreadAgentCatalogConnections([unread], "晨星")).toEqual([unread]);
    expect(unreadAgentCatalogConnections([unread], "其他")).toEqual([]);
    expect(AGENT_UNREAD_CATALOG_MESSAGE).toBe("未读取目录 · 请先在设置中刷新");
  });
});
