import { describe, expect, it, vi } from "vitest";
import { discoverSupplierCatalog, normalizeSupplierSiteBase, normalizeSupplierUrl, parseSupplierCatalog, parseSupplierKeyGroups, supplierModelUrls } from "./supplier-catalog.js";

describe("supplier discovery", () => {
  it("retains overlapping New API group membership and empty published groups", () => {
    const result = parseSupplierCatalog({ group_ratio: { vip: 1, basic: 2, empty: 1 }, usable_group: { vip: "VIP", empty: "Empty" }, data: [{ model_name: "gpt-image-2", enable_groups: ["vip", "basic"], supported_endpoint_types: ["openai-images"], price_label: "0.1/张" }] });
    expect(result.kind).toBe("newapi");
    expect(result.groups.map((group) => [group.id, group.models.map((model) => model.id)])).toEqual([["vip", ["gpt-image-2"]], ["empty", []], ["basic", ["gpt-image-2"]]]);
    expect(result.groups[0]?.models[0]).toMatchObject({ capability: "image", protocol: "openai-images", priceLabel: "0.1/张" });
  });
  it("reads Sub2API model plaza groups and OpenAI empty-data alternative", () => {
    expect(parseSupplierCatalog({ data: { groups: [{ name: "Claude", models: [{ name: "claude-sonnet" }] }] } })).toMatchObject({ kind: "sub2api", groups: [{ id: "Claude", models: [{ id: "claude-sonnet", capability: "chat" }] }] });
    expect(parseSupplierCatalog({ data: [], models: [{ id: "unknown-model" }] }).groups[0]?.models[0]).toMatchObject({ id: "unknown-model", capability: "other", protocol: "unknown" });
    expect(parseSupplierCatalog({ data: [] }).recognized).toBe(true);
    expect(parseSupplierCatalog({ message: "sign in first" }).recognized).toBe(false);
  });
  it("normalizes API endpoints without duplicate v1 and rejects embedded credentials", () => {
    expect(supplierModelUrls("https://api.example.com/v1/")).toEqual(["https://api.example.com/v1/models"]);
    expect(supplierModelUrls("https://api.example.com/v1/models")).toContain("https://api.example.com/v1/models");
    expect(normalizeSupplierSiteBase("https://api.example.com/gateway/one/v1/")).toBe("https://api.example.com/gateway/one");
    for (const address of ["https://user:password@example.com", "https://example.com?token=secret", "file:///etc/passwd"]) expect(() => normalizeSupplierUrl(address)).toThrow();
  });
  it("retries gated pricing with a site token and numeric user ID only on the explicit site", async () => {
    const calls: Array<{ url: string; auth: string | null; user: string | null }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input); const headers = new Headers(init?.headers);
      calls.push({ url, auth: headers.get("authorization"), user: headers.get("New-Api-User") });
      if (!headers.get("authorization")) return Response.json({ error: "login" }, { status: 401 });
      return Response.json({ data: [{ model_name: "gpt-image-2", enable_groups: ["images"] }] });
    });
    const result = await discoverSupplierCatalog({ siteUrl: "https://site.example.com/gateway/v1", apiUrl: "https://api.example.com/v1", token: "test-token:42" }, fetcher);
    expect(result.status).toBe("live");
    expect(calls).toEqual([
      { url: "https://site.example.com/gateway/api/pricing", auth: null, user: null },
      { url: "https://site.example.com/gateway/api/pricing", auth: "Bearer test-token", user: "42" },
    ]);
  });
  it("stops at a login-gated NewAPI site rather than inferring another platform", async () => {
    const fetcher = vi.fn(async () => Response.json({ error: "denied" }, { status: 401 }));
    const result = await discoverSupplierCatalog({ siteUrl: "https://docs.example.com", apiUrl: "https://api.example.com", token: "test-token" }, fetcher);
    expect(result.status).toBe("unauthorized");
    expect(result.groups).toHaveLength(0);
    expect(result.kind).toBe("newapi");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("recognizes disabled plazas in CDR probe order while retaining gateway paths", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input); calls.push(url);
      return url.endsWith("/setup/status") ? Response.json({ code: 0, data: { needs_setup: false } }) : Response.json({ error: "missing" }, { status: 404 });
    });
    const result = await discoverSupplierCatalog({ siteUrl: "https://example.com/gateway", apiUrl: "https://api.example.com/v1" }, fetcher);
    expect(result).toMatchObject({ kind: "sub2api", status: "failed", groups: [] });
    expect(calls).toEqual(["https://example.com/gateway/api/pricing", "https://example.com/gateway/api/v1/model-plaza", "https://example.com/gateway/api/status", "https://example.com/gateway/setup/status", "https://example.com/gateway/api/v1/groups/available"]);
  });
  it("recognizes NewAPI status before querying a Sub2API fingerprint", async () => {
    const calls: string[] = [];
    const result = await discoverSupplierCatalog({ siteUrl: "https://example.com", apiUrl: "" }, async (input) => {
      calls.push(String(input));
      return String(input).endsWith("/api/status") ? Response.json({ data: { system_name: "My gateway" } }) : Response.json({}, { status: 404 });
    });
    expect(result.kind).toBe("newapi");
    expect(calls).toHaveLength(4);
  });
  it("does not send a website token to generic model endpoints", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const result = await discoverSupplierCatalog({ kind: "openai-compatible", siteUrl: "https://site.example.com", apiUrl: "https://api.example.com/gateway/v1", token: "login-token:42" }, async (input, init) => {
      calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
      return Response.json({ data: [{ id: "models/my-original-id" }] });
    });
    expect(calls).toEqual([{ url: "https://api.example.com/gateway/v1/models", auth: null }]);
    expect(result.groups[0]?.models[0]?.id).toBe("models/my-original-id");
  });
  it("preserves raw model IDs and expands enable_group/all into every detected group", () => {
    const parsed = parseSupplierCatalog({ usable_group: { first: "First", second: "Second" }, data: [
      { model_name: "models/raw/image", enable_groups: [], enable_group: ["all"] },
      { model_name: "MODEl:Case/1", enable_group: ["hidden"] },
    ] });
    expect(parsed.groups.map((group) => group.id)).toEqual(["first", "second", "hidden"]);
    for (const group of parsed.groups) expect(group.models.some((model) => model.id === "models/raw/image")).toBe(true);
    expect(parsed.groups[2]?.models.some((model) => model.id === "MODEl:Case/1")).toBe(true);
  });
});

