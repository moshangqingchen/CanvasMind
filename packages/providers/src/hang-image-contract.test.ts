import { describe, expect, it, vi } from "vitest";
import { OpenAIImageAdapter } from "./openai.js";
import { StaticConnectionResolver } from "./credentials.js";
import { hangImageBaseUrl } from "./hang-image-contract.js";

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
