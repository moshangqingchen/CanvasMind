import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProviderConnectionView } from "./client-api";
import type { SupplierRecord } from "./client-suppliers";
import { buildSupplierRefreshResult, supplierRefreshStatus, type SupplierRefreshResult } from "./supplier-refresh-report";
import { SupplierRefreshDetails } from "../components/supplier-refresh-details";

vi.mock("react-dom", async importOriginal => ({
  ...await importOriginal<typeof import("react-dom")>(),
  createPortal: (children: React.ReactNode) => children,
}));

const beforeTime = "2026-10-21T03:00:00.000Z";
const afterTime = "2026-10-22T03:00:00.000Z";
const supplier = (scannedAt: string, groupId: string, scanComplete: boolean | undefined): SupplierRecord => ({
  id: "fixture", name: "测试供应商", supplierKey: "custom", kind: "newapi",
  siteUrl: "https://example.invalid", apiUrl: "https://example.invalid/v1",
  catalog: { groups: [{ id: groupId, label: `${groupId} 分组`, source: "catalog", models: [] }] },
  scanStatus: "live", scanComplete, scannedAt, createdAt: beforeTime, updatedAt: scannedAt,
});
const connection = (checkedAt: string, modelId: string, complete: boolean | undefined): ProviderConnectionView => ({
  id: "connection", name: "测试连接", provider: "openai", apiKey: "", apiKeySet: true,
  config: { supplierId: "fixture", modelGroup: "stable-group", modelScanStatus: "live",
    modelScanCheckedAt: checkedAt, modelScanComplete: complete, scannedModelIds: [modelId],
    modelCatalogModels: [{ id: modelId, name: modelId, operations: ["image.generate"] }] },
});
const render = (result: SupplierRefreshResult) => renderToStaticMarkup(React.createElement(SupplierRefreshDetails, {
  supplierName: "测试供应商", result, running: false, canRefresh: true, onRefresh: vi.fn(), onClose: vi.fn(),
}));

describe("supplier refresh detail evidence", () => {
  beforeAll(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("document", { body: {} });
  });
  afterAll(() => vi.unstubAllGlobals());

  it.each([undefined, false])("shows first discoveries from a %s completeness baseline without claiming additions", complete => {
    const result = buildSupplierRefreshResult(supplier(beforeTime, "old-group", complete), supplier(afterTime, "first-group", true),
      [connection(beforeTime, "old-model", complete)], [connection(afterTime, "first-model", true)]);
    const html = render(result);
    expect(html).toContain("首次发现分组（1）");
    expect(html).toContain("first-group 分组");
    expect(html).toContain("首次发现模型（1）");
    expect(html).toContain("<code>first-model</code>");
    expect(html).toContain("缺少完整旧基线，无法确认何时新增。");
    expect(html).toContain("缺少同一身份的完整旧基线，无法确认何时新增。");
    expect(html).not.toContain("未发现变化");
    expect(html).not.toContain("未发现公开分组变化");
    expect(html).not.toContain("新增分组（");
    expect(html).not.toContain("新增模型（");
    expect(html).toContain("刷新会更新已保存目录与连接资料；未完成的项目保留上次配置。");
    expect(html).not.toContain("刷新只读取资料");
  });

  it("keeps confirmed additions separate when the same identity has a complete baseline", () => {
    const result = buildSupplierRefreshResult(supplier(beforeTime, "old-group", true), supplier(afterTime, "new-group", true),
      [connection(beforeTime, "old-model", true)], [connection(afterTime, "new-model", true)]);
    const html = render(result);
    expect(html).toContain("新增分组（1）");
    expect(html).toContain("新增模型（1）");
    expect(html).toContain("<code>new-model</code>");
    expect(html).not.toContain("首次发现分组（");
    expect(html).not.toContain("首次发现模型（");
  });

  it("shows saved status without inventing first discoveries", () => {
    const result = supplierRefreshStatus(supplier(afterTime, "saved-group", undefined), [connection(afterTime, "saved-model", undefined)]);
    const html = render(result);
    expect(html).toContain("仅展示已保存状态；刷新后可查看本次变化。");
    expect(html).not.toContain('aria-label="分组变化详情"');
    expect(html).not.toContain("首次发现分组（");
    expect(html).not.toContain("首次发现模型（");
  });
});
