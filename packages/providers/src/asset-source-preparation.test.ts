import { describe, expect, it, vi } from "vitest";
import { uploadJiasuMedia } from "./jiasu-media.js";
import { uploadCangyuanMedia } from "./cangyuan-media-upload.server.js";
import { uploadTemporaryReferenceImages } from "./reference-image-hosting.js";
import { StaticConnectionResolver } from "./credentials.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";
import { normalizeJiasuVideoParameters } from "./jiasu-video-contract.js";
import type { ProviderAssetInput } from "./contracts.js";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "203.0.113.1", family: 4 }]) }));
const bytes = new Uint8Array([1, 2, 3, 255]);
const assets: ProviderAssetInput[] = [{ id: "one-original", kind: "image", mimeType: "image/png", data: bytes, role: "lastFrame" },
  { id: "one-original", kind: "image", mimeType: "image/png", data: bytes, role: "firstFrame" }];
const cdn = "https://cdn.test/original.png";

describe("one original with multiple role entries", () => {
  it.each(["jiasu", "cangyuan", "hosting"] as const)("prepares %s once and retains each role and its order", async supplier => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      if (init?.method === "GET") return new Response(bytes, { headers: { "content-type": "image/png" } });
      if (init?.method === "PUT") return new Response(null, { status: 204 });
      if (supplier === "jiasu") {
        expect(JSON.parse(String(init?.body)).items).toHaveLength(1);
        return Response.json({ success: true, data: { items: [{ url: cdn, put: { url: "https://storage.test/put", method: "PUT" } }] } });
      }
      if (supplier === "cangyuan") return Response.json({ upload_url: "https://storage.test/put", url: cdn, expires_in: 900, headers: {} });
      expect(String(url)).toContain("litterbox.catbox.moe");
      return new Response("https://litter.catbox.moe/original.png");
    });
    const original = assets.map(asset => ({ ...asset }));
    const result = supplier === "jiasu" ? await uploadJiasuMedia({ id: "fixture", provider: "rest", baseUrl: "https://ai.jiasuapi.com/v1", apiKey: "fixture" }, assets, { fetch })
      : supplier === "cangyuan" ? await uploadCangyuanMedia({ id: "fixture", provider: "rest", baseUrl: "https://ai.cangyuansuanli.cn/v1", apiKey: "fixture" }, assets, { fetch })
        : await uploadTemporaryReferenceImages(assets, fetch);
    expect(result.map(asset => [asset.id, asset.role])).toEqual([["one-original", "lastFrame"], ["one-original", "firstFrame"]]);
    expect(result[0]?.url).toBe(result[1]?.url);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(supplier === "hosting" ? 0 : 1);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "GET")).toHaveLength(1);
    expect(assets).toEqual(original);
    if (supplier !== "hosting") expect(result.every(asset => asset.data === undefined)).toBe(true);
  });

  it("sends identical frame URLs in both REST role fields in exactly one generation POST", async () => {
    const config: RestConnectorConfig = { models: [{ id: "frames", name: "frames", operations: ["video.image-to-video"] }],
      submit: { path: "/jobs", method: "POST", bodyMode: "json", mappings: [
        { target: "/first", source: { kind: "assets", role: "firstFrame", select: "first" } },
        { target: "/last", source: { kind: "assets", role: "lastFrame", select: "first" } },
      ], response: { taskIdPath: "$.id", statusPath: "$.status" } },
      poll: { path: "/jobs/{taskId}", method: "GET", bodyMode: "none", response: { statusPath: "$.status" } },
      output: { kind: "video", path: "$.url" } };
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ first: cdn, last: cdn });
      return Response.json({ id: "original-job", status: "running" });
    });
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "fixture", provider: "rest", baseUrl: "https://provider.test", apiKey: "synthetic-fixture", settings: { connector: config } }]), { fetch });
    await adapter.submit({ connectionId: "fixture", operation: "video.image-to-video", model: "frames", prompt: "Loop", idempotencyKey: "one-job",
      assets: assets.map(({ data: _data, ...asset }) => ({ ...asset, url: cdn })) });
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("does not let an existing native first frame suppress an explicit last frame with the same URL", () => {
    const parameters = normalizeJiasuVideoParameters({ connectionId: "fixture", operation: "video.image-to-video", model: "sd-2.5-J2", prompt: "Loop", idempotencyKey: "one-job",
      parameters: { images: [{ url: cdn, type: "first_frame" }] }, assets: assets.map(({ data: _data, ...asset }) => ({ ...asset, url: cdn })) });
    expect(parameters.images).toEqual([{ url: cdn, type: "first_frame" }, { url: cdn, type: "end_frame" }]);
  });
});
