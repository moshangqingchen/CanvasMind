import { describe, expect, it, vi } from "vitest";
import { readSupplierAccountKeys } from "./supplier-account-keys.js";
import { loginSupplierSite } from "./supplier-login.js";

const siteUrl = "https://site.example.test/gateway";
const key = "sk-full-secret-for-account-import";
describe("account key discovery", () => {
  it("reads Langframe's existing Keys once without turning fallback groups into independent Key bindings", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, keys: [
      { id: "707b2ab1-03f2-46d1-8217-b0b2693d2a71", name: "all", revoked: false, groups: [], models: [], token: key },
      { id: "restricted-key", name: "limited", revoked: false, groups: ["B", "A"], models: ["image public name"], token: "sk-another-full-account-import" },
      { id: "revoked", revoked: true, groups: [], models: [], token: "sk-revoked-secret-never-import" },
      { id: "masked", revoked: false, groups: [], models: [], token: "sk-abcd...abcd" },
      { id: "old", revoked: false, groups: [], models: [] },
    ] }));
    const result = await readSupplierAccountKeys({ siteUrl: "https://vipprompt.cn", kind: "langframe" }, fetcher);
    expect(result).toMatchObject({ complete: true, skipped: 3, keys: [
      { id: "707b2ab1-03f2-46d1-8217-b0b2693d2a71", group: "账户 Key 707b2ab1-03f2-46d1-8217-b0b2693d2a71", apiKey: key,
        accountGroups: [], modelIds: [], routing: "ordered-fallback" },
      { id: "restricted-key", accountGroups: ["B", "A"], modelIds: ["image public name"], routing: "ordered-fallback" },
    ] });
    expect(result.keys.every(item => !item.supplierGroupId)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://vipprompt.cn/api/keys");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "GET", redirect: "error" });
  });

  it("never broadens missing or malformed Langframe restrictions to all groups", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, keys: [
      { id: "missing", revoked: false, token: key },
      { id: "wrong", revoked: false, groups: "all", models: [], token: key },
      { id: "bad-model", revoked: false, groups: [], models: [null], token: key },
      { id: "valid", revoked: false, groups: ["second", "first", "second"], models: [], token: key },
    ] }));
    const result = await readSupplierAccountKeys({ siteUrl: "https://www.vipprompt.cn", kind: "langframe" }, fetcher);
    expect(result).toMatchObject({ complete: false, skipped: 3, keys: [{ id: "valid", accountGroups: ["second", "first"], modelIds: [] }] });
    expect(result.error).not.toContain(key);
  });

  it("does not choose an arbitrary Langframe token or scope when a Key identity conflicts", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, keys: [
      { id: "same", revoked: false, groups: ["A"], models: [], token: key },
      { id: "same", revoked: false, groups: ["B"], models: [], token: key },
    ] }));
    const result = await readSupplierAccountKeys({ siteUrl: "https://vipprompt.cn", kind: "langframe" }, fetcher);
    expect(result).toMatchObject({ complete: false, keys: [] });
  });

  it("rejects a failed Langframe list without leaking its server message or creating Keys", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: false, keys: [], error: `private ${key}` }, { status: 403 }));
    const result = await readSupplierAccountKeys({ siteUrl: "https://vipprompt.cn", kind: "langframe" }, fetcher);
    expect(result).toMatchObject({ complete: false, keys: [] });
    expect(result.error).not.toContain(key);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
    const otherSite = vi.fn();
    const rejected = await readSupplierAccountKeys({ siteUrl: "https://other.test", kind: "langframe" }, otherSite);
    expect(rejected.complete).toBe(false);
    expect(otherSite).not.toHaveBeenCalled();
  });

  it("paginates Sub2API keys, resolves group IDs, and skips expired or disabled keys", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("groups/available")) return Response.json({ code: 0, data: [{ id: 4, name: "B4" }] });
      return Response.json({ code: 0, data: { total: 4, items: path.includes("page=1&") ? [
        { id: 1, key, status: "active", group: { name: "B1" } },
        { id: 2, key, status: "inactive", group: { name: "B2" } },
      ] : [
        { id: 3, key, status: "active", expires_at: "2000-01-01", group: { name: "B3" } },
        { id: 4, key, status: "active", group_id: 4 },
      ] } });
    });
    const result = await readSupplierAccountKeys({ siteUrl, kind: "sub2api" }, fetcher);
    expect(result).toMatchObject({ complete: true, skipped: 2 });
    expect(result.keys.map(k => k.group)).toEqual(["B1", "B4"]);
    expect(result.keys.map(k => k.supplierGroupId)).toEqual([undefined, "4"]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("retains numeric Sub2API identity across renamed group labels and rejects conflicting IDs", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).includes("groups/available")
      ? Response.json({ code: 0, data: [{ id: 115, name: "全参生图专线" }, { id: 116, name: "Second" }] })
      : Response.json({ code: 0, data: { total: 4, items: [
        { id: 1, key, status: "active", group_id: "0115", group: { id: 115, name: "高质量生图专线" } },
        { id: 2, key, status: "active", group: { id: "116", name: "Old second" } },
        { id: 3, key, status: "active", group_id: 115, group: { id: 116, name: "Conflicting" } },
        { id: 4, key, status: "active", group: { id: -1, name: "Legacy" } },
      ] } }));
    const result = await readSupplierAccountKeys({ siteUrl, kind: "sub2api" }, fetcher);
    expect(result).toMatchObject({ complete: true, skipped: 1 });
    expect(result.keys).toMatchObject([
      { id: "1", group: "全参生图专线", supplierGroupId: "115" },
      { id: "2", group: "Second", supplierGroupId: "116" },
      { id: "4", group: "Legacy" },
    ]);
    expect(result.keys[2]).not.toHaveProperty("supplierGroupId");
  });

  it("reveals NewAPI masked keys through the read-only endpoint and accepts legacy full keys", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/1/key")) {
        expect(init?.method).toBe("POST");
        return Response.json({ success: true, data: { key } });
      }
      return Response.json({ success: true, data: { total: 3, items: [
        { id: 1, key: "sk-abcd...abcd", status: 1, group: "images" },
        { id: 2, key: "bare-legacy-account-secret", status: 1, group: "chat" },
        { id: 3, key, status: 1, group: "limited", unlimited_quota: false, remain_quota: 0 },
      ] } });
    });
    const result = await readSupplierAccountKeys({ siteUrl, kind: "newapi" }, fetcher);
    expect(result.keys.map(k => k.apiKey)).toEqual([key, "sk-bare-legacy-account-secret"]);
    expect(result.keys.every(k => k.supplierGroupId === undefined)).toBe(true);
    expect(result.skipped).toBe(1);
    expect(result.complete).toBe(true);
  });

  it("never imports masked keys, unbound groups, or a failed reveal response", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).includes("page=")
      ? Response.json({ code: 0, data: { total: 3, items: [
        { id: 1, key: "sk-***masked***", status: "active", group: { name: "images" } },
        { id: 2, key, status: "active", group_id: null },
        { id: 3, key, status: "quota_exhausted", group: { name: "images" } },
      ] } }) : Response.json({ error: key }, { status: 403 }));
    const result = await readSupplierAccountKeys({ siteUrl, kind: "sub2api" }, fetcher);
    expect(result.keys).toEqual([]);
    expect(result.skipped).toBe(3);
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it("reports a later-page failure without leaking upstream secrets or losing earlier keys", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).includes("p=1&")
      ? Response.json({ success: true, data: { total: 2, items: [{ id: 1, key, status: 1, group: "images" }] } })
      : Response.json({ message: `private ${key}` }, { status: 403 }));
    const result = await readSupplierAccountKeys({ siteUrl, kind: "newapi" }, fetcher);
    expect(result).toMatchObject({ complete: false, keys: [{ id: "1" }] });
    expect(result.error).not.toContain(key);
  });

  it("stops a gateway that repeats the same page instead of reading indefinitely", async () => {
    const fetcher = vi.fn(async () => Response.json({ success: true, data: { total: 200, items: [{ id: 1, key, status: 1, group: "images" }] } }));
    const result = await readSupplierAccountKeys({ siteUrl, kind: "newapi" }, fetcher);
    expect(result.complete).toBe(false);
    expect(result.keys).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["sub2api", "newapi"] as const)("scopes %s account credentials to read operations on the exact source", async kind => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => String(url).endsWith("/encryption-key")
      ? Response.json({}, { status: 404 })
      : Response.json({ code: 0, success: true, data: { access_token: "login-secret", user: { id: 42 } } }));
    const session = await loginSupplierSite({ siteUrl, kind, credentials: { username: "user", password: "password" } }, fetcher);
    const path = kind === "sub2api" ? "/api/v1/keys?page=1&page_size=100" : "/api/token/?p=1&page_size=100";
    await session.fetch(`${siteUrl}${path}`, { method: "GET" });
    expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).get("authorization")).toBe("Bearer login-secret");
    expect(fetcher.mock.calls.at(-1)?.[1]?.redirect).toBe("error");
    for (const [url, method] of [
      [`https://evil.example.test${path}`, "GET"],
      [`${siteUrl}${path}`, "DELETE"],
      [`${siteUrl}/api/token/`, "POST"],
      [`${siteUrl}/api/v1/keys`, "POST"],
      [`${siteUrl}${path}&redirect=https://evil.example.test`, "GET"],
    ]) {
      await session.fetch(url!, { method });
      expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).get("authorization")).toBeNull();
    }
  });
});
