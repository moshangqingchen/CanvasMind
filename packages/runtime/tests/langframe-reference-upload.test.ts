import { describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import { encryptSecret, StaticConnectionResolver, type ProviderAssetInput } from "@super-canvas/providers";
import { langframeReferenceUploader } from "../src/langframe-reference-upload.js";

const masterKey = "langframe-upload-fixture", base = "https://vipprompt.cn";
const asset: ProviderAssetInput = { id: "clip", kind: "video", mimeType: "video/mp4", filename: "中文 片段.mp4", data: new Uint8Array([1, 2, 3, 4, 0, 255]) };

async function fixture(authMode: "password" | "access-token" = "password") {
  const repository = new MemoryRepository();
  const supplier = await repository.saveSupplier({ id: "supplier", name: "Wolf fixture", supplierKey: "wolf", kind: "langframe", siteUrl: base, apiUrl: `${base}/v1`, scanStatus: "live", catalog: { groups: [] },
    state: { version: 1, revision: 1, sourceId: "source", fingerprint: "fingerprint", visibility: "visible", history: [], siteLogin: authMode === "password"
      ? { username: "fixture-user", encryptedPassword: encryptSecret("fixture-password", masterKey), siteUrl: base }
      : { authMode: "access-token", encryptedAccessToken: encryptSecret("fixture-dashboard-token", masterKey), siteUrl: base } } });
  const resolver = new StaticConnectionResolver([{ id: "connection", provider: "langframe", apiKey: "sk-lf-never-use-for-site", baseUrl: `${base}/v1`,
    settings: { supplierId: supplier.id, supplierSourceId: "source" } }]);
  return { repository, resolver, supplier };
}

describe("Langframe original-byte website uploads", () => {
  it.each(["password", "access-token"] as const)("uses the saved %s website session without sending the SK or rewriting account state", async authMode => {
    const f = await fixture(authMode), before = await f.repository.getSupplier("supplier");
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/api/auth/login")) return Response.json({ ok: true, token: "fixture-dashboard-token" });
      if (String(url).endsWith("/api/me")) return Response.json({ ok: true, user: { account: "fixture-user", credits: 0 } });
      if (init?.method === "GET") return new Response(asset.data!, { headers: { "content-type": asset.mimeType } });
      return Response.json({ ok: true, url: "/uploads/original.mp4" });
    };
    const upload = langframeReferenceUploader(f.repository, f.resolver, () => masterKey, fetcher);
    expect(await upload("connection", asset)).toBe(`${base}/uploads/original.mp4`);
    expect(await f.repository.getSupplier("supplier")).toEqual(before);
    const last = calls.find(call => call.url.endsWith("/api/canvas/media-upload"))!;
    expect(last.url).toBe(`${base}/api/canvas/media-upload`);
    expect(last.init?.method).toBe("POST");
    expect(new Headers(last.init?.headers).get("authorization")).toBe("Bearer fixture-dashboard-token");
    expect(new Headers(last.init?.headers).get("x-media-kind")).toBe("video");
    expect(new Headers(last.init?.headers).get("x-file-name")).toBe(encodeURIComponent("中文 片段.mp4"));
    expect(new Headers(last.init?.headers).get("content-type")).toBe("application/octet-stream");
    expect(last.init?.body).toEqual(asset.data);
    expect(JSON.stringify(calls)).not.toContain("sk-lf-never-use-for-site");
    expect(calls.at(-1)?.url).toBe(`${base}/uploads/original.mp4`);
    expect(new Headers(calls.at(-1)?.init?.headers).has("authorization")).toBe(false);
  });

  it.each(["source", "site", "deleted"])("rejects a changed %s before sending saved credentials or bytes", async change => {
    const f = await fixture(), fetcher = vi.fn<typeof fetch>();
    await f.repository.saveSupplier({ ...f.supplier,
      ...(change === "site" ? { siteUrl: "https://other.invalid" } : {}),
      state: { ...f.supplier.state!, ...(change === "source" ? { sourceId: "new-source" } : {}), ...(change === "deleted" ? { visibility: "deleted" as const } : {}) } });
    await expect(langframeReferenceUploader(f.repository, f.resolver, () => masterKey, fetcher)("connection", asset)).rejects.toThrow("同一供应商来源");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not expose untrusted upload error messages or count a failed upload as successful", async () => {
    const f = await fixture("access-token");
    const fetcher: typeof fetch = async url => String(url).endsWith("/api/me")
      ? Response.json({ ok: true, user: { account: "fixture-user" } })
      : Response.json({ ok: false, error: "Bearer fixture-dashboard-token" }, { status: 403 });
    const error = await langframeReferenceUploader(f.repository, f.resolver, () => masterKey, fetcher)("connection", asset).catch(error => error);
    expect(error.message).toContain("HTTP 403");
    expect(error.message).not.toContain("fixture-dashboard-token");
  });
  it.each([
    { name: "missing", response: () => new Response("missing", { status: 404 }) },
    { name: "HTML", response: () => new Response("login", { headers: { "content-type": "text/html" } }) },
    { name: "corrupt", response: () => new Response(new Uint8Array([9, 2, 3, 4, 0, 255]), { headers: { "content-type": asset.mimeType } }) },
    { name: "truncated", response: () => new Response(new Uint8Array([1, 2]), { headers: { "content-type": asset.mimeType } }) },
  ])("rejects a $name uploaded original without exposing login credentials", async sample => {
    const f = await fixture("access-token"), fetcher = vi.fn<typeof fetch>(async (url, init) => String(url).endsWith("/api/me")
      ? Response.json({ ok: true, user: { account: "fixture-user" } }) : init?.method === "GET" ? sample.response()
        : Response.json({ ok: true, url: "/uploads/original.mp4" }));
    const error = await langframeReferenceUploader(f.repository, f.resolver, () => masterKey, fetcher)("connection", asset).catch(value => value);
    expect(error.message).toContain("素材准备失败，尚未提交生成"); expect(error.stage).toBe("verify");
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/api/canvas/media-upload"))).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/generate"))).toHaveLength(0);
    expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).has("authorization")).toBe(false);
  });
});
