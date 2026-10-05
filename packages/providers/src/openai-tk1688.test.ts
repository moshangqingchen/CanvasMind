import { describe, expect, it, vi } from "vitest";
import { StaticConnectionResolver } from "./credentials";
import { OpenAIImageAdapter } from "./openai";
import { scanProviderModelCatalog } from "./model-catalog";
import { parseTk1688Marketplace } from "./tk1688-catalog";
import type { ModelDescriptor } from "./contracts";
import { isTk1688ApiUrl, tk1688ImagePolicyModelId } from "./tk1688-model-policy";

const hosts = ["tk1688.com", "api.tk1688.com", "ai.tk1688.com"];
const merchantModel = "gpt-image-2@s12c29";
const request = {
  connectionId: "tk1688", operation: "image.generate" as const,
  model: merchantModel, prompt: "A wide product photo", idempotencyKey: "mock-merchant-image",
};
function adapterFor(baseUrl: string, fetchMock?: typeof fetch, modelCatalogModels?: ModelDescriptor[]) {
  return new OpenAIImageAdapter(new StaticConnectionResolver([{
    id: request.connectionId, provider: "openai", apiKey: "isolated-test-key", baseUrl,
    ...(modelCatalogModels ? { settings: { modelCatalogModels } } : {}),
  }]), fetchMock ? { fetch: fetchMock } : {});
}

