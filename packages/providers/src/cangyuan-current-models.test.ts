import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { cangyuanCurrentModel, cangyuanCurrentPricing, cangyuanCurrentRequestIssues, cangyuanCurrentTransport, managesCangyuanCurrentTransport } from "./cangyuan-current-models.js";
import { StaticConnectionResolver } from "./credentials.js";
import { modelPriceAmount } from "./media-billing.js";
import { GenericRestAdapter, restRequestRequiresPublicAssets, type RestConnectorConfig } from "./rest.js";
import { IMAGE_SIZE_RATIOS } from "./image-size-presets.js";
import type { ModelDescriptor, NormalizedRequest } from "./contracts.js";
import { CANGYUAN_IMAGE_DOCUMENTS } from "./cangyuan-image-documents.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/cangyuan-current-pricing.json", import.meta.url), "utf8"));
const baseUrl = "https://ai.cangyuansuanli.cn";
const descriptor = (id: string): ModelDescriptor => cangyuanCurrentModel({ id, name: id, operations: ["image.generate", "image.edit"] });
const request = (id: string, parameters: Record<string, unknown> = {}): NormalizedRequest => ({ connectionId: "one", model: id,
  operation: "image.generate", prompt: "offline contract test", parameters, idempotencyKey: "one" });
function adapterFor(id: string, response: unknown = { data: [{ url: "https://images.example/one.png" }] }) {
  const transport = cangyuanCurrentTransport(id)!;
  const connector: RestConnectorConfig = { submit: transport.submit!, poll: transport.poll, output: transport.output!,
    allowedHosts: ["ai.cangyuansuanli.cn"], models: [descriptor(id)], restrictModels: true, modelOverrides: { [id]: transport },
    statusMap: { completed: "succeeded" } };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(response));
  const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "one", provider: "rest", apiKey: "offline-test",
    baseUrl, settings: { connector } }]), { fetch: fetcher });
  return { adapter, fetcher, connector };
}

