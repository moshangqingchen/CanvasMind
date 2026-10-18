import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { DirectoryComparisonStats, InformationGrid } from "../components/information-layout";
import { SupplierModelRow } from "../components/supplier-manager";

beforeAll(() => { vi.stubGlobal("React", React); });
afterAll(() => { vi.unstubAllGlobals(); });

it("keeps catalog-only scope and distinguishes an unread Key directory from an empty directory", () => {
  const unread = renderToStaticMarkup(React.createElement(DirectoryComparisonStats, { catalog: 32, keyCount: "—", shared: "—", catalogOnly: "—" }));
  expect(unread).toContain('<dt>官网目录</dt> <dd>32</dd>');
  expect(unread).toContain('<dt>Key</dt> <dd>—</dd>');
  expect(unread).toContain('<dt>官网额外</dt> <dd>—</dd><small>（仅目录）</small>');
  const empty = renderToStaticMarkup(React.createElement(DirectoryComparisonStats, { catalog: 32, keyCount: 0, shared: 0, catalogOnly: 32 }));
  expect(empty).toContain('<dt>Key</dt> <dd>0</dd>');
  expect(empty).toContain('<dt>官网额外</dt> <dd>32</dd>');
});

it("keeps false, zero, exact endpoints and timestamps as values in evidence grids", () => {
  const html = renderToStaticMarkup(React.createElement(InformationGrid, { label: "目录与调用依据", items: [
    { label: "扫描状态", value: "live" }, { label: "完整目录", value: "false" },
    { label: "协议", value: "openai-videos" }, { label: "提交接口", value: "/v1/videos" },
    { label: "图片实测时间", value: "2026-10-14T12:00:00.000Z" }, { label: "型号数", value: 0 },
  ] }));
  for (const fact of ["live", "false", "openai-videos", "/v1/videos", "2026-10-14T12:00:00.000Z", "0"])
    expect(html).toContain(`<dd>${fact}</dd>`);
});

it("protocols stay whole and endpoint segments preserve their exact text with slash-only wrap opportunities", () => {
  const protocol = "openai-images", endpoint = "/v1/images/generations", longEndpoint = `/v1/${"longSegment".repeat(20)}`;
  const html = renderToStaticMarkup(React.createElement(InformationGrid, { label: "目录与调用依据", items: [
    { label: "协议", value: protocol, identifier: "token" },
    { label: "提交接口", value: endpoint, identifier: "path" },
    { label: "长接口", value: longEndpoint, identifier: "path" },
  ] }));
  expect(html).toContain('<code class="information-identifier" title="openai-images">openai-images</code>');
  expect(html).toContain(`title="${endpoint}"`);
  expect(html).toContain(`title="${longEndpoint}"`);
  const segments = [...html.matchAll(/class="information-identifier-segment">([^<]*)<\/span>/gu)].map(match => match[1]);
  expect(segments).toEqual(["/", "v1/", "images/", "generations", "/", "v1/", "longSegment".repeat(20)]);
  expect(segments.slice(0, 4).join("")).toBe(endpoint);
  expect(segments.slice(4).join("")).toBe(longEndpoint);
  expect(html).not.toContain("<wbr");
});

it("a supplier token row uses a compact quote while its expandable table keeps every currency, unit and rate", () => {
  const descriptor = { id: "fixture-token", name: "Fixture", operations: [], pricing: { kind: "token" as const, currency: "CNY" as const,
    inputPerMillion: 6.8896, outputPerMillion: 13.7792, imageOutputPerMillion: 20, confidence: "snapshot" as const, checkedAt: "2026-10-17T12:00:00.000Z" } };
  const html = renderToStaticMarkup(React.createElement(SupplierModelRow, { model: { ...descriptor, capability: "chat", descriptor } }));
  const compact = html.match(/<div class="sm-model-price">([\s\S]*?)<\/div>/u)?.[1] ?? "";
  expect(compact.replace(/<[^>]*>/gu, "")).toBe("Token 计价（目录快照）");
  expect(compact).toContain('data-price-compact=""');
  for (const part of ["Token 计价", "（目录快照）"]) expect(compact).toContain(`>${part}</span>`);
  expect(html).toContain('<summary>价格明细</summary>');
  expect(html).toContain('aria-label="Token 单价"');
  for (const fact of ["输入", "6.8896", "输出", "13.7792", "图片输出", "20", "CNY / 1M tokens", "目录快照"])
    expect(html).toContain(fact);
});
