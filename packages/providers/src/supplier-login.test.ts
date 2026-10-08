import {
  constants,
  createDecipheriv,
  generateKeyPairSync,
  privateDecrypt,
} from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const network = vi.hoisted(() => ({
  lookup: vi.fn(async (hostname: string, _options?: unknown) => {
    // Preserve the real-host scope test without sending a DNS request.
    if (hostname !== "tk1688.com") throw new Error("Unexpected DNS in supplier login test");
    return [{ address: "203.0.113.10", family: 4 }];
  }),
  fetch: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
import { loginSupplierSite } from "./supplier-login.js";
import { discoverSupplierCatalog } from "./supplier-catalog.js";
import { readSupplierBilling } from "../../../apps/desktop/renderer/lib/supplier-billing-read.js";

beforeEach(() => {
  network.lookup.mockClear();
  network.fetch.mockReset().mockRejectedValue(new Error("Unexpected HTTP in supplier login test"));
  vi.stubGlobal("fetch", network.fetch);
});
afterEach(() => {
  try {
    expect(network.fetch).not.toHaveBeenCalled();
    expect(network.lookup.mock.calls.every(([hostname]) => hostname === "tk1688.com")).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});

const siteUrl = "https://site.test/gateway/keys";
const credentials = {
  username: " user@example.com ",
  password: " password with spaces ",
};

describe("supplier website access token", () => {
  const base = "https://site.test/gateway";
  const accessToken = "fake-dashboard-token";
  it("forwards词元 website credentials only to its exact GET account model inventory", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json({ success: true, data: { id: 42 } }));
    const session = await loginSupplierSite({ siteUrl: "https://tk1688.com", kind: "newapi", credentials: { accessToken } }, fetcher);
    expect(network.lookup).toHaveBeenCalledExactlyOnceWith("tk1688.com", { all: true, verbatim: true });
    await session.fetch("https://tk1688.com/api/user/models", { method: "GET" });
    expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).get("authorization")).toBe(`Bearer ${accessToken}`);
    expect(fetcher.mock.calls.at(-1)?.[1]?.redirect).toBe("error");
    for (const [url, method] of [["https://tk1688.com/api/user/models", "POST"], ["https://api.tk1688.com/api/user/models", "GET"],
      ["https://tk1688.com/api/user/models?redirect=leak", "GET"]]) {
      await session.fetch(url!, { method });
      expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).get("authorization")).toBeNull();
    }
  });

  it.each(["newapi", "sub2api"] as const)("validates %s with a same-site GET and creates a bounded bearer session", async kind => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ success: true, code: 0, data: { id: 42 } }));
    const session = await loginSupplierSite({ siteUrl, kind, credentials: { accessToken, userId: "42" } }, fetcher);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(base + (kind === "newapi" ? "/api/user/self" : "/api/v1/user/profile"));
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.redirect).toBe("error");
    const firstHeaders = new Headers(init?.headers);
    expect(firstHeaders.get("authorization")).toBe(`Bearer ${accessToken}`);
    expect(firstHeaders.get("New-Api-User")).toBe(kind === "newapi" ? "42" : null);
    await session.fetch(base + (kind === "newapi" ? "/api/user/self/groups" : "/api/v1/groups/available"));
    expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).get("authorization")).toBe(`Bearer ${accessToken}`);
    expect(fetcher.mock.calls.at(-1)?.[1]?.redirect).toBe("error");
    expect(fetcher.mock.calls.every(([, request]) => request?.method !== "POST")).toBe(true);
  });

  it("supports current NewAPI and OneAPI without requiring a user ID and accepts a copied bearer value", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, _init?: RequestInit) =>
      Response.json(String(url).endsWith("/api/status") ? { data: { system_name: "One API" } }
        : { success: true, data: { id: 42 } }));
    const session = await loginSupplierSite({ siteUrl, kind: "auto", credentials: { accessToken: `  Bearer ${accessToken}  ` } }, fetcher);
    expect(session.kind).toBe("newapi");
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("authorization")).toBeNull();
    const validationHeaders = new Headers(fetcher.mock.calls[1]?.[1]?.headers);
    expect(validationHeaders.get("authorization")).toBe(`Bearer ${accessToken}`);
    expect(validationHeaders.get("New-Api-User")).toBeNull();
    await session.fetch(base + "/api/token/?p=0&page_size=100");
    expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).get("New-Api-User")).toBe("42");
  });

  it.each([200, 401])("explains the missing user ID only when an older NewAPI actually requests it (HTTP %s)", async status => {
    await expect(loginSupplierSite({ siteUrl, kind: "newapi", credentials: { accessToken } }, async () =>
      Response.json({ success: false, message: "无权进行此操作，未提供 New-Api-User" }, { status }),
    )).rejects.toMatchObject({ code: "user_id_required", status: 400, retryable: false, message: expect.stringContaining("用户 ID") });
  });

  it.each([
    { status: 401, code: "invalid_token", retryable: false },
    { status: 403, code: "permission_denied", retryable: false },
    { status: 429, code: "rate_limited", retryable: true },
    { status: 503, code: "network", retryable: true },
    { status: 404, code: "unsupported_platform", retryable: false },
  ])("classifies token verification HTTP $status without exposing the token or remote error", async ({ status, code, retryable }) => {
    const pending = loginSupplierSite({ siteUrl, kind: "sub2api", credentials: { accessToken } }, async () =>
      Response.json({ message: `echo ${accessToken}` }, { status }));
    await expect(pending).rejects.toMatchObject({ code, retryable });
    await expect(pending).rejects.not.toThrow(accessToken);
  });

  it.each([
    { payload: { success: false, message: "access token 无效" }, code: "invalid_token" },
    { payload: { success: false, message: "无权进行此操作，权限不足" }, code: "permission_denied" },
    { payload: { success: false, code: "ACCESS_TOKEN_SCOPE_DENIED", message: "private scope" }, code: "permission_denied" },
    { payload: { code: 401, message: "expired access token" }, code: "invalid_token" },
    { payload: { error: { code: "INVALID_TOKEN", message: "private token" } }, code: "invalid_token" },
  ])("rejects an HTTP 200 failed authentication as $code", async ({ payload, code }) => {
    await expect(loginSupplierSite({ siteUrl, kind: "newapi", credentials: { accessToken } }, async () =>
      Response.json(payload),
    )).rejects.toMatchObject({ code, retryable: false });
  });

  it.each([
    { accessToken: "" }, { accessToken: "Bearer " }, { accessToken: "token\r\nprivate-header: secret" },
    { accessToken, userId: "0" }, { accessToken, userId: "-1" }, { accessToken, userId: "42x" },
    { accessToken, userId: "9223372036854775808" },
  ])("rejects malformed token credentials locally before any request", async input => {
    const fetcher = vi.fn();
    await expect(loginSupplierSite({ siteUrl, kind: "newapi", credentials: input }, fetcher))
      .rejects.toMatchObject({ code: "invalid_configuration", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a mismatched user ID or incomplete account payload without echoing the returned profile", async () => {
    for (const data of [{ id: 7, access_token: accessToken }, { access_token: accessToken }]) {
      const pending = loginSupplierSite({ siteUrl, kind: "newapi", credentials: { accessToken, userId: "42" } }, async () =>
        Response.json({ success: true, data }));
      await expect(pending).rejects.toMatchObject({ code: "invalid_configuration", retryable: false });
      await expect(pending).rejects.not.toThrow(accessToken);
    }
  });

  it.each(["newapi", "sub2api"] as const)("confines %s tokens to allowed account endpoints and never replaces a generation key", async kind => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ success: true, code: 0, data: { id: 42 } }));
    const session = await loginSupplierSite({ siteUrl, kind, credentials: { accessToken } }, fetcher);
    const allowed = kind === "newapi" ? [
      [base + "/api/pricing", "GET"], [base + "/api/token/?p=0&page_size=10", "GET"],
      [base + "/api/token/42/key", "POST"], [base + "/api/log/self/?request_id=request-42", "GET"],
    ] : [
      [base + "/api/v1/model-plaza", "GET"], [base + "/api/v1/keys?page=1&page_size=10", "GET"],
      [base + "/api/v1/keys/42", "GET"], [base + "/api/v1/usage?request_id=request-42", "GET"],
    ];
    for (const [url, method] of allowed) {
      await session.fetch(url!, { method });
      expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).get("authorization")).toBe(`Bearer ${accessToken}`);
      expect(fetcher.mock.calls.at(-1)?.[1]?.redirect).toBe("error");
    }
    for (const [url, method] of [
      ["https://api.test/v1/images/generations", "POST"],
      [base + "/v1/images/generations", "POST"], [base + "/v1/models", "GET"],
      [base + "/api/token/42/key?redirect=leak", "POST"], [base + "/api/token/42/key", "GET"],
      [base + "/api/pricing#fragment", "GET"], [base + "/api/pricing?redirect=leak", "GET"],
      [base + "/api/v1/keys/42", "DELETE"], [base + "/api/v1/keys?page=all", "GET"],
      ["https://other.test/api/user/self", "GET"], ["https://site.test/api/user/self", "GET"],
      ["https://user:pass@site.test/gateway/api/user/self", "GET"],
    ]) {
      await session.fetch(url!, { method });
      const headers = new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers);
      expect(headers.get("authorization")).toBeNull();
      expect(headers.get("cookie")).toBeNull();
      expect(headers.get("New-Api-User")).toBeNull();
    }
    const request = new Request(base + "/v1/images/generations", { method: "POST", headers: { authorization: "Bearer fake-generation-key" } });
    await session.fetch(request);
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe(request);
    expect(request.headers.get("authorization")).toBe("Bearer fake-generation-key");
    expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).get("authorization")).toBeNull();
  });

  it("never follows a redirect during token verification and sanitizes fetch failures", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      throw new Error(`redirect contained ${accessToken}`);
    });
    const pending = loginSupplierSite({ siteUrl, kind: "newapi", credentials: { accessToken } }, fetcher);
    await expect(pending).rejects.toMatchObject({ code: "network", retryable: true });
    await expect(pending).rejects.not.toThrow(accessToken);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("NewAPI account today-stat session", () => {
  const base = "https://site.test/gateway";
  it.each(["token", "password-bearer", "password-cookie"] as const)("authenticates the actual billing reader's today URL with %s", async mode => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/encryption-key")) return Response.json({}, { status: 404 });
      if (path.endsWith("/api/user/login")) return Response.json({ success: true,
        data: mode === "password-cookie" ? { id: 42 } : { access_token: "fake-session-token", user: { id: 42 } },
      }, { headers: { "set-cookie": "session=fake-cookie; HttpOnly; Path=/" } });
      if (path.endsWith("/api/user/self")) return Response.json({ success: true, data: { id: 42, quota: 1000, used_quota: 200 } });
      if (path.endsWith("/api/status")) return Response.json({ success: true, data: { quota_per_unit: 100, quota_display_type: "USD" } });
      if (path.endsWith("/api/log/self/stat")) {
        const headers = new Headers(init?.headers);
        const authenticated = mode === "password-cookie" ? headers.get("cookie") === "session=fake-cookie"
          : headers.get("authorization") === "Bearer fake-session-token";
        return authenticated ? Response.json({ success: true, data: { quota: 50 } }) : Response.json({}, { status: 401 });
      }
      return Response.json({});
    });
    const session = await loginSupplierSite({ siteUrl, kind: "newapi",
      credentials: mode === "token" ? { accessToken: "fake-session-token" } : credentials }, fetcher);
    const billing = await readSupplierBilling({ siteUrl, sourceId: "fake-source", kind: "newapi" }, session.fetch);
    expect(billing).toMatchObject({ todayStatus: "live", todayUsed: .5, status: "live" });
    const [statUrl, statInit] = fetcher.mock.calls.find(([url]) => String(url).includes("/api/log/self/stat"))!;
    const parsed = new URL(String(statUrl));
    expect(parsed.pathname).toBe("/gateway/api/log/self/stat");
    expect([...parsed.searchParams.keys()]).toEqual(["type", "start_timestamp", "end_timestamp"]);
    expect(parsed.searchParams.get("type")).toBe("2");
    expect(parsed.searchParams.get("start_timestamp")).toMatch(/^[1-9]\d*$/u);
    expect(parsed.searchParams.get("end_timestamp")).toMatch(/^[1-9]\d*$/u);
    expect(statInit?.method).toBe("GET");
    expect(statInit?.redirect).toBe("error");
    expect(new Headers(statInit?.headers).get("New-Api-User")).toBe("42");
    for (const [url, method] of [
      [base + "/api/log/self/stat?type=2&start_timestamp=1790784000&end_timestamp=1790810000", "POST"],
      [base + "/api/log/self/stat", "GET"],
      [base + "/api/log/self/stat?type=2&end_timestamp=1790810000", "GET"],
      [base + "/api/log/self/stat?type=0&start_timestamp=1790784000&end_timestamp=1790810000", "GET"],
      [base + "/api/log/self/stat?type=2&start_timestamp=-1&end_timestamp=1790810000", "GET"],
      [base + "/api/log/self/stat?type=2&start_timestamp=0&end_timestamp=1790810000", "GET"],
      [base + "/api/log/self/stat?type=2&start_timestamp=1790784000&end_timestamp=1.5", "GET"],
      [base + "/api/log/self/stat?type=2&start_timestamp=1790784000&end_timestamp=1e9", "GET"],
      [base + "/api/log/self/stat?type=2&start_timestamp=1790784000&end_timestamp=1790810000&redirect=leak", "GET"],
      [base + "/api/log/self/stat?type=2&type=2&start_timestamp=1790784000&end_timestamp=1790810000", "GET"],
      [base + "/api/log/self/stat?type=2&start_timestamp=1790784000&end_timestamp=1790810000#fragment", "GET"],
      ["https://other.test/api/log/self/stat?type=2&start_timestamp=1790784000&end_timestamp=1790810000", "GET"],
      [base + "/api/log/self/stat/?type=2&start_timestamp=1790784000&end_timestamp=1790810000", "GET"],
    ]) {
      await session.fetch(url!, { method });
      const headers = new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers);
      expect(headers.get("authorization")).toBeNull();
      expect(headers.get("cookie")).toBeNull();
      expect(headers.get("New-Api-User")).toBeNull();
    }
  });
});

