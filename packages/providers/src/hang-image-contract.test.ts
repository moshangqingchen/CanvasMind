import { describe, expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "203.0.113.10", family: 4 }] }));
import { OpenAIImageAdapter } from "./openai.js";
import { StaticConnectionResolver } from "./credentials.js";
import { hangImageBaseUrl, hangGptImageBaseUrl } from "./hang-image-contract.js";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";

describe("Hang official group 74 measured default image wire contract", () => {
  it.each(["grok-imagine-image", "grok-imagine-image-2.0", "grok-imagine-image-quality"])("uses the exact /v1 route and preserves original JPEG for %s", async model => {
    const original = new Uint8Array([255,216,255,224,0,16,74,70,73,70,0]);
    const fetch = vi.fn<typeof globalThis.fetch>(async url => String(url).endsWith("/models") ? Response.json({ data: [{ id: model }] }) :
      Response.json({ data: [{ b64_json: Buffer.from(original).toString("base64") }] }));
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "hang", provider: "openai", apiKey: "fixture", baseUrl: "https://api.hangzhale.com",
      settings: { accountKeyGroupId: "74", modelGroup: "Grok Heavy", modelScanStatus: "live", scannedModelIds: [model] } }]), { fetch });
    const descriptor = (await adapter.listModels("hang")).find(row => row.id === model)!;
    expect(descriptor.parameters).toEqual([]);
    expect(descriptor.metadata?.imageSupportedResolutions).toEqual([]);
    const task = await adapter.submit({ connectionId: "hang", model, operation: "image.generate", prompt: "fixture", parameters: {}, idempotencyKey: model });
    const posts = fetch.mock.calls.filter(([,init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(String(posts[0]![0])).toBe("https://api.hangzhale.com/v1/images/generations");
    expect(JSON.parse(String(posts[0]![1]!.body))).toEqual({ model, prompt: "fixture", n: 1 });
    const output = (await adapter.extractOutputs(task.result))[0]!;
    expect(output.mimeType).toBe("image/jpeg");
    expect(output.filename).toMatch(/\.jpe?g$/u);
    expect(output.data).toEqual(original);
  });
  it("does not normalize another group, full ID, site, version or custom endpoint", () => {
    const config = { baseUrl: "https://api.hangzhale.com", accountKeyGroupId: "74" };
    expect(hangImageBaseUrl(config, "grok-imagine-image")).toBe("https://api.hangzhale.com/v1");
    for (const baseUrl of ["http://api.hangzhale.com", "https://other.test", "https://api.hangzhale.com/custom", "https://api.hangzhale.com/v2", "https://api.hangzhale.com/?x=1", "https://user@api.hangzhale.com"])
      expect(hangImageBaseUrl({ ...config, baseUrl }, "grok-imagine-image")).toBeUndefined();
    expect(hangImageBaseUrl({ ...config, accountKeyGroupId: "75" }, "grok-imagine-image")).toBeUndefined();
    expect(hangImageBaseUrl(config, "grok-imagine-image-other")).toBeUndefined();
  });
  it.each(["grok-imagine-image", "grok-imagine-image-2.0"])("preserves the measured one-JPEG multipart editing contract for %s", async model => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [{ b64_json: "/9j/4AA=" }] }));
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "hang", provider: "openai", apiKey: "fixture", baseUrl: "https://api.hangzhale.com",
      settings: { accountKeyGroupId: "74", modelScanStatus: "live", scannedModelIds: [model] } }]), { fetch });
    await adapter.submit({ connectionId: "hang", model, operation: "image.edit", prompt: "Keep cup, change color", parameters: {}, idempotencyKey: model,
      assets: [{ id: "ref", kind: "image", role: "reference", mimeType: "image/jpeg", filename: "reference.jpg", data: new Uint8Array([255,216,255,224]) }] });
    const post = fetch.mock.calls.find(([,init]) => init?.method === "POST")!;
    expect(String(post[0])).toBe("https://api.hangzhale.com/v1/images/edits");
    const form = post[1]!.body as FormData;
    expect([...form.keys()].sort()).toEqual(["image", "model", "n", "prompt"]);
    expect(form.get("model")).toBe(model);
    expect(form.get("n")).toBe("1");
    expect((form.get("image") as File).type).toBe("image/jpeg");
    expect(new Headers(post[1]?.headers).has("content-type")).toBe(false);
  });
});