it.each(["/dashboard", "/pricing/", "/api/v1/model-plaza", "/model-plaza", "/v1", "/keys", "/console/token"])("preserves gateway prefixes while stripping the %s page suffix", async (suffix) => {
  const urls: string[] = [];
  const result = await discoverSupplierCatalog({ siteUrl: `https://example.com/gateway${suffix}`, apiUrl: "", kind: "newapi" }, async input => { urls.push(String(input)); return Response.json({ data: [] }); });
  expect(urls).toEqual(["https://example.com/gateway/api/pricing", "https://example.com/gateway/api/user/self/groups"]);
  expect(result.status).toBe("empty");
});

describe("API-key page group fallback", () => {
  it.each(["empty", "disabled", "gated"])("reads Sub2API group options when model plaza is %s", async (mode) => {
    const calls: string[] = [];
    const result = await discoverSupplierCatalog({ siteUrl: "https://site.example.com/gateway/keys", apiUrl: "https://api.example.com/v1", kind: "sub2api", token: "temporary-login-token" }, async (url, init) => {
      calls.push(String(url));
      if (String(url).endsWith("/model-plaza")) {
        return mode === "empty" ? Response.json({ code: 0, data: { groups: [] } })
          : Response.json({ message: "unavailable" }, { status: mode === "gated" ? 401 : 404 });
      }
      expect(String(url)).toBe("https://site.example.com/gateway/api/v1/groups/available");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer temporary-login-token");
      return Response.json({ code: 0, data: [
        { id: 12, name: "codex 稳定", description: "说明", rate_multiplier: 2 },
        { id: 15, name: "香蕉2 1k2k", platform: "gemini" },
        { id: 15, name: "香蕉2 1k2k" },
      ] });
    });
    expect(result).toMatchObject({ status: "live", kind: "sub2api", groups: [
      { id: "codex 稳定", label: "codex 稳定", models: [] },
      { id: "香蕉2 1k2k", label: "香蕉2 1k2k", models: [] },
    ] });
    expect(calls.every((url) => url.startsWith("https://site.example.com/gateway/"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("temporary-login-token");
  });

  it("uses NewAPI user groups and user-id authentication when public pricing has no groups", async () => {
    const result = await discoverSupplierCatalog({ kind: "newapi", siteUrl: "https://site.example.com/console/token", apiUrl: "https://elsewhere.example.com", token: "site-token:42" }, async (url, init) => {
      if (String(url).endsWith("/api/pricing")) return Response.json({ success: true, data: [] });
      expect(String(url)).toBe("https://site.example.com/api/user/self/groups");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer site-token");
      expect(new Headers(init?.headers).get("New-Api-User")).toBe("42");
      return Response.json({ success: true, data: { default: { ratio: 1, desc: "默认分组" }, vip: { ratio: 0.8, desc: "VIP" } } });
    });
    expect(result).toMatchObject({ status: "live", groups: [{ id: "default", label: "默认分组", models: [] }, { id: "vip", models: [] }] });
  });

  it("keeps model plaza first and does not request group options when it succeeds", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: { groups: [{ name: "image", models: ["gpt-image-2"] }] } }));
    const result = await discoverSupplierCatalog({ siteUrl: "https://site.example.com", apiUrl: "", kind: "sub2api" }, fetcher);
    expect(result.groups[0]?.models).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("asks for a site login token when the key-page group list is gated", async () => {
    const result = await discoverSupplierCatalog({ siteUrl: "https://site.example.com", apiUrl: "", kind: "sub2api" }, async (url) =>
      String(url).endsWith("/model-plaza") ? Response.json({ data: { groups: [] } }) : Response.json({}, { status: 401 }));
    expect(result.status).toBe("unauthorized");
    expect(result.error).toContain("API 密钥");
    expect(result.error).toContain("站点账号密码");
  });

  it("does not mistake error envelopes or key-list objects for groups", () => {
    expect(parseSupplierKeyGroups({ code: 401, data: [{ name: "wrong" }] }, "sub2api")).toBeNull();
    expect(parseSupplierKeyGroups({ success: false, data: { wrong: { ratio: 1 } } }, "newapi")).toBeNull();
    expect(parseSupplierKeyGroups({ data: { keys: [{ key: "secret", name: "my key" }] } }, "sub2api")).toBeNull();
    expect(parseSupplierKeyGroups({ data: { message: "login needed" } }, "newapi")).toBeNull();
    expect(parseSupplierKeyGroups({ data: [] }, "sub2api")).toEqual([]);
  });
});
