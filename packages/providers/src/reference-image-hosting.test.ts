import { describe, expect, it, vi } from "vitest";
import { uploadTemporaryReferenceImages } from "./reference-image-hosting";
import { GenericRestAdapter } from "./rest";
import { StaticConnectionResolver } from "./credentials";
import type { NormalizedRequest } from "./contracts";

const assets = [1, 2].map(id => ({ id: `image-${id}`, kind: "image" as const, mimeType: "image/png", data: new Uint8Array([id, 2, 3]), role: "reference" as const, filename: "private-filename.png" }));
const connector = { auth: { type: "bearer" as const }, assetsRequirePublicUrls: true,
  submit: { path: "/v1/images/edits", method: "POST" as const, bodyMode: "json" as const,
    mappings: [{ target: "/images", source: { kind: "assets" as const, assetKind: "image" as const } }] },
  output: { path: "$.data", urlPath: "url", kind: "image" as const },
};
const request: NormalizedRequest = { connectionId: "cang", operation: "image.edit", model: "gpt-image-2", prompt: "edit", assets, idempotencyKey: "isolated-hosting" };
const adapter = (fetch: typeof globalThis.fetch, enabled = true) => new GenericRestAdapter(new StaticConnectionResolver([
  { id: "cang", provider: "rest", baseUrl: "https://provider.test", apiKey: "provider-key-stays-at-provider", settings: { connector, ...(enabled ? { referenceImageHosting: "litterbox-24h" } : {}) } },
]), { fetch });

describe("temporary reference images", () => {
  it("uploads in reference order without keys or original names, then submits URLs only", async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (url, init) => {
      calls.push(String(url));
      if (String(url).includes("litterbox.catbox.moe")) {
        expect(new Headers(init?.headers).has("authorization")).toBe(false);
        const form = init?.body as FormData;
        expect(form.get("reqtype")).toBe("fileupload");
        expect(form.get("time")).toBe("24h");
        expect((form.get("fileToUpload") as File).name).toBe("reference.png");
        const bytes = new Uint8Array(await (form.get("fileToUpload") as File).arrayBuffer());
        return new Response(`https://litter.catbox.moe/ref-${bytes[0]}.png`);
      }
      expect(JSON.parse(String(init?.body))).toEqual({ images: ["https://litter.catbox.moe/ref-1.png", "https://litter.catbox.moe/ref-2.png"] });
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer provider-key-stays-at-provider");
      return Response.json({ data: [{ url: "https://provider.test/result.png" }] });
    }) as typeof globalThis.fetch;
    expect((await adapter(fetch).submit(request)).status).toBe("succeeded");
    expect(calls).toHaveLength(3);
    expect(assets[0]).not.toHaveProperty("url");
  });
  it("does not upload or generate without opt-in", async () => {
    const fetch = vi.fn();
    await expect(adapter(fetch, false).submit(request)).rejects.toThrow(/启用参考图临时链接/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("stops before paid submission on upload failure or a non-host URL", async () => {
    for (const response of [() => new Response("blocked", { status: 503 }), () => new Response("https://127.0.0.1/file.png")]) {
      const fetch = vi.fn(async () => response());
      await expect(adapter(fetch).submit(request)).rejects.toThrow(/当前生成尚未提交/);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(String(fetch.mock.calls[0]?.[0])).toContain("litterbox.catbox.moe");
    }
  });
  it("rejects unsupported local media before uploading any images", async () => {
    const fetch = vi.fn();
    await expect(uploadTemporaryReferenceImages([...assets, { ...assets[0]!, kind: "video" }], fetch)).rejects.toThrow(/仅支持本地参考图片/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
