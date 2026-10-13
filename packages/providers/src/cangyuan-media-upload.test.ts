import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ProviderAssetInput, NormalizedRequest } from "./contracts.js";
import { cangyuanMediaUploadOrigin, cangyuanOwnMediaUploadAvailable } from "./cangyuan-media-upload-contract.js";
import { uploadCangyuanMedia } from "./cangyuan-media-upload.server.js";
import { cangyuanCurrentModel, cangyuanCurrentTransport } from "./cangyuan-current-models.js";
import { StaticConnectionResolver } from "./credentials.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";
import { cangyuanVideoModel, cangyuanVideoTransport } from "./cangyuan-video-contract.js";

const baseUrl = "https://ai.cangyuansuanli.cn", apiKey = "synthetic-cangyuan-test-token";
const connection = { id: "one", provider: "rest" as const, baseUrl, apiKey };
const image: ProviderAssetInput = { id: "original", kind: "image", mimeType: "image/png", data: new Uint8Array([1, 2, 3, 255]) };
const ticket = { upload_url: "https://storage.example/upload?signed=one", url: "https://storage.example/object", expires_in: 900,
  headers: { "Content-Type": "image/png", "Content-MD5": createHash("md5").update(image.data!).digest("base64"), "x-storage-proof": "signed-value" } };
const response = () => Response.json(ticket);

