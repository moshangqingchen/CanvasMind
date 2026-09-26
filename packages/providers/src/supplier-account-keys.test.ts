import { describe, expect, it, vi } from "vitest";
import { readSupplierAccountKeys } from "./supplier-account-keys.js";
import { loginSupplierSite } from "./supplier-login.js";

const siteUrl = "https://site.example.com/gateway";
const key = "sk-full-secret-for-account-import";
describe("account key discovery", () => {
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
    expect(fetcher).toHaveBeenCalledTimes(3);
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
      [`https://evil.example.com${path}`, "GET"],
      [`${siteUrl}${path}`, "DELETE"],
      [`${siteUrl}/api/token/`, "POST"],
      [`${siteUrl}/api/v1/keys`, "POST"],
      [`${siteUrl}${path}&redirect=https://evil.example.com`, "GET"],
    ]) {
      await session.fetch(url!, { method });
      expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).get("authorization")).toBeNull();
    }
  });
});
