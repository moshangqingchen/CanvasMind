import {
  constants,
  createDecipheriv,
  generateKeyPairSync,
  privateDecrypt,
} from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loginSupplierSite } from "./supplier-login.js";
import { discoverSupplierCatalog } from "./supplier-catalog.js";

const siteUrl = "https://site.example.com/gateway/keys";
const credentials = {
  username: " user@example.com ",
  password: " password with spaces ",
};

describe("supplier website login", () => {
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
      { siteUrl, apiUrl: "https://api.example.com", kind: session.kind },
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
      "https://api.example.com/api/v1/groups/available",
      "https://site.example.com/gateway/v1/models",
      "https://site.example.com/api/v1/groups/available",
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
        "https://site.example.com/gateway/api/user/self/groups",
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
    ).rejects.toThrow("无法识别");
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
