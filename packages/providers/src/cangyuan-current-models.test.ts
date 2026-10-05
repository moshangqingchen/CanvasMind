import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { cangyuanCurrentModel, cangyuanCurrentPricing, cangyuanCurrentRequestIssues, cangyuanCurrentTransport } from "./cangyuan-current-models.js";
import { StaticConnectionResolver } from "./credentials.js";
import { modelPriceAmount } from "./media-billing.js";
import { GenericRestAdapter, restRequestRequiresPublicAssets, type RestConnectorConfig } from "./rest.js";
import { IMAGE_SIZE_RATIOS } from "./image-size-presets.js";
import type { ModelDescriptor, NormalizedRequest } from "./contracts.js";

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
  it("uses documented native controls rather than inherited family fields", () => {
    for (const id of ["gpt-image-2-x", "gpt-image-2.5-x"]) {
      const model = descriptor(id);
      expect(model.parameters?.find(p => p.key === "tier")).toMatchObject({ default: "4k", options: [
        { label: "web", value: "web" }, { label: "1k", value: "1k" }, { label: "2k", value: "2k" }, { label: "4k", value: "4k" },
      ] });
      expect(model.parameters?.find(p => p.key === "quality")).toMatchObject({ default: "max", visibleWhen: [{ parameter: "tier", values: ["1k", "2k", "4k"] }] });
    }
    expect(descriptor("gpt-image-2-x").parameters?.find(p => p.key === "quality")?.options?.map(o => o.value)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(descriptor("gpt-image-2.5-x").parameters?.find(p => p.key === "quality")?.options?.map(o => o.value)).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
    expect(descriptor("gpt-image-2.5-x").parameters?.find(p => p.key === "series")).toMatchObject({ default: "sunburst", required: true });
    for (const id of ["midjourney-v7", "seedream-5.0-pro-x"]) expect(descriptor(id).parameters?.some(p => ["quality", "speed", "tier"].includes(p.key))).toBe(false);
    expect(descriptor("midjourney-v7").metadata?.imageSupportedResolutions).toEqual([]);
    expect(descriptor("seedream-5.0-pro-x").metadata?.imageSupportedResolutions).toEqual(["1K", "2K"]);
  });

  it.each(["gpt-image-2-x", "gpt-image-2.5-x"])("omits web quality and forbidden fields for %s", async id => {
    const { adapter, fetcher } = adapterFor(id);
    await adapter.submit(request(id, { tier: "web", series: "flare", quality: "max", aspect_ratio: "16:9", image_size: "4K", output_resolution: "4K", background: "opaque" }));
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({ model: id, prompt: "offline contract test", tier: "web", n: 1,
      size: "16:9", async: true, response_format: "url", ...(id === "gpt-image-2.5-x" ? { series: "flare" } : {}) });
  });

  it.each(["gpt-image-2-x", "gpt-image-2.5-x"])("maps every K/ratio request through legal native fields for %s", async id => {
    for (const tier of ["1k", "2k", "4k"]) for (const ratio of IMAGE_SIZE_RATIOS) {
      const { adapter, fetcher } = adapterFor(id);
      await adapter.submit(request(id, { tier, series: "sunburst", quality: "max", aspect_ratio: ratio }));
      const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
      expect(body.tier).toBe(tier); expect(body.quality).toBe("max");
      if (ratio === "9:21") {
        expect(body.size).toMatch(/^\d+x\d+$/u);
        const [w, h] = body.size.split("x").map(Number);
        expect(w / h).toBeCloseTo(9 / 21, 1);
      } else expect(body.size).toBe(ratio);
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
    expect(restRequestRequiresPublicAssets(connector, "gpt-image-2.5-x", "image.edit", settings)).toBe(true);
    expect(restRequestRequiresPublicAssets(connector, "unrelated", "image.edit", settings)).toBe(false);
    expect(restRequestRequiresPublicAssets(connector, "gpt-image-2.5-x", "image.edit", { ...settings, baseUrl: "https://other.example" })).toBe(false);
    expect(restRequestRequiresPublicAssets(connector, "gpt-image-2.5-x", "image.edit", { ...settings, manualModels: [{ id: "gpt-image-2.5-x" }] })).toBe(false);
    expect(connector).toEqual(before);
  });

  it("keeps Midjourney's ten declared ratios and rejects the unresolved 9:21 before payment", async () => {
    for (const ratio of IMAGE_SIZE_RATIOS) {
      const { adapter, fetcher } = adapterFor("midjourney-v7", { id: "mj-task", status: "running" });
      if (ratio === "9:21") { await expect(adapter.submit(request("midjourney-v7", { aspect_ratio: ratio }))).rejects.toThrow(/9:21/u); expect(fetcher).not.toHaveBeenCalled(); continue; }
      const task = await adapter.submit(request("midjourney-v7", { aspect_ratio: ratio, quality: "max", speed: "fast", tier: "4k" }));
      const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
      expect(body.size).toBe(ratio); expect(body.n).toBe(1); expect(body).not.toHaveProperty("quality"); expect(body).not.toHaveProperty("speed"); expect(body).not.toHaveProperty("tier");
      fetcher.mockResolvedValueOnce(Response.json({ id: "mj-task", status: "completed", data: [{ url: "https://images.example/one.png" }, { url: "https://images.example/two.png" }] }));
      const completed = await adapter.poll(task);
      expect(completed.status).toBe("succeeded");
      expect(String(fetcher.mock.calls[1]![0])).toBe(`${baseUrl}/v1/images/generations/mj-task`);
      expect((await adapter.extractOutputs(completed.result)).map(output => output.url)).toEqual(["https://images.example/one.png", "https://images.example/two.png"]);
    }
  });

  it("converges all Seedream request ratios to eight native shapes without quality", async () => {
    for (const ratio of IMAGE_SIZE_RATIOS) {
      const { adapter, fetcher } = adapterFor("seedream-5.0-pro-x");
      await adapter.submit(request("seedream-5.0-pro-x", { aspect_ratio: ratio, quality: "max" }));
      const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
      expect(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"]).toContain(body.size);
      if (["5:4", "4:5", "9:21"].includes(ratio)) expect(body.size).toBe(({ "5:4": "4:3", "4:5": "3:4", "9:21": "9:16" })[ratio as "5:4"]);
      expect(body).not.toHaveProperty("quality"); expect(body).not.toHaveProperty("aspect_ratio");
    }
  });

  it("blocks missing series, ambiguous legacy dimensions, invalid tier/count and excessive references before fetch", async () => {
    for (const input of [request("gpt-image-2.5-x", { tier: "4k" }), request("gpt-image-2-x", { size: "3840x2160" }),
      request("gpt-image-2-x", { quality: "max" }), request("gpt-image-2-x", { tier: "8k" }), request("gpt-image-2-x", { tier: "4k", quality: "auto" }), request("midjourney-v7", { n: 2 })]) {
      const { adapter, fetcher } = adapterFor(input.model!);
      await expect(adapter.submit(input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
    }
    expect(cangyuanCurrentRequestIssues(request("gpt-image-2-x", { tier: "4k", quality: "max" }), "https://other.example")).toEqual([]);
    const { adapter, fetcher } = adapterFor("gpt-image-2.5-x");
    const assets = Array.from({ length: 10 }, (_, i) => ({ id: String(i), kind: "image" as const, mimeType: "image/png", url: `https://images.example/${i}.png` }));
    await expect(adapter.submit({ ...request("gpt-image-2.5-x", { tier: "web", series: "flare" }), assets })).rejects.toThrow(/9/u);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await adapter.validate({ ...request("gpt-image-2.5-x", { tier: "4k", series: "flare", quality: "max" }), assets })).valid).toBe(true);
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
