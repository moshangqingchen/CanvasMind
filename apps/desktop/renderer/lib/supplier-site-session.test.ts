import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupplierRecord } from "@super-canvas/db";
vi.mock("@super-canvas/providers", async original => ({
  ...(await original<typeof import("@super-canvas/providers")>()),
  loginSupplierSite: vi.fn(),
}));
import { encryptSecret, loginSupplierSite, SupplierLoginError } from "@super-canvas/providers";
import { requireServerMasterKey } from "./master-key";
import { openSupplierSiteSession, supplierSiteLoginCacheIdentity } from "./supplier-site-session";

const site: Pick<SupplierRecord, "siteUrl" | "kind" | "state"> = {
  siteUrl: "https://session.invalid", kind: "newapi",
  state: { version: 1, revision: 1, visibility: "visible", sourceId: "source", fingerprint: "fingerprint", history: [] },
};
const encrypted = (secret: string) => encryptSecret(secret, requireServerMasterKey());
beforeEach(() => { vi.mocked(loginSupplierSite).mockReset().mockResolvedValue({ kind: "newapi", fetch: vi.fn() }); });

describe("server-only supplier site sessions", () => {
  it("reads legacy password records without an auth mode or migration write", async () => {
    const login = { username: "account", encryptedPassword: encrypted("fixture-password"), siteUrl: site.siteUrl };
    const input = { ...site, state: { ...site.state!, siteLogin: login } };
    await openSupplierSiteSession(input);
    expect(login).not.toHaveProperty("authMode");
    expect(loginSupplierSite).toHaveBeenCalledWith({ siteUrl: site.siteUrl, kind: "newapi", credentials: { username: "account", password: "fixture-password" } });
  });
  it("opens only the stored token branch and rejects reuse at another site", async () => {
    const login = { authMode: "access-token" as const, encryptedAccessToken: encrypted("fixture-site-token"), siteUrl: site.siteUrl, userId: "42" };
    const input = { ...site, state: { ...site.state!, siteLogin: login } };
    await openSupplierSiteSession(input);
    expect(loginSupplierSite).toHaveBeenCalledWith({ siteUrl: site.siteUrl, kind: "newapi", credentials: { accessToken: "fixture-site-token", userId: "42" } });
    expect(await openSupplierSiteSession({ ...input, siteUrl: "https://another.invalid" })).toBeUndefined();
    expect(loginSupplierSite).toHaveBeenCalledTimes(1);
    expect(supplierSiteLoginCacheIdentity(login)).toEqual(["access-token", login.encryptedAccessToken, "42"]);
    expect(JSON.stringify(supplierSiteLoginCacheIdentity(login))).not.toContain("fixture-site-token");
  });
  it("retains typed error classification without exposing upstream token messages", async () => {
    vi.mocked(loginSupplierSite).mockRejectedValue(new SupplierLoginError("Bearer fixture-site-token", 403, "permission_denied"));
    const input = { ...site, state: { ...site.state!, siteLogin: { authMode: "access-token" as const, encryptedAccessToken: encrypted("fixture-site-token"), siteUrl: site.siteUrl } } };
    const error = await openSupplierSiteSession(input).catch(error => error);
    expect(error).toMatchObject({ code: "permission_denied", status: 403, retryable: false });
    expect(error.message).not.toContain("fixture-site-token");
  });
  it("preserves the provider's fixed hint when the supplied user ID belongs to another account", async () => {
    const message = "用户 ID 与访问令牌对应账号不一致，请检查后台用户 ID";
    vi.mocked(loginSupplierSite).mockRejectedValue(new SupplierLoginError(message, 400, "invalid_configuration"));
    const input = { ...site, state: { ...site.state!, siteLogin: { authMode: "access-token" as const, encryptedAccessToken: encrypted("fixture-site-token"), siteUrl: site.siteUrl, userId: "42" } } };
    await expect(openSupplierSiteSession(input)).rejects.toMatchObject({ message, code: "invalid_configuration" });
  });
});