describe("supplier website login", () => {
  it.each([
    { status: 429, code: "rate_limited" },
    { status: 503, code: "network" },
  ])("does not mislabel HTTP $status during auto detection as an unsupported platform", async ({ status, code }) => {
    const fetcher = vi.fn(async () => Response.json({}, { status }));
    await expect(loginSupplierSite({ siteUrl, kind: "auto", credentials }, fetcher))
      .rejects.toMatchObject({ code, retryable: true });
    expect(fetcher.mock.calls).toHaveLength(2);
  });
  it.each([
    { status: 429, code: "rate_limited", retryable: true },
    { status: 403, code: "verification_required", retryable: false },
    { status: 401, code: "invalid_credentials", retryable: false },
    { status: 503, code: "network", retryable: true },
  ])("classifies HTTP $status login failures for the appropriate recovery action", async ({ status, code, retryable }) => {
    await expect(loginSupplierSite({ siteUrl, kind: "sub2api", credentials }, async () =>
      Response.json({ message: "private echoed content" }, { status }),
    )).rejects.toMatchObject({ code, retryable });
  });
  it.each(["newapi", "sub2api"] as const)("authenticates bounded %s billing reads without forwarding credentials elsewhere", async kind => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ success: true, data: { access_token: "session-secret", user: { id: 42 } } }));
    const session = await loginSupplierSite({ siteUrl, kind, credentials }, fetcher);
    const base = "https://site.test/gateway";
    const profile = kind === "newapi" ? "/api/user/self" : "/api/v1/user/profile";
    const usage = kind === "newapi" ? "/api/log/self/" : "/api/v1/usage";
    for (const path of [profile, usage + "?p=0&page_size=100&type=2&request_id=request-123", ...(kind === "sub2api" ? ["/api/v1/usage/dashboard/stats"] : [])]) {
      await session.fetch(base + path);
      expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).get("authorization")).toBe("Bearer session-secret");
      expect(fetcher.mock.calls.at(-1)?.[1]?.redirect).toBe("error");
    }
    for (const [url, method] of [
      [base + usage, "POST"], [base + profile + "?redirect=https://other.test", "GET"],
      [base + usage + "?callback=leak", "GET"], [base + usage + "?page=all", "GET"],
      [base + usage + "?request_id=a#fragment", "GET"],
      [base + "/api/v1/usage/dashboard/stats?redirect=leak", "GET"],
      [base + "/api/v1/usage/dashboard/stats", "POST"],
      ["https://other.test" + usage, "GET"], [base + "/api/log/", "GET"],
    ]) {
      await session.fetch(url!, { method });
      const headers = new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers);
      expect(headers.get("authorization")).toBeNull();
      expect(headers.get("cookie")).toBeNull();
    }
  });
  it("logs into Sub2API and falls back to key groups with a session confined to that site", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/auth/login"))
          return Response.json({
            code: 0,
            data: { access_token: "session-secret" },
          });
        if (String(url).endsWith("/groups/available"))
          return Response.json({ code: 0, data: [{ id: 5, name: "图像组" }] });
        return Response.json({ code: 0, data: { groups: [] } });
      },
    );
    const session = await loginSupplierSite(
      { siteUrl, kind: "sub2api", credentials },
      fetcher,
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      email: "user@example.com",
      password: credentials.password,
    });
    expect(calls[0]?.init?.redirect).toBe("error");
    const result = await discoverSupplierCatalog(
      { siteUrl, apiUrl: "https://api.test", kind: session.kind },
      session.fetch,
    );
    expect(result.groups).toMatchObject([{ id: "图像组" }]);
    const groupCall = calls.find((call) =>
      call.url.endsWith("/groups/available"),
    )!;
    expect(new Headers(groupCall.init?.headers).get("authorization")).toBe(
      "Bearer session-secret",
    );
    for (const url of [
      "https://api.test/api/v1/groups/available",
      "https://site.test/gateway/v1/models",
      "https://site.test/api/v1/groups/available",
    ]) {
      await session.fetch(url);
      expect(
        new Headers(calls.at(-1)?.init?.headers).get("authorization"),
      ).toBeNull();
    }
  });

  it.each([false, true])(
    "supports legacy NewAPI cookies and current bearer sessions (bearer=%s)",
    async (bearer) => {
      const fetcher = vi.fn(
        async (url: string | URL | Request, _init?: RequestInit) => {
          if (String(url).endsWith("/encryption-key"))
            return Response.json({}, { status: 404 });
          return Response.json(
            {
              success: true,
              data: bearer
                ? { access_token: "new-token", user: { id: 42 } }
                : { id: 42 },
            },
            {
              headers: { "set-cookie": "session=old-cookie; HttpOnly; Path=/" },
            },
          );
        },
      );
      const session = await loginSupplierSite(
        { siteUrl, kind: "newapi", credentials },
        fetcher,
      );
      await session.fetch(
        "https://site.test/gateway/api/user/self/groups",
      );
      const headers = new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers);
      expect(headers.get("New-Api-User")).toBe("42");
      expect(headers.get(bearer ? "authorization" : "cookie")).toBe(
        bearer ? "Bearer new-token" : "session=old-cookie",
      );
    },
  );

  it.each(["short-password", "长密码".repeat(100)])(
    "honors NewAPI password encryption for %s",
    async (password) => {
      const { publicKey, privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
      });
      let posted: Record<string, string> = {};
      const fetcher = vi.fn(
        async (url: string | URL | Request, init?: RequestInit) => {
          if (String(url).endsWith("/encryption-key"))
            return Response.json({
              success: true,
              data: {
                enabled: true,
                kid: "key-id",
                public_key: publicKey.export({ type: "spki", format: "pem" }),
              },
            });
          posted = JSON.parse(String(init?.body));
          return Response.json({
            success: true,
            data: { access_token: "token", user: { id: 42 } },
          });
        },
      );
      await loginSupplierSite(
        { siteUrl, kind: "newapi", credentials: { ...credentials, password } },
        fetcher,
      );
      expect(posted.password).toBeUndefined();
      expect(posted.encryption_key_id).toBe("key-id");
      const options = {
        key: privateKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      };
      const encrypted = posted.password_encrypted!;
      if (encrypted.startsWith("v2.")) {
        const [, wrapped, nonce, data] = encrypted.split(".");
        const secret = privateDecrypt(
          { ...options, oaepLabel: Buffer.from("password-v2") },
          Buffer.from(wrapped!, "base64"),
        );
        const bytes = Buffer.from(data!, "base64");
        const decipher = createDecipheriv(
          "aes-256-gcm",
          secret,
          Buffer.from(nonce!, "base64"),
        );
        decipher.setAAD(Buffer.from("password-v2:key-id"));
        decipher.setAuthTag(bytes.subarray(-16));
        expect(
          Buffer.concat([
            decipher.update(bytes.subarray(0, -16)),
            decipher.final(),
          ]).toString(),
        ).toBe(password);
      } else
        expect(
          privateDecrypt(options, Buffer.from(encrypted, "base64")).toString(),
        ).toBe(password);
    },
  );

  it.each(["newapi", "sub2api"] as const)(
    "detects %s before posting credentials",
    async (kind) => {
      const fetcher = vi.fn(
        async (url: string | URL | Request, _init?: RequestInit) => {
          if (String(url).endsWith("/api/status"))
            return Response.json(
              kind === "newapi" ? { data: { system_name: "Example" } } : {},
            );
          if (String(url).endsWith("/setup/status"))
            return Response.json({ code: 0, data: { needs_setup: false } });
          if (String(url).endsWith("/encryption-key"))
            return Response.json({ success: true, data: { enabled: false } });
          return Response.json({
            success: true,
            code: 0,
            data: { access_token: "token", user: { id: 1 } },
          });
        },
      );
      expect(
        (
          await loginSupplierSite(
            { siteUrl, kind: "auto", credentials },
            fetcher,
          )
        ).kind,
      ).toBe(kind);
      expect(
        fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
      ).toHaveLength(1);
    },
  );

  it("does not post credentials when the platform cannot be identified", async () => {
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        Response.json({}),
    );
    await expect(
      loginSupplierSite({ siteUrl, kind: "auto", credentials }, fetcher),
    ).rejects.toMatchObject({ code: "unsupported_platform", retryable: false });
    expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(
      true,
    );
  });

  it.each([
    { code: 400, message: "password echoed secret" },
    { code: 0, data: { requires_2fa: true, temp_token: "secret" } },
    { code: 0, data: {} },
  ])(
    "rejects failed or incomplete login without echoing sensitive responses",
    async (payload) => {
      await expect(
        loginSupplierSite({ siteUrl, kind: "sub2api", credentials }, async () =>
          Response.json(payload),
        ),
      ).rejects.toThrow(/登录|验证/u);
      try {
        await loginSupplierSite(
          { siteUrl, kind: "sub2api", credentials },
          async () => Response.json(payload),
        );
      } catch (error) {
        expect(String(error)).not.toContain("secret");
      }
    },
  );
});