describe("Cangyuan current complete public IDs", () => {
  it.each(Object.entries(CANGYUAN_IMAGE_DOCUMENTS))("maps exact document fields and creation-specific polling for %s", async (id, document) => {
    const model = descriptor(id);
    expect(model.metadata?.imageNativeParameterContract).toBe(true);
    expect(model.metadata?.documentationUrl).toBe(document.sourceUrl);
    expect(model.metadata?.imageContractDocumentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(model.parameters?.find(p => p.key === "aspect_ratio")?.options?.map(o => o.value).filter(v => v !== "auto") ?? []).toEqual(document.ratios);
    const parameters = { ...(id === "gpt-image-2.5-x" ? { series: "flare", tier: "web" } : {}),
      ...(document.ratios[0] ? { aspect_ratio: document.ratios[0] } : document.pixelOptions[0] ? { size: document.pixelOptions[0] } : {}),
      ...(document.qualityOptions.length && id !== "gpt-image-2-x" && id !== "gpt-image-2.5-x" ? { quality: model.parameters!.find(p => p.key === "quality")!.options![0]!.value } : {}) };
    for (const edit of document.editing ? [false, true] : [false]) {
      const { adapter, fetcher } = adapterFor(id, { id: "saved-task", status: "running" });
      const task = await adapter.submit({ ...request(id, parameters), operation: edit ? "image.edit" : "image.generate",
        ...(edit ? { assets: [{ id: "ref", kind: "image" as const, mimeType: "image/png", url: "https://images.example/ref.png" }] } : {}) });
      const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
      for (const field of Object.keys(body)) expect(document.fields).toHaveProperty(field);
      const path = edit ? "/v1/images/edits" : "/v1/images/generations";
      expect(String(fetcher.mock.calls[0]![0])).toBe(`${baseUrl}${path}`);
      if (edit) expect(body.images).toEqual(["https://images.example/ref.png"]);
      await adapter.poll(task);
      expect(String(fetcher.mock.calls[1]![0])).toBe(`${baseUrl}${path}/saved-task`);
    }
  });

  it("keeps Grok pixel recommendations open without inventing a supplier K tier", async () => {
    for (const id of ["grok-imagine-image", "grok-imagine-image-2.0"]) {
      expect(descriptor(id).parameters?.find(p => p.key === "size")).toMatchObject({ control: "dimensions", default: "1024x1024", allowCustomValue: true });
      expect(descriptor(id).metadata?.imageSupportedResolutions).toEqual([]);
      const { adapter, fetcher } = adapterFor(id);
      await adapter.submit(request(id, { size: "2048x2048" }));
      expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body)).size).toBe("2048x2048");
    }
  });

  it("accepts Grok's documented data URI references without demanding external hosting", async () => {
    const { adapter, fetcher, connector } = adapterFor("grok-imagine-image-2.0");
    const dataUri = "data:image/png;base64,aW1hZ2U=";
    expect(restRequestRequiresPublicAssets(connector, "grok-imagine-image-2.0", "image.edit", { baseUrl, connector })).toBe(false);
    await adapter.submit({ ...request("grok-imagine-image-2.0", { size: "1792x1024" }), operation: "image.edit",
      assets: [{ id: "ref", kind: "image", mimeType: "image/png", url: dataUri }] });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body)).images).toEqual([dataUri]);
  });

  it("uses Midjourney editor's single source and matching edits query endpoint", async () => {
    const { adapter, fetcher } = adapterFor("midjourney-2k", { id: "editor-task", status: "running" });
    const task = await adapter.submit({ ...request("midjourney-2k", { reference: "editor", mask: "https://images.example/mask.png" }), operation: "image.edit",
      assets: [{ id: "ref", kind: "image", mimeType: "image/png", url: "https://images.example/ref.png" }] });
    expect(String(fetcher.mock.calls[0]![0])).toBe(`${baseUrl}/v1/images/edits`);
    await adapter.poll(task);
    expect(String(fetcher.mock.calls[1]![0])).toBe(`${baseUrl}/v1/images/edits/editor-task`);
  });

  it("uses Nano 2.1's independent Images protocol and exact quality prices", async () => {
    const id = "gemini-nano-banana-2.1";
    expect(descriptor(id).parameters?.map(p => p.key)).toEqual(["aspect_ratio", "size", "n", "quality", "response_format", "async"]);
    expect(descriptor(id).limits?.maxInputImages).toBe(14);
    expect(descriptor(id).parameters?.find(p => p.key === "aspect_ratio")?.options?.map(o => o.value)).not.toContain("9:21");
    const expression = 'has(param("quality"), "4k") || has(param("quality"), "4K") ? tier("4k", n * 0.10) : has(param("quality"), "2k") || has(param("quality"), "2K") ? tier("2k", n * 0.08) : tier("1k", n * 0.06)';
    const pricing = cangyuanCurrentPricing(id, expression, 1, "2026-10-07")!;
    for (const [quality, price] of [["1k", 0.06], ["2k", 0.08], ["4k", 0.1]] as const) {
      expect(modelPriceAmount(pricing, { quality })).toBe(price);
      const { adapter, fetcher } = adapterFor(id);
      await adapter.submit({ ...request(id, { quality, aspect_ratio: "21:9", n: 1 }), operation: "image.edit", assets: [{ id: "r", kind: "image", mimeType: "image/webp", url: "https://assets.example/a.webp" }] });
      expect(String(fetcher.mock.calls[0]![0])).toBe(`${baseUrl}/v1/images/edits`);
      expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({ async: true, n: 1, response_format: "url", model: id, prompt: "offline contract test", quality, size: "21:9", images: ["https://assets.example/a.webp"] });
    }
    expect(cangyuanCurrentPricing(id, expression.replace("0.10", "0.11"), 1, "today")).toBeUndefined();
    for (const input of [request(id, { tier: "4k" }), request(id, { n: 2 }), request(id, { mask: "https://assets.example/mask.png" })]) {
      const { adapter, fetcher } = adapterFor(id);
      await expect(adapter.submit(input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
    }
    expect(cangyuanCurrentModel({ id, name: id, operations: [], metadata: { canvasRunnable: false, canvasUnavailableReason: "403 权限不足" } }).metadata?.canvasRunnable).toBe(false);
  });
  it("uses documented native controls rather than inherited family fields", () => {
    for (const id of ["gpt-image-2-x", "gpt-image-2.5-x"]) {
      const model = descriptor(id);
      expect(model.parameters?.find(p => p.key === "tier")).toMatchObject({ default: "4k", options: [
        { label: "web", value: "web" }, { label: "1k", value: "1k" }, { label: "2k", value: "2k" }, { label: "4k", value: "4k" },
      ] });
      expect(model.parameters?.find(p => p.key === "quality")).toMatchObject({ default: id === "gpt-image-2-x" ? "high" : "max" });
    }
    expect(descriptor("gpt-image-2-x").parameters?.find(p => p.key === "quality")?.options?.map(o => o.value)).toEqual(["medium", "low", "high", "xhigh", "max"]);
    expect(descriptor("gpt-image-2.5-x").parameters?.find(p => p.key === "quality")?.options?.map(o => o.value)).toEqual(["medium", "low", "high", "xhigh", "max"]);
    expect(descriptor("gpt-image-2.5-x").parameters?.find(p => p.key === "series")).toMatchObject({ default: "sunburst", required: true });
    for (const id of ["midjourney-v7", "seedream-5.0-pro-x"]) expect(descriptor(id).parameters?.some(p => ["quality", "speed", "tier"].includes(p.key))).toBe(false);
    expect(descriptor("midjourney-v7").metadata?.imageSupportedResolutions).toEqual([]);
    expect(descriptor("seedream-5.0-pro-x").metadata?.imageSupportedResolutions).toEqual(["1K", "2K"]);
  });

  it.each(["gpt-image-2-x", "gpt-image-2.5-x"])("preserves selected web quality and rejects undocumented fields for %s", async id => {
    const { adapter, fetcher } = adapterFor(id);
    await expect(adapter.submit(request(id, { tier: "web", image_size: "4K" }))).rejects.toThrow(/image_size/u);
    expect(fetcher).not.toHaveBeenCalled();
    await adapter.submit(request(id, { tier: "web", ...(id === "gpt-image-2.5-x" ? { series: "flare" } : {}), quality: "max", aspect_ratio: "16:9" }));
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({ model: id, prompt: "offline contract test", tier: "web", n: 1,
      size: "16:9", quality: "max", async: true, response_format: "url", ...(id === "gpt-image-2.5-x" ? { series: "flare" } : {}) });
  });

  it.each(["gpt-image-2-x", "gpt-image-2.5-x"])("maps every K/ratio request through legal native fields for %s", async id => {
    for (const tier of ["1k", "2k", "4k"]) for (const ratio of IMAGE_SIZE_RATIOS) {
      const { adapter, fetcher } = adapterFor(id);
      await adapter.submit(request(id, { tier, ...(id === "gpt-image-2.5-x" ? { series: "sunburst" } : {}), quality: "max", aspect_ratio: ratio }));
      const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
      expect(body.tier).toBe(tier); expect(body.quality).toBe("max");
      expect(body.size).toBe(ratio);
      expect(body).not.toHaveProperty("aspect_ratio");
    }
  });

  it("preserves the image edit endpoint, HTTPS reference order and poll endpoint", async () => {
    const { adapter, fetcher } = adapterFor("gpt-image-2.5-x", { id: "accepted", status: "running" });
    const task = await adapter.submit({ ...request("gpt-image-2.5-x", { tier: "4k", series: "flare", quality: "max" }), operation: "image.edit",
      assets: [{ id: "first", kind: "image", mimeType: "image/png", url: "https://images.example/first.png" },
        { id: "second", kind: "image", mimeType: "image/png", url: "https://images.example/second.png" }] });
    expect(String(fetcher.mock.calls[0]![0])).toBe(`${baseUrl}/v1/images/edits`);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body)).images).toEqual(["https://images.example/first.png", "https://images.example/second.png"]);
    await adapter.poll(task);
    expect(String(fetcher.mock.calls[1]![0])).toBe(`${baseUrl}/v1/images/edits/accepted`);
  });

  it("recognizes native URL references before runtime upload without altering unrelated or manual transports", () => {
    const { connector } = adapterFor("gpt-image-2.5-x");
    const settings = { baseUrl, connector };
    const before = structuredClone(connector);
    expect(restRequestRequiresPublicAssets(connector, "gpt-image-2.5-x", "image.edit", settings)).toBe(false);
    expect(restRequestRequiresPublicAssets(connector, "unrelated", "image.edit", settings)).toBe(false);
    expect(restRequestRequiresPublicAssets(connector, "gpt-image-2.5-x", "image.edit", { ...settings, baseUrl: "https://other.example" })).toBe(false);
    expect(restRequestRequiresPublicAssets(connector, "gpt-image-2.5-x", "image.edit", { ...settings, manualModels: [{ id: "gpt-image-2.5-x" }] })).toBe(false);
    expect(connector).toEqual(before);
  });

  it("keeps Midjourney ratio recommendations open and preserves chosen ratios", async () => {
    for (const ratio of IMAGE_SIZE_RATIOS) {
      const { adapter, fetcher } = adapterFor("midjourney-v7", { id: "mj-task", status: "running" });
      const task = await adapter.submit(request("midjourney-v7", { aspect_ratio: ratio }));
      const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
      expect(body.size).toBe(ratio); expect(body.n).toBe(1); expect(body).not.toHaveProperty("quality"); expect(body).not.toHaveProperty("speed"); expect(body).not.toHaveProperty("tier");
      fetcher.mockResolvedValueOnce(Response.json({ id: "mj-task", status: "completed", data: [{ url: "https://images.example/one.png" }, { url: "https://images.example/two.png" }] }));
      const completed = await adapter.poll(task);
      expect(completed.status).toBe("succeeded");
      expect(String(fetcher.mock.calls[1]![0])).toBe(`${baseUrl}/v1/images/generations/mj-task`);
      expect((await adapter.extractOutputs(completed.result)).map(output => output.url)).toEqual(["https://images.example/one.png", "https://images.example/two.png"]);
    }
  });

  it("keeps Seedream declared shapes as recommendations without silently substituting saved ratios", async () => {
    for (const ratio of IMAGE_SIZE_RATIOS) {
      const { adapter, fetcher } = adapterFor("seedream-5.0-pro-x");
      await adapter.submit(request("seedream-5.0-pro-x", { aspect_ratio: ratio }));
      const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
      expect(IMAGE_SIZE_RATIOS).toContain(body.size);
      expect(body.size).toBe(ratio);
      expect(body).not.toHaveProperty("quality"); expect(body).not.toHaveProperty("aspect_ratio");
    }
  });

  it("blocks missing series, invalid tier/count and excessive references before fetch", async () => {
    for (const input of [request("gpt-image-2.5-x", { tier: "4k" }), request("gpt-image-2-x", { size: "0x2160" }),
      request("gpt-image-2-x", { tier: "8k" }), request("gpt-image-2-x", { tier: "4k", quality: "auto" }), request("midjourney-v7", { n: 2 })]) {
      const { adapter, fetcher } = adapterFor(input.model!);
      await expect(adapter.submit(input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
    }
    expect(cangyuanCurrentRequestIssues(request("gpt-image-2-x", { tier: "4k", quality: "max" }), "https://other.example")).toEqual([]);
    const { adapter, fetcher } = adapterFor("gpt-image-2.5-x");
    const assets = Array.from({ length: 10 }, (_, i) => ({ id: String(i), kind: "image" as const, mimeType: "image/png", url: `https://images.example/${i}.png` }));
    await expect(adapter.submit({ ...request("gpt-image-2.5-x", { tier: "web", series: "flare" }), assets })).rejects.toThrow(/9/u);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await adapter.validate({ ...request("gpt-image-2.5-x", { tier: "4k", series: "flare", quality: "max" }), assets })).valid).toBe(false);
  });

  it("decodes exact CNY prices for every series, tier and quality using the original billing expression", () => {
    for (const id of ["gpt-image-2-x", "gpt-image-2.5-x"]) {
      const row = fixture.data.find((r: { model_name: string }) => r.model_name === id);
      const pricing = cangyuanCurrentPricing(id, row.billing_expr, 1, fixture.checkedAt)!;
      expect(pricing.currency).toBe("CNY"); expect(pricing.confidence).toBe("exact");
      for (const series of ["flare", "sunburst"]) for (const tier of ["web", "1k", "2k", "4k"]) for (const quality of ["auto", "low", "medium", "high", "xhigh", "max"]) {
        const expected = id === "gpt-image-2-x" ? ({ web: 0.015, "1k": 0.055, "2k": 0.075, "4k": 0.095 })[tier as "web"] :
          tier === "web" ? 0.025 : ({ flare: { "1k": 0.16, "2k": 0.18, "4k": 0.20 }, sunburst: { "1k": 0.18, "2k": 0.20, "4k": 0.22 } })[series as "flare"][tier as "1k"] * (["xhigh", "max"].includes(quality) ? 2 : 1);
        expect(modelPriceAmount(pricing, { series, tier, quality })).toBeCloseTo(expected);
      }
      expect(cangyuanCurrentPricing(id, `${row.billing_expr}; malicious()`, 1, "now")).toBeUndefined();
    }
  });

  it("preserves an explicitly configured legal transport rather than replacing its endpoint or literal fields", async () => {
    const { connector } = adapterFor("gpt-image-2.5-x");
    connector.modelOverrides = { "gpt-image-2.5-x": { submit: { path: "/v1/images/generations", method: "POST", bodyMode: "json",
      template: { model: "gpt-image-2.5-x", series: "flare", tier: "4k", quality: "max", n: 1, response_format: "url" },
      mappings: [{ target: "/prompt", source: { kind: "request", path: "$.prompt" } }] } } };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ url: "https://images.example/manual.png" }] }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "one", provider: "rest", baseUrl, apiKey: "offline-test",
      settings: { preset: "cangyuan-gpt-image-2", connector } }]), { fetch: fetcher });
    await adapter.submit(request("gpt-image-2.5-x"));
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({ model: "gpt-image-2.5-x", series: "flare", tier: "4k", quality: "max", n: 1,
      response_format: "url", prompt: "offline contract test" });
  });

  it("validates the new declarative when enums before fetching", async () => {
    const { connector } = adapterFor("gpt-image-2-x");
    connector.submit = { path: "/v1/images/generations", method: "POST", bodyMode: "json", mappings: [{ target: "/quality",
      source: { kind: "request", path: "$.parameters.quality" }, when: [{ path: "$.parameters.tier", values: [] }] }] };
    const fetcher = vi.fn<typeof fetch>();
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "one", provider: "rest", baseUrl, apiKey: "offline-test",
      settings: { connector } }]), { fetch: fetcher });
    await expect(adapter.submit(request("gpt-image-2-x", { tier: "4k", quality: "max" }))).rejects.toThrow(/when/u);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("2026-10-12 Cangyuan document changes", () => {
  it("sends expanded native n/background/encoding/compression/response fields without discarding choices", async () => {
    const id = "gpt-image-2.5-flare-az", parameters = { n: 3, size: "2336x3520", quality: "max", background: "transparent", output_format: "png", output_compression: 87, moderation: "low", response_format: "b64_json", async: false };
    const { adapter, fetcher } = adapterFor(id);
    await adapter.submit(request(id, parameters));
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({ model: id, prompt: "offline contract test", ...parameters });
    for (const n of [0, 11, 1.5, "3"]) expect(cangyuanCurrentRequestIssues(request(id, { n }), baseUrl)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.n" })]));
  });
  it("retains the user's highest quality where a GPT document omitted quality", async () => {
    for (const [id, quality] of [["gpt-image-2", "high"], ["gpt-image-2.5-flare", "max"]] as const) {
      const current = descriptor(id);
      expect(current.parameters?.find(p => p.key === "quality")?.default).toBe(quality);
      expect(current.metadata?.imageUserQualityPresetSource).toBe("user-request");
      const { adapter, fetcher } = adapterFor(id);
      await adapter.submit(request(id, { quality, n: 2, size: "3840x2160" }));
      expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toMatchObject({ quality, n: 2, size: "3840x2160" });
    }
  });
  it("enforces exact fixed-tier dimension rules and true enums while leaving recommendations open", () => {
    const id = "gpt-image-2-4k";
    expect(descriptor(id).parameters?.find(p => p.key === "size")).toMatchObject({ step: 16, max: 3840, allowCustomValue: true });
    expect(cangyuanCurrentRequestIssues(request(id, { size: "3840x2160", quality: "high", output_format: "webp" }), baseUrl)).toEqual([]);
    for (const size of ["3841x2160", "4096x2048", "640x640", "3840x3840", "3840x640"]) expect(cangyuanCurrentRequestIssues(request(id, { size }), baseUrl)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.size" })]));
    expect(cangyuanCurrentRequestIssues(request(id, { quality: "auto" }), baseUrl)).not.toEqual([]);
    expect(cangyuanCurrentRequestIssues(request("gpt-image-2.5-x", { series: "flare", aspect_ratio: "9:21", quality: "max" }), baseUrl)).toEqual([]);
  });
  it("migrates an exact previous native override from normal or cached catalogs but preserves manual and custom mappings", () => {
    const id = "gpt-image-2.5-x", previous = JSON.parse(readFileSync(new URL("./fixtures/cangyuan-prior-image-contract.json", import.meta.url), "utf8"));
    const { connector } = adapterFor(id);
    connector.modelOverrides = { [id]: previous };
    for (const source of ["live", "cached"]) expect(managesCangyuanCurrentTransport({ connector, catalogSource: source }, baseUrl, connector, id)).toBe(true);
    expect(managesCangyuanCurrentTransport({ connector, manualProtocol: true }, baseUrl, connector, id)).toBe(false);
    expect(managesCangyuanCurrentTransport({ connector, manualModels: [{ id }] }, baseUrl, connector, id)).toBe(false);
    const custom = structuredClone(connector); custom.modelOverrides![id]!.submit!.path = "/custom/images";
    expect(managesCangyuanCurrentTransport({ connector: custom }, baseUrl, custom, id)).toBe(false);
  });
});
