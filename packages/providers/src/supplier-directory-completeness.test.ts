import { describe, expect, it } from "vitest";
import { supplierDirectoryPayloadComplete } from "./supplier-directory-completeness.js";

describe("supplier directory membership completeness", () => {
  it("does not require prices on a complete model list", () => {
    expect(supplierDirectoryPayloadComplete({ success: true, data: [{ model_name: "full/a" }, { model_name: "full/b", model_price: .1 }], total: 2 })).toBe(true);
  });
  it.each([
    { has_more: true }, { hasMore: "1" }, { complete: false }, { truncated: true },
    { next_page_token: "next" }, { pagination: { total: 3 } }, { meta: { total_pages: 2, page: 1 } },
    { has_more: "unknown" }, { total: "unknown" }, { error: { code: "FAILED" } },
  ])("rejects explicit partial/error membership %j", extra => {
    expect(supplierDirectoryPayloadComplete({ data: [{ model_name: "full/a" }], ...extra })).toBe(false);
  });
  it("checks nested group and model pagination without treating absent quotes as errors", () => {
    const group = { id: 7, models: [{ name: "full/a" }], pagination: { total: 2 } };
    expect(supplierDirectoryPayloadComplete({ data: { groups: [group] } })).toBe(false);
    expect(supplierDirectoryPayloadComplete({ data: { groups: [{ ...group, pagination: { total: 1 } }] } })).toBe(true);
  });
  it.each([
    { page: 2, total_pages: 2 }, { page: 2 }, { totalPages: 2, currentPage: 2 },
    { pagination: { page: 2, total_pages: 2 } }, { meta: { current_page: 2, total_pages: 2 } },
  ])("never treats a single last-page response as accumulated membership: %j", pagination => {
    expect(supplierDirectoryPayloadComplete({ data: [{ model_name: "last-page/id" }], ...pagination })).toBe(false);
  });
  it("accepts a genuinely single first page", () => {
    expect(supplierDirectoryPayloadComplete({ data: [{ model_name: "only/id" }], page: 1, total_pages: 1, total: 1 })).toBe(true);
  });
  it("uses the parsed groups collection for total checks when another data array also exists", () => {
    const groups = [{ name: "read-group", models: [] }], data = [{ model_name: "other/a" }, { model_name: "other/b" }];
    expect(supplierDirectoryPayloadComplete({ groups, data, total: 2 })).toBe(false);
    expect(supplierDirectoryPayloadComplete({ groups, data, total: 1 })).toBe(true);
  });
});