describe("Cangyuan same-token local media upload", () => {
  it("signs exact MD5 and puts original bytes with only the returned storage headers", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => init?.method === "POST" ? response() : new Response(null, { status: 204 }));
    const remote: ProviderAssetInput = { id: "remote", kind: "image", mimeType: "image/webp", url: "https://images.example/a.webp" };
    const mask = { ...image, id: "mask", role: "mask" as const };
    const result = await uploadCangyuanMedia(connection, [image, remote, mask], { fetch: fetcher });
    expect(fetcher).toHaveBeenCalledTimes(4);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${baseUrl}/v1/images/uploads`);
    expect(new Headers(init!.headers).get("Authorization")).toBe(`Bearer ${apiKey}`);
    expect(JSON.parse(String(init!.body))).toEqual({ bytes: 4, content_type: "image/png", content_md5: ticket.headers["Content-MD5"] });
    const [putUrl, put] = fetcher.mock.calls[1]!;
    expect(putUrl).toBe(ticket.upload_url);
    expect(put!.headers).toEqual(ticket.headers);
    expect(new Headers(put!.headers).has("Authorization")).toBe(false);
    expect(Array.from(put!.body as Uint8Array)).toEqual([1, 2, 3, 255]);
    expect(result.map(asset => asset.id)).toEqual(["original", "remote", "mask"]);
    expect(result[2]).toMatchObject({ role: "mask", url: ticket.url });
    expect(result[0]).not.toHaveProperty("data");
    expect(result[1]).toBe(remote);
    expect(image.data).toEqual(new Uint8Array([1, 2, 3, 255]));
    expect(image.url).toBeUndefined();
  });

  it.each(["video/mp4", "video/webm", "audio/wav", "audio/mpeg", "audio/mp4"])("uses the documented common signing route for %s", async mimeType => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => init?.method === "POST" ? response() : new Response(null, { status: 204 }));
    const kind = mimeType.startsWith("video/") ? "video" : "audio";
    await uploadCangyuanMedia(connection, [{ ...image, kind, mimeType }], { fetch: fetcher });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body)).content_type).toBe(mimeType);
  });

  it("validates all assets before signing anything", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const bad of [{ ...image, mimeType: "image/gif" }, { ...image, data: new Uint8Array(20 * 1024 * 1024 + 1) }, { ...image, data: new Uint8Array() }])
      await expect(uploadCangyuanMedia(connection, [image, bad], { fetch: fetcher })).rejects.toThrow(/直传/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { ...ticket, upload_url: "http://storage.example/put" },
    { ...ticket, url: "https://127.0.0.1/private" },
    { ...ticket, expires_in: 0 },
    { ...ticket, headers: { Authorization: `Bearer ${apiKey}` } },
  ])("rejects invalid signing responses without uploading", async receipt => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(receipt));
    await expect(uploadCangyuanMedia(connection, [image], { fetch: fetcher })).rejects.toThrow(/凭证无效/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("accepts data URIs and retains their exact decoded bytes and MIME", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => init?.method === "POST" ? response() : new Response(null, { status: 204 }));
    await uploadCangyuanMedia(connection, [{ ...image, data: undefined, url: "data:image/webp;base64,AQID/w==" } as unknown as ProviderAssetInput], { fetch: fetcher });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toMatchObject({ bytes: 4, content_type: "image/webp" });
  });

  function adapter(fetcher: typeof fetch) {
    const id = "gpt-image-2.5-x", transport = cangyuanCurrentTransport(id)!;
    const connector: RestConnectorConfig = { submit: transport.submit!, output: transport.output!, poll: transport.poll,
      models: [cangyuanCurrentModel({ id, name: id, operations: ["image.generate", "image.edit"] })], modelOverrides: { [id]: transport } };
    return new GenericRestAdapter(new StaticConnectionResolver([{ ...connection, settings: { connector } }]), { fetch: fetcher });
  }
  const edit: NormalizedRequest = { connectionId: "one", model: "gpt-image-2.5-x", operation: "image.edit", prompt: "offline upload test",
    parameters: { series: "flare", tier: "4k", quality: "max" }, assets: [image, { ...image, id: "mask", role: "mask" }], idempotencyKey: "offline" };

  it("uses uploaded image and mask URLs in the native edits request", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => String(url).endsWith("/uploads") ? response()
      : init?.method === "PUT" ? new Response(null, { status: 204 }) : Response.json({ id: "test-task", status: "running" }));
    await adapter(fetcher).submit(edit);
    expect(fetcher).toHaveBeenCalledTimes(5);
    const [url, init] = fetcher.mock.calls[4]!;
    expect(url).toBe(`${baseUrl}/v1/images/edits`);
    expect(JSON.parse(String(init!.body))).toMatchObject({ images: [ticket.url], mask: ticket.url, quality: "max" });
    expect(edit.assets![0]!.url).toBeUndefined();
  });

  it("does not submit generation or retry signing after a failed PUT", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => init?.method === "POST" ? response() : new Response("denied", { status: 403 }));
    await expect(adapter(fetcher).submit(edit)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/edits"))).toBe(false);
  });

  it("uploads a local first frame before the exact native video JSON request", async () => {
    const id = "grok-imagine-video", transport = cangyuanVideoTransport(id)!;
    const connector: RestConnectorConfig = { submit: transport.submit!, output: transport.output!, poll: transport.poll,
      models: [cangyuanVideoModel({ id, name: id, operations: ["video.generate", "video.image-to-video"] })] };
    const fetcher = vi.fn<typeof fetch>(async (url, init) => String(url).endsWith("/uploads") ? response()
      : init?.method === "PUT" ? new Response(null, { status: 204 }) : Response.json({ id: "offline-video", status: "running" }));
    const video = new GenericRestAdapter(new StaticConnectionResolver([{ ...connection, settings: { connector } }]), { fetch: fetcher });
    await video.submit({ connectionId: "one", model: id, operation: "video.image-to-video", prompt: "offline mocked first-frame test",
      parameters: { duration: 7 }, assets: [{ ...image, role: "firstFrame" }], idempotencyKey: "mocked-video" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const [url, init] = fetcher.mock.calls[2]!;
    expect(url).toBe(`${baseUrl}/v1/videos`);
    expect(JSON.parse(String(init!.body))).toMatchObject({ model: id, reference_image_urls: [ticket.url], duration: 7 });
  });

  it("limits automatic transport to exact first-party origins and native contracts", () => {
    const native = cangyuanCurrentTransport(edit.model!)!;
    expect(cangyuanOwnMediaUploadAvailable("rest", { baseUrl, connector: { submit: native.submit, modelOverrides: { [edit.model!]: native } } }, edit.model, edit.operation)).toBe(true);
    for (const settings of [{ baseUrl, manualProtocol: true }, { baseUrl, manualModels: [{ id: edit.model }] },
      { baseUrl, autoModelInterfaces: { [edit.model!]: {} } }, { baseUrl: "https://cangyuansuanli.cn.evil.example" }])
      expect(cangyuanOwnMediaUploadAvailable("rest", settings, edit.model, edit.operation)).toBe(false);
    expect(cangyuanOwnMediaUploadAvailable("openai", { baseUrl }, edit.model, edit.operation)).toBe(false);
    expect(cangyuanOwnMediaUploadAvailable("rest", { baseUrl }, "grok-imagine-image-2.0", edit.operation)).toBe(false);
    expect(cangyuanMediaUploadOrigin(`${baseUrl}/v1`)).toBe(baseUrl);
    expect(cangyuanMediaUploadOrigin(`${baseUrl}/other`)).toBeUndefined();
  });
});