describe("Tk1688 merchant model parameter policy", () => {
  it.each(hosts)("recognizes the documented alias only on %s", host => {
    const baseUrl = `https://${host}/v1`;
    expect(isTk1688ApiUrl(baseUrl)).toBe(true);
    expect(tk1688ImagePolicyModelId(merchantModel, baseUrl)).toBe("gpt-image-2");
    expect(tk1688ImagePolicyModelId("gpt-image-2-high@s12c29", baseUrl)).toBe("gpt-image-2-high");
    expect(tk1688ImagePolicyModelId("gpt-image-2.5-sunburst@s1c23", baseUrl)).toBe("gpt-image-2.5-sunburst@s1c23");
  });

  it.each([
    "https://other.example/v1", "https://api.tk1688.com.example/v1",
    "https://evil.tk1688.com/v1", "http://api.tk1688.com/v1",
    "https://api.tk1688.com:8443/v1", "https://user@api.tk1688.com/v1", "invalid-url", undefined,
  ])("retains the original policy outside the official API boundary: %s", baseUrl => {
    expect(isTk1688ApiUrl(baseUrl)).toBe(false);
    expect(tk1688ImagePolicyModelId(merchantModel, baseUrl)).toBe(merchantModel);
  });

  it.each(["gpt-image-2@merchant", "gpt-image-2@s12", "gpt-image-2@s12c29-extra", "gpt-image-2@S12c29", "gpt-image-2@s12c29@s1c23"])(
    "does not reinterpret a nonmatching merchant ID: %s", model => {
      expect(tk1688ImagePolicyModelId(model, "https://api.tk1688.com/v1")).toBe(model);
    },
  );

  it.each(hosts)("applies existing Image 2 paid-request validation on %s", async host => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: "bW9jaw==" }] }));
    const adapter = adapterFor(`https://${host}/v1`, fetchMock);
    for (const size of ["1024x1024", "1360x768", "2048x2048", "3840x2160"])
      expect((await adapter.validate({ ...request, parameters: { size, quality: "high" } })).valid).toBe(true);
    for (const size of ["512x512", "1920x1080", "4096x2048", "3072x768", "3008x3008"])
      expect((await adapter.validate({ ...request, parameters: { size } })).issues).toContainEqual(expect.objectContaining({ code: "invalid_size" }));
    expect((await adapter.validate({ ...request, parameters: { background: "transparent" } })).issues).toContainEqual(expect.objectContaining({ code: "unsupported_background" }));
    for (const quality of ["max", "xhigh"])
      expect((await adapter.validate({ ...request, parameters: { quality } })).issues).toContainEqual(expect.objectContaining({ code: "invalid_quality" }));
    await expect(adapter.submit({ ...request, parameters: { size: "1920x1080" } })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(hosts)("uses flexible Image 2 pixels and retains the outbound merchant ID on %s", async host => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: "bW9jaw==" }] }));
    const baseUrl = `https://${host}/v1`;
    await adapterFor(baseUrl, fetchMock).submit({ ...request, parameters: { aspect_ratio: "16:9", quality: "high" } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${baseUrl}/images/generations`);
    expect(JSON.parse(String(init?.body))).toEqual({ model: merchantModel, prompt: request.prompt, size: "1360x768", quality: "high" });
  });

  it("retains the merchant ID and flexible pixels in multipart image edits", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [{ url: "https://output.test/edit.png" }] }));
    await adapterFor("https://api.tk1688.com/v1", fetchMock).submit({
      ...request, operation: "image.edit", parameters: { aspect_ratio: "9:16", quality: "medium" },
      assets: [{ id: "reference", kind: "image", mimeType: "image/png", data: new Uint8Array([137, 80, 78, 71]) }],
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.tk1688.com/v1/images/edits");
    const form = init?.body as FormData;
    expect(form.get("model")).toBe(merchantModel);
    expect(form.get("size")).toBe("768x1360");
    expect(form.get("quality")).toBe("medium");
    expect(form.get("image")).toBeInstanceOf(Blob);
  });

  it("keeps Image 2.5 merchant identity and does not assign Image 2 pixel policy", async () => {
    const model = "gpt-image-2.5-sunburst@s1c23";
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: "bW9jaw==" }] }));
    await adapterFor("https://api.tk1688.com/v1", fetchMock).submit({ ...request, model,
      parameters: { aspect_ratio: "16:9", quality: "high" } });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ model, size: "1536x1024", quality: "high" });
  });

  it("classifies merchant IDs while retaining their exact inventory identity", () => {
    const ids = [merchantModel, "gpt-image-2.5-sunburst@s1c23", "gpt-5.6-sol@s12c29"];
    const scanned = scanProviderModelCatalog({ data: ids.map(id => ({ id })) }).models;
    expect(scanned.map(model => model.id)).toEqual(ids);
    expect(scanned[0]?.operations).toContain("image.generate");
    expect(scanned[1]?.operations).toContain("image.generate");
    expect(scanned[2]?.operations).toEqual([]);
    expect(scanned[2]?.outputKinds).toEqual(["text"]);
  });

  it("does not change another supplier's same-looking alias policy", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: "bW9jaw==" }] }));
    const adapter = adapterFor("https://other.example/v1", fetchMock);
    expect((await adapter.validate({ ...request, parameters: { background: "transparent" } })).valid).toBe(false);
    await adapter.submit({ ...request, parameters: { aspect_ratio: "16:9" } });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ model: merchantModel, size: "1536x1024" });
  });
});

function marketModels() {
  return parseTk1688Marketplace({ success: true, data: { total: 4, items: [
    { alias: "gpt-image-2.5-sunburst@s47c261", base_model: "gpt-image-2.5-sunburst", status: "active", charge_type: "per_request",
      description: "Adobe支持原生4K(3840*2160)，不支持N。" },
    { alias: "gpt-image-2.5-sunburst@s46c265", base_model: "gpt-image-2.5-sunburst", status: "active", charge_type: "per_request",
      description: "支持1K、2K。" },
    { alias: "gpt-image-2@s12c29", base_model: "gpt-image-2", status: "active", charge_type: "per_request", description: "稳定图片渠道。" },
    { alias: "nano-banana@s1c23", base_model: "nano-banana", status: "active", charge_type: "per_request", description: "支持1K/2K/4K。" },
  ] } }, undefined, { checkedAt: "now" }).models;
}

describe("Tk1688 exact marketplace request parameters", () => {
  it.each(["image.generate", "image.edit"] as const)("sends only fixed 4K pixels and completely omits n for %s", async operation => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: "bW9jaw==" }] }));
    const model = "gpt-image-2.5-sunburst@s47c261";
    const adapter = adapterFor("https://api.tk1688.com/v1", fetchMock, marketModels());
    await adapter.submit({ ...request, operation, model, parameters: { size: "auto", n: 1, quality: "high", response_format: "b64_json" },
      ...(operation === "image.edit" ? { assets: [{ id: "reference", kind: "image" as const, mimeType: "image/png", data: new Uint8Array([137, 80, 78, 71]) }] } : {}) });
    const [, init] = fetchMock.mock.calls[0]!;
    if (operation === "image.generate") {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model, size: "3840x2160", quality: "high", response_format: "b64_json" });
      expect(body).not.toHaveProperty("n");
    } else {
      const body = init?.body as FormData;
      expect(body.get("model")).toBe(model);
      expect(body.get("size")).toBe("3840x2160");
      expect(body.get("response_format")).toBe("b64_json");
      expect(body.has("n")).toBe(false);
    }
  });

  it("rejects conflicting pixels and legacy multi-output snapshots before any fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: "bW9jaw==" }] }));
    const adapter = adapterFor("https://api.tk1688.com/v1", fetchMock, marketModels());
    for (const parameters of [{ size: "1024x1024" }, { n: 2 }, { quality: "max" }, { quality: "xhigh" }]) {
      await expect(adapter.submit({ ...request, model: "gpt-image-2.5-sunburst@s47c261", parameters })).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps declared merchant K tiers to lowercase-x pixels and preserves the exact alias", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [{ url: "https://output.test/image.png" }] }));
    const adapter = adapterFor("https://api.tk1688.com/v1", fetchMock, marketModels());
    const model = "gpt-image-2.5-sunburst@s46c265";
    await adapter.submit({ ...request, model, parameters: { resolution: "1K", aspect_ratio: "3:2", quality: "auto", n: 4, response_format: "url" } });
    const automaticBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(automaticBody).toMatchObject({ model, size: "1536x1024", n: 4, response_format: "url" });
    expect(automaticBody).not.toHaveProperty("quality");
    await adapter.submit({ ...request, model, parameters: { resolution: "2K", aspect_ratio: "1:1", quality: "medium" } });
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(body).toMatchObject({ model, size: "2048x2048", quality: "medium" });
    expect(body).not.toHaveProperty("resolution");
    expect(body).not.toHaveProperty("aspect_ratio");
    expect((await adapter.validate({ ...request, model, parameters: { resolution: "4K" } })).valid).toBe(false);
    expect((await adapter.validate({ ...request, model, parameters: { resolution: "2K", size: "1024x1024" } })).valid).toBe(false);
  });

  it("keeps smart routing to common merchant limits and omits n when any eligible merchant forbids it", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [{ url: "https://output.test/image.png" }] }));
    const adapter = adapterFor("https://api.tk1688.com/v1", fetchMock, marketModels());
    const model = "gpt-image-2.5-sunburst";
    await adapter.submit({ ...request, model, parameters: { n: 1, resolution: "auto", response_format: "url" } });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe(model);
    expect(body).not.toHaveProperty("n");
    expect(body).not.toHaveProperty("size");
    expect((await adapter.validate({ ...request, model, parameters: { resolution: "4K" } })).valid).toBe(false);
    expect((await adapter.validate({ ...request, model, parameters: { n: 2 } })).issues).toContainEqual(expect.objectContaining({ code: "invalid_count" }));
  });

  it("does not allow raw 4K size or a guessed tier to bypass an unknown merchant declaration", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: "bW9jaw==" }] }));
    const adapter = adapterFor("https://api.tk1688.com/v1", fetchMock, marketModels());
    for (const parameters of [{ size: "3840x2160" }, { resolution: "4K" }, { n: 5 }, { n: 1.5 }, { n: Number.NaN }])
      await expect(adapter.submit({ ...request, parameters })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    await adapter.submit({ ...request, parameters: { size: "1536x1024", quality: "high", n: 4 } });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ model: merchantModel, size: "1536x1024", quality: "high", n: 4 });
  });

  it("applies declared 4K conversion to non-GPT compatible image models", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: "bW9jaw==" }] }));
    const adapter = adapterFor("https://api.tk1688.com/v1", fetchMock, marketModels());
    await adapter.submit({ ...request, model: "nano-banana@s1c23", parameters: { resolution: "4K", aspect_ratio: "1:1", response_format: "b64_json" } });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ model: "nano-banana@s1c23", size: "2880x2880", response_format: "b64_json" });
  });

  it("enforces the current descriptor's reference-image limit", async () => {
    const models = marketModels().map(model => model.id === merchantModel ? { ...model, limits: { ...model.limits, maxInputImages: 1 } } : model);
    const adapter = adapterFor("https://api.tk1688.com/v1", undefined, models);
    const asset = { id: "reference", kind: "image" as const, mimeType: "image/png", data: new Uint8Array([137, 80, 78, 71]) };
    expect((await adapter.validate({ ...request, operation: "image.edit", assets: [asset, { ...asset, id: "reference-2" }] })).issues)
      .toContainEqual(expect.objectContaining({ code: "too_many_images" }));
  });

  it.each(["url", "b64_json"])("forwards the documented response_format=%s without a market descriptor", async response_format => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: "bW9jaw==" }] }));
    await adapterFor("https://api.tk1688.com/v1", fetchMock).submit({ ...request, parameters: { response_format } });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ model: merchantModel, response_format });
  });

  it.each(["image.generate", "image.edit"] as const)("omits explicitly automatic quality from %s", async operation => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: "bW9jaw==" }] }));
    const model = "gpt-image-2.5-sunburst@s46c265";
    await adapterFor("https://api.tk1688.com/v1", fetchMock, marketModels()).submit({ ...request, operation, model,
      parameters: { quality: "auto", response_format: "b64_json" },
      ...(operation === "image.edit" ? { assets: [{ id: "reference", kind: "image" as const, mimeType: "image/png", data: new Uint8Array([137, 80, 78, 71]) }] } : {}) });
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    if (operation === "image.generate") expect(JSON.parse(String(body))).not.toHaveProperty("quality");
    else expect((body as FormData).has("quality")).toBe(false);
  });
});