describe("Hang ordinary GPT Images documented /v1 root", () => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aKcAAAAASUVORK5CYII=";
  const ids = ["gpt-image-2", "gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
  function fixture(model: string, groupId = "75", extra: Record<string, unknown> = {}, baseUrl = "https://api.hangzhale.com/") {
    const group = groupId === "21" ? "Image2生图专用分组" : "Image - 1k";
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [{ b64_json: png }] }));
    const resolver = new StaticConnectionResolver([{ id: "hang-gpt", provider: "openai", apiKey: "fixture-only", baseUrl,
      settings: { usage: "canvas", accountKeyGroupId: groupId, accountKeyGroup: group, modelGroup: group,
        scannedModelIds: [model], modelScanStatus: "live", ...extra } }]);
    const fallback = new OpenAIImageAdapter(resolver, { fetch });
    return { fetch, adapter: new AutoInterfaceAdapter(resolver, fallback, { fetch }) };
  }
  it.each(ids)("uses /v1 for ordinary JSON generation and multipart original-file editing of group75 %s", async model => {
    for (const operation of ["image.generate", "image.edit"] as const) {
      const f = fixture(model), bytes = new Uint8Array(Buffer.from(png, "base64"));
      const request = { connectionId: "hang-gpt", operation, model, prompt: "offline fixture", parameters: { size: "1024x1024", quality: "high", n: 1 }, idempotencyKey: "offline",
        ...(operation === "image.edit" ? { assets: [{ id: "ref", kind: "image" as const, mimeType: "image/png", filename: "original.png", data: bytes }] } : {}) };
      expect((await f.adapter.validate(request)).valid).toBe(true); expect(f.fetch).not.toHaveBeenCalled();
      await f.adapter.submit(request); expect(f.fetch).toHaveBeenCalledOnce();
      const [url, init] = f.fetch.mock.calls[0]!;
      expect(url).toBe(`https://api.hangzhale.com/v1/images/${operation === "image.edit" ? "edits" : "generations"}`);
      if (operation === "image.edit") {
        const form = init!.body as FormData;
        expect(new Uint8Array(await (form.get("image") as File).arrayBuffer())).toEqual(bytes);
        expect(form.get("size")).toBe("1024x1024"); expect(new Headers(init?.headers).has("content-type")).toBe(false);
      } else expect(JSON.parse(String(init?.body))).toMatchObject({ model, size: "1024x1024", quality: "high", n: 1 });
    }
  });
  it("retains group21's existing permission gate before HTTP", async () => {
    const model = "gpt-image-2", f = fixture(model, "21", { modelCatalogModels: [{ id: model, name: model, operations: ["image.generate"],
      metadata: { canvasRunnable: false, canvasUnavailableReason: "403 GROUP_NOT_ALLOWED" } }] });
    const request = { connectionId: "hang-gpt", operation: "image.generate" as const, model, prompt: "fixture", parameters: {}, idempotencyKey: "offline" };
    expect((await f.adapter.validate(request)).valid).toBe(false);
    await expect(f.adapter.submit(request)).rejects.toThrow(); expect(f.fetch).not.toHaveBeenCalled();
  });
  it("does not replace the exact historical transparent-generation root pin", async () => {
    const f = fixture("gpt-image-2");
    await f.adapter.submit({ connectionId: "hang-gpt", model: "gpt-image-2", operation: "image.generate", prompt: "fixture", idempotencyKey: "offline",
      parameters: { size: "1024x1024", quality: "high", n: 1, background: "transparent", output_format: "png" } });
    expect(f.fetch.mock.calls[0]![0]).toBe("https://api.hangzhale.com/images/generations"); expect(f.fetch).toHaveBeenCalledOnce();
  });
  it("normalizes only known official GPT groups, retaining custom bases and the separate group74 contract", async () => {
    for (const baseUrl of ["https://api.hangzhale.com", "https://api.hangzhale.com/", "https://api.hangzhale.com/v1", "https://api.hangzhale.com/v1/"])
      expect(hangGptImageBaseUrl({ baseUrl, accountKeyGroupId: "75" }, "gpt-image-2.5")).toBe("https://api.hangzhale.com/v1");
    for (const baseUrl of ["https://api.hangzhale.com/custom", "https://api.hangzhale.com/v2", "https://api.hangzhale.com/?x=1", "https://user@api.hangzhale.com", "https://other.example/"])
      expect(hangGptImageBaseUrl({ baseUrl, accountKeyGroupId: "75" }, "gpt-image-2")).toBeUndefined();
    expect(hangGptImageBaseUrl({ baseUrl: "https://api.hangzhale.com", accountKeyGroupId: "74" }, "grok-imagine-image")).toBeUndefined();
    expect(hangGptImageBaseUrl({ baseUrl: "https://api.hangzhale.com", accountKeyGroupId: "21" }, "gpt-image-2.5")).toBeUndefined();
    expect(hangGptImageBaseUrl({ baseUrl: "https://api.hangzhale.com", modelGroup: "Image - 1k" }, "gpt-image-2")).toBe("https://api.hangzhale.com/v1");
    const f = fixture("gpt-image-2", "75", {}, "https://api.hangzhale.com/custom");
    await f.adapter.submit({ connectionId: "hang-gpt", model: "gpt-image-2", operation: "image.generate", prompt: "fixture", parameters: {}, idempotencyKey: "offline" });
    expect(f.fetch.mock.calls[0]![0]).toBe("https://api.hangzhale.com/custom/images/generations");
  });
});
