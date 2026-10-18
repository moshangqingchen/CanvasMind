import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseLangframeCatalog } from "@super-canvas/providers";
import { SupplierGroupName, supplierDirectoryOverview } from "../components/supplier-manager";
import type { SupplierCatalogGroup } from "./client-suppliers";

const fixture = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/fixtures/langframe-catalog-20261018.json", import.meta.url), "utf8")) as {
  payload: unknown; checkedAt: string;
};
const official = parseLangframeCatalog(fixture.payload, { checkedAt: fixture.checkedAt }).groups;
const distinct = [...new Map(official.flatMap(group => group.models).map(model => [model.id, model])).values()];
const scopes: SupplierCatalogGroup[] = [
  { id: "langframe-key:fixture-uuid:canvas", label: "Key f6 · 图片与视频", source: "catalog", status: "available", models: distinct.filter(model => model.capability !== "chat") },
  { id: "langframe-key:fixture-uuid:agent", label: "Key f6 · 对话", source: "catalog", status: "available", models: distinct.filter(model => model.capability === "chat") },
];
const groups = [...official, ...scopes];
beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

describe("狼帧 supplier directory presentation", () => {
  it("counts 39 official groups and 40 distinct call names without adding the two application Key views", () => {
    expect(groups).toHaveLength(41);
    expect(groups.reduce((total, group) => total + group.models.length, 0)).toBe(87);
    expect(supplierDirectoryOverview("langframe", groups, groups)).toMatchObject({
      groupCount: 39, modelCount: 40, groupLabel: "官网分组", modelLabel: "不同调用型号", keyUsageCount: 2,
      listDescription: "39 个官网分组 + 2 个应用 Key 用途。应用 Key 用途分别展示图片与视频、对话的可用范围。",
    });
  });

  it("keeps manual and retained groups out of current official totals while stating why they remain in the list", () => {
    const extra: SupplierCatalogGroup[] = [
      ...groups, { id: "manual", label: "manual", source: "manual", models: [distinct[0]!] },
      { id: "old", label: "old", source: "catalog", status: "missing", models: [{ id: "historical-only", capability: "image" }] },
    ];
    const overview = supplierDirectoryOverview("langframe", extra, extra);
    expect(overview).toMatchObject({ groupCount: 39, modelCount: 40, keyUsageCount: 2 });
    expect(overview.listDescription).toContain("39 个官网分组 + 2 个应用 Key 用途 + 1 个手动分组；另保留 1 个历史分组");
  });

  it("renders the saved Key label as the heading and accessible name without exposing its internal scope ID", () => {
    const scope = scopes[0]!;
    const html = renderToStaticMarkup(React.createElement(SupplierGroupName, { group: scope, langframe: true, active: false, onSelect: () => {} }));
    expect(html).toContain('<h4 aria-label="Key f6 · 图片与视频">');
    expect(html).toContain('title="Key f6 · 图片与视频"');
    expect(html).toContain('<span>Key f6 · 图片与视频</span>');
    expect(html).not.toContain(scope.id);
    expect(html.match(/<span>Key f6 · 图片与视频<\/span>/gu)).toHaveLength(1);
    const fallback = renderToStaticMarkup(React.createElement(SupplierGroupName, { group: { ...scope, label: scope.id }, langframe: true, active: false, onSelect: () => {} }));
    expect(fallback).toContain("Key · 图片与视频");
    expect(fallback).not.toContain("langframe-key:");
  });

  it("preserves every other supplier's existing count, heading and secondary label behavior", () => {
    expect(supplierDirectoryOverview("sub2api", groups, groups)).toMatchObject({ groupCount: 41, modelCount: 87,
      groupLabel: "当前分组", modelLabel: "目录型号", groupNote: "保留站点目录与手动分组", modelNote: "按已保存的分组记录统计",
      listDescription: "平台实际扫描返回的分组。" });
    const group = { id: "route-17", label: "站点路线名称" };
    const html = renderToStaticMarkup(React.createElement(SupplierGroupName, { group, active: true, onSelect: () => {} }));
    expect(html).toContain('<h4 aria-label="route-17">');
    expect(html).toContain('<span>route-17</span>');
    expect(html).toContain('<span title="站点路线名称">站点路线名称</span>');
    expect(supplierDirectoryOverview("auto", [], undefined).modelCount).toBeUndefined();
  });
});
