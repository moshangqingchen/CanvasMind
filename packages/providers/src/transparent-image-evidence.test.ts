import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const offlineNetwork = vi.hoisted(() => ({
  lookup: vi.fn<(hostname: string, options?: unknown) => Promise<{ address: string; family: number }[]>>(
    async () => [{ address: "203.0.113.10", family: 4 }]),
  fetch: vi.fn(),
}));
// Preserve exact official host identities used by measured contract assertions,
// while isolating the endpoint safety guard's pre-transport DNS lookup.
vi.mock("node:dns/promises", () => ({ lookup: offlineNetwork.lookup }));
import type { FetchImplementation, NormalizedRequest } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { getImageEditingCapabilities, imageEditingRequestIssues, usesDeclaredImagesEditingRoute } from "./image-editing-capabilities.js";
import { FAILED_TRANSPARENT_IMAGE_TESTS, VERIFIED_TRANSPARENT_IMAGES, failedTransparentImageEvidence, verifiedTransparentImageEvidence, verifiedTransparentImageJsonEndpoint,
  type TransparentImageEvidence } from "./transparent-image-evidence.js";
import * as transparency from "./transparent-image-evidence.js";
import { PdogImageAdapter } from "./pdog-image.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";

const model = "gpt-image-2.5-sunburst";
const group = "高质量生图专线";
const source = { provider: "openai", config: { baseUrl: "https://synoralink.com/v1", modelGroup: group, accountKeyGroup: group } };
const request: NormalizedRequest = { connectionId: "one", model, operation: "image.generate",
  prompt: "一只陶瓷狐狸摆件", idempotencyKey: "offline-transparent-test",
  parameters: { size: "3840x2160", quality: "max", n: 1, background: "transparent", output_format: "png" } };

function fixture(settings: Record<string, unknown> = {}) {
  const fetch = vi.fn<FetchImplementation>(async () => Response.json({ data: [{ url: "https://assets.example/result.png" }] }));
  const resolver = new StaticConnectionResolver([{ id: "one", provider: "openai", apiKey: "offline-only", baseUrl: source.config.baseUrl,
    settings: { ...source.config, ...settings } }]);
  return { fetch, adapter: createDefaultProviderRegistry(resolver, { fetch }).get("openai") };
}
const saved = { autoModelInterfaces: { [model]: {
  model: { id: model, name: model, operations: ["image.generate"] },
  connector: { submit: { path: "/v1/legacy-image", method: "POST", bodyMode: "json", template: { model },
    mappings: [{ target: "/prompt", source: { kind: "request", path: "$.prompt" } }] },
    output: { path: "$.data", kind: "image", urlPath: "$.url" } },
} } };
const codexEvidence = VERIFIED_TRANSPARENT_IMAGES.find(row => row.provider === "weai" &&
  row.hostname === "asian-acc.we-token.cc" && row.group === "生图-openai-codex-token计费" && row.model === "gpt-image-2")!;
const fixtureHosts = new Set([...VERIFIED_TRANSPARENT_IMAGES, ...FAILED_TRANSPARENT_IMAGE_TESTS].map(row => row.hostname));

describe("measured transparent image routes", () => {
  beforeEach(() => {
    offlineNetwork.lookup.mockClear();
    offlineNetwork.fetch.mockReset().mockRejectedValue(new Error("Unexpected real HTTP in transparent evidence test"));
    vi.stubGlobal("fetch", offlineNetwork.fetch);
  });
  afterEach(() => {
    try {
      expect(offlineNetwork.fetch).not.toHaveBeenCalled();
      for (const [hostname, options] of offlineNetwork.lookup.mock.calls) {
        expect(fixtureHosts.has(hostname)).toBe(true);
        expect(options).toEqual({ all: true, verbatim: true });
      }
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("accepts only exact static Images JSON paths and retains all identity and selector boundaries", () => {
    const evidence: TransparentImageEvidence = { ...codexEvidence, selectors: { tier: "1k" } };
    const measured = { provider: evidence.provider, config: { baseUrl: `https://${evidence.hostname}/v1`,
      modelGroup: evidence.group, accountKeyGroup: evidence.group } };
    for (const path of ["/v1/images/generations", "/images/generations"])
      expect(verifiedTransparentImageJsonEndpoint(measured, evidence.model, { tier: "1k" },
        { ...evidence, transport: { ...evidence.transport, path } }, "openai-images")).toBe(`https://${evidence.hostname}${path}`);
    for (const transport of [
      { ...evidence.transport, path: "/other/images/generations" },
      { ...evidence.transport, path: "/images/generations?channel=other" },
      { ...evidence.transport, bodyMode: "multipart" as const },
      { ...evidence.transport, kind: "saved-rest" as const },
    ]) expect(verifiedTransparentImageJsonEndpoint(measured, evidence.model, { tier: "1k" }, { ...evidence, transport }, "openai-images")).toBeUndefined();
    expect(verifiedTransparentImageJsonEndpoint(measured, evidence.model, { tier: "2k" }, evidence, "openai-images")).toBeUndefined();
    expect(verifiedTransparentImageJsonEndpoint(measured, `${evidence.model}-other`, { tier: "1k" }, evidence, "openai-images")).toBeUndefined();
    expect(verifiedTransparentImageJsonEndpoint({ ...measured, config: { ...measured.config, accountKeyGroup: "other" } },
      evidence.model, { tier: "1k" }, evidence, "openai-images")).toBeUndefined();
    expect(verifiedTransparentImageJsonEndpoint({ ...measured, config: { ...measured.config, baseUrl: "https://other.example/v1" } },
      evidence.model, { tier: "1k" }, evidence, "openai-images")).toBeUndefined();
  });

  it.each(["https://asian-acc.we-token.cc", "https://asian-acc.we-token.cc/v1"])(
    "pins a fixture root-path proof without altering We Codex normal routing at %s", async baseUrl => {
      const evidence = { ...codexEvidence, transport: { ...codexEvidence.transport, path: "/images/generations" } };
      vi.spyOn(transparency, "verifiedTransparentImageEvidence").mockReturnValue(evidence);
      const fetch = vi.fn<FetchImplementation>(async () => Response.json({ data: [{ url: "https://assets.example/result.png" }] }));
      const resolver = new StaticConnectionResolver([{ id: "one", provider: "weai", apiKey: "offline-only", baseUrl,
        settings: { modelGroup: evidence.group, accountKeyGroup: evidence.group, scannedModelIds: [evidence.model] } }]);
      const adapter = createDefaultProviderRegistry(resolver, { fetch }).get("weai");
      await adapter.submit({ ...request, model: evidence.model, parameters: evidence.request });
      expect(String(fetch.mock.calls[0]![0])).toBe("https://asian-acc.we-token.cc/images/generations");
      expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ model: evidence.model, prompt: request.prompt, ...evidence.request });
      await adapter.submit({ ...request, model: evidence.model, parameters: { size: "1024x1024", n: 1, background: "opaque" } });
      expect(String(fetch.mock.calls[1]![0])).toBe("https://asian-acc.we-token.cc/v1/images/generations");
      expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).toEqual({ model: evidence.model, prompt: request.prompt, size: "1024x1024", n: 1 });
    });

  it("extends only a fixture REST JSON body and preserves its async polling, extraction, and ordinary request", async () => {
    const evidence: TransparentImageEvidence = { ...codexEvidence, provider: "rest", hostname: "provider.test", group: "fixture",
      selectors: { tier: "1k" }, transport: { kind: "saved-rest", path: "/v1/images/generations", method: "POST", bodyMode: "json" } };
    vi.spyOn(transparency, "verifiedTransparentImageEvidence").mockReturnValue(evidence);
    const config: RestConnectorConfig = { auth: { type: "bearer" }, restrictModels: true,
      models: [{ id: evidence.model, name: evidence.model, operations: ["image.generate"] }],
      submit: { path: evidence.transport.path, method: "POST", bodyMode: "json",
        template: { model: evidence.model, background: "opaque", output_format: "jpeg", keep: { route: "native" } },
        mappings: [{ target: "/prompt", source: { kind: "request", path: "$.prompt" } }],
        response: { taskIdPath: "$.job.id", statusPath: "$.job.state" } },
      poll: { path: "/jobs/{taskId}", method: "GET", bodyMode: "none", response: { statusPath: "$.job.state" } },
      output: { path: "$.outputs[*]", kind: "image", urlPath: "$.url" }, statusMap: { ACCEPTED: "running", COMPLETE: "succeeded" },
    };
    const fetch = vi.fn<FetchImplementation>(async (_, init) => Response.json(init?.method === "POST"
      ? { job: { id: "existing-task", state: "ACCEPTED" } }
      : { job: { state: "COMPLETE" }, outputs: [{ url: "https://assets.example/result.png" }] }));
    const resolver = new StaticConnectionResolver([{ id: "one", provider: "rest", apiKey: "offline-only", baseUrl: "https://provider.test/v1",
      settings: { modelGroup: evidence.group, accountKeyGroup: evidence.group, connector: config } }]);
    const adapter = new GenericRestAdapter(resolver, { fetch });
    const restRequest = { ...request, model: evidence.model, parameters: { tier: "1k", background: "transparent", output_format: "png" } };
    const task = await adapter.submit(restRequest);
    expect(String(fetch.mock.calls[0]![0])).toBe("https://provider.test/v1/images/generations");
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ ...config.submit.template as object,
      prompt: request.prompt, background: "transparent", output_format: "png" });
    expect(task.status).toBe("running");
    expect(task.result).toMatchObject({ config: { submit: config.submit, poll: config.poll, output: config.output, statusMap: config.statusMap } });
    const completed = await adapter.poll(task);
    expect(completed.status).toBe("succeeded");
    expect(String(fetch.mock.calls[1]![0])).toBe("https://provider.test/jobs/existing-task");
    expect(fetch.mock.calls[1]![1]?.body).toBeUndefined();
    expect(await adapter.extractOutputs(completed.result)).toEqual([{ kind: "image", url: "https://assets.example/result.png" }]);
    await adapter.submit({ ...restRequest, parameters: { tier: "1k", background: "opaque" } });
    expect(JSON.parse(String(fetch.mock.calls[2]![1]?.body))).toEqual({ ...config.submit.template as object, prompt: request.prompt });
    expect(config.submit.template).toEqual({ model: evidence.model, background: "opaque", output_format: "jpeg", keep: { route: "native" } });
  });

  it.each(["path", "query", "method", "multipart", "wire-model", "selector", "group", "origin"])(
    "rejects a fixture REST proof's mismatched %s before any network request", async mismatch => {
      const evidence: TransparentImageEvidence = { ...codexEvidence, provider: "rest", hostname: "provider.test", group: "fixture",
        selectors: { tier: "1k" }, transport: { kind: "saved-rest", path: "/v1/images/generations", method: "POST", bodyMode: "json" } };
      vi.spyOn(transparency, "verifiedTransparentImageEvidence").mockReturnValue(evidence);
      const fetch = vi.fn<FetchImplementation>();
      const config: RestConnectorConfig = { submit: { path: mismatch === "path" ? "/images/generations" :
        mismatch === "query" ? "/v1/images/generations?channel=other" : evidence.transport.path,
        method: mismatch === "method" ? "GET" : "POST", bodyMode: mismatch === "multipart" ? "multipart" : "json",
        template: { model: mismatch === "wire-model" ? "other-model" : evidence.model } },
        output: { path: "$.data", kind: "image", urlPath: "$.url" } };
      const resolver = new StaticConnectionResolver([{ id: "one", provider: "rest", apiKey: "offline-only",
        baseUrl: mismatch === "origin" ? "https://other.test/v1" : "https://provider.test/v1",
        settings: { modelGroup: evidence.group, accountKeyGroup: mismatch === "group" ? "other" : evidence.group, connector: config } }]);
      const adapter = new GenericRestAdapter(resolver, { fetch });
      await expect(adapter.submit({ ...request, model: evidence.model,
        parameters: { tier: mismatch === "selector" ? "2k" : "1k", background: "transparent" } })).rejects.toThrow(/透明/u);
      expect(fetch).not.toHaveBeenCalled();
    });

  it("reuses We Codex's exact transparency proof without claiming the requested 4K dimensions", () => {
    const codex = { provider: "weai", config: { baseUrl: "https://asian-acc.we-token.cc/v1",
      modelGroup: "生图-openai-codex-token计费", accountKeyGroup: "生图-openai-codex-token计费" } };
    expect(verifiedTransparentImageEvidence(codex, "gpt-image-2")).toMatchObject({
      checkedAt: "2026-10-05", request: { size: "3840x2160" },
      output: { width: 1254, height: 1254, format: "png", fullyTransparentPixelRatio: 0.4988120947577004 },
    });
    expect(getImageEditingCapabilities(codex, "gpt-image-2")).toEqual({ transparent: true, mask: null });
    for (const config of [
      { modelGroup: "生图-openai-adobe-token计费", accountKeyGroup: "生图-openai-adobe-token计费" },
      { accountKeyGroup: "生图-openai-adobe-token计费" },
      { baseUrl: "https://asian-acc.we-token.cc.example/v1" },
      { supplierArchived: true }, { usage: "agent" }, { usage: "disabled" },
    ]) expect(getImageEditingCapabilities({ ...codex, config: { ...codex.config, ...config } }, "gpt-image-2").transparent).toBe(false);
    expect(getImageEditingCapabilities({ ...codex, provider: "openai" }, "gpt-image-2").transparent).toBe(false);
    expect(getImageEditingCapabilities(codex, "gpt-image-2-1k").transparent).toBe(false);
    for (const oldModel of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])
      expect(getImageEditingCapabilities({ provider: "openai", config: { baseUrl: "https://api.eaheng.com/v1",
        modelGroup: "B1-GPT生图原生渠道V1", accountKeyGroup: "B1-GPT生图原生渠道V1" } }, oldModel).transparent).toBe(false);
  });

  it.each([
    ["rest", "api.3365api.cn", "image-2稳定生图", "gpt-image-2", "saved-rest", "/v1/images/generations", 1254],
    ["rest", "api.3365api.cn", "image-2稳定生图", "gpt-image-2-2K", "saved-rest", "/v1/images/generations", 1254],
    ["openai", "tu.988236.xyz", "1k低价生图", "gpt-image-2.5", "openai-images", "/v1/images/generations", 1254],
    ["openai", "api.frimodel.com", "openai_official_外接", "gpt-image-2.5-flare", "openai-images", "/v1/images/generations", 1024],
    ["openai", "api.frimodel.com", "openai_official_外接", "gpt-image-2.5-sunburst", "openai-images", "/v1/images/generations", 1024],
    ["openai", "api.frimodel.com", "gpt_image_web", "gpt-image-2-w", "openai-images", "/v1/images/generations", 1254],
    ["openai", "api.frimodel.com", "gpt_image_web", "gpt-image-2.5", "openai-images", "/v1/images/generations", 1254],
    ["openai", "api.frimodel.com", "gpt_image_az", "gpt-image-2-az", "openai-images", "/v1/images/generations", 1024],
    ["openai", "api.hangzhale.com", "Image - 1k", "gpt-image-2", "openai-images", "/images/generations", 1254],
    ["openai", "api.hangzhale.com", "Image - 1k", "gpt-image-2.5", "openai-images", "/images/generations", 1254],
    ["openai", "api.hangzhale.com", "Image - 1k", "gpt-image-2.5-flare", "openai-images", "/images/generations", 1254],
    ["openai", "api.hangzhale.com", "Image - 1k", "gpt-image-2.5-sunburst", "openai-images", "/images/generations", 1254],
    ["openai", "synoralink.com", "OAI官Key生图", "gpt-image-2.5-flare", "openai-images", "/v1/images/generations", 1024],
    ["openai", "synoralink.com", "OAI官Key生图", "gpt-image-2.5-sunburst", "openai-images", "/v1/images/generations", 1024],
    ["openai", "tu.988236.xyz", "1k福利生图", "gpt-image-2-1k", "openai-images", "/v1/images/generations", 1024],
    ["openai", "tu.988236.xyz", "az渠道image系列token计费", "AZ-gpt-image-2", "openai-images", "/v1/images/generations", 1024],
  ] as const)("keeps incremental proof exact for %s/%s/%s/%s", (provider, hostname, group, model, kind, path, dimension) => {
    const measured = { provider, config: { baseUrl: `https://${hostname}/v1`, modelGroup: group, accountKeyGroup: group } };
    const proof = verifiedTransparentImageEvidence(measured, model);
    expect(proof).toMatchObject({ checkedAt: "2026-10-07", transport: { kind, path, method: "POST", bodyMode: "json" },
      output: { width: dimension, height: dimension, format: "png" } });
    expect(verifiedTransparentImageJsonEndpoint(measured, model, {}, proof, kind)).toBe(`https://${hostname}${path}`);
    for (const config of [
      { accountKeyGroup: "different-live-group" },
      { modelGroup: "different-live-group", accountKeyGroup: "different-live-group" },
      { baseUrl: `https://${hostname}.example/v1` },
      { supplierArchived: true }, { usage: "disabled" },
    ]) expect(verifiedTransparentImageEvidence({ ...measured, config: { ...measured.config, ...config } }, model)).toBeUndefined();
    expect(verifiedTransparentImageEvidence(measured, `${model}-unmeasured`)).toBeUndefined();
  });

  it("records incremental dimensions and halo limitations without promoting requested size or unsent quality", () => {
    const afei2k = verifiedTransparentImageEvidence({ provider: "rest", config: { baseUrl: "https://api.3365api.cn/v1",
      accountKeyGroup: "image-2稳定生图" } }, "gpt-image-2-2K")!;
    expect(afei2k.request.size).toBe("2048x2048");
    expect(afei2k.output).toMatchObject({ width: 1254, height: 1254 });
    const chentu1k = verifiedTransparentImageEvidence({ provider: "openai", config: { baseUrl: "https://tu.988236.xyz/v1",
      accountKeyGroup: "1k低价生图" } }, "gpt-image-2.5")!;
    expect(chentu1k.request.size).toBe("1024x1024");
    expect(chentu1k.output).toMatchObject({ width: 1254, height: 1254, fullyTransparentPixelRatio: 0.6457943830142269 });
    const az = verifiedTransparentImageEvidence({ provider: "openai", config: { baseUrl: "https://tu.988236.xyz/v1",
      accountKeyGroup: "az渠道image系列token计费" } }, "AZ-gpt-image-2")!;
    expect(az.request).not.toHaveProperty("quality");
    for (const [hostname, group, models] of [
      ["api.frimodel.com", "openai_official_外接", ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]],
      ["api.frimodel.com", "gpt_image_az", ["gpt-image-2-az"]],
      ["synoralink.com", "OAI官Key生图", ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]],
      ["tu.988236.xyz", "az渠道image系列token计费", ["AZ-gpt-image-2"]],
    ] as const) for (const model of models) {
      const proof = verifiedTransparentImageEvidence({ provider: "openai", config: { baseUrl: `https://${hostname}`, accountKeyGroup: group } }, model)!;
      expect(proof.output.visualNotes).toMatch(/光晕.*未验证精细抠图/u);
      expect(proof.output).toMatchObject({ width: 1024, height: 1024 });
    }
    for (const [provider, hostname, group, model] of [
      ["rest", "api.3365api.cn", "image-2稳定生图", "gpt-image-2-2k"],
      ["openai", "api.frimodel.com", "gpt_image_web", "gpt-image-2"],
      ["openai", "synoralink.com", "OAI官Key生图", "gpt-image-2"],
      ["openai", "tu.988236.xyz", "1k福利生图", "gpt-image-2-2k"],
      ["openai", "tu.988236.xyz", "1k低价生图", "gpt-image-2"],
    ] as const) expect(verifiedTransparentImageEvidence({ provider, config: { baseUrl: `https://${hostname}/v1`, accountKeyGroup: group } }, model)).toBeUndefined();
  });

  it("sends We Codex's verified PNG fields while retaining its ordinary saved route and live permission guard", async () => {
    const codexGroup = "生图-openai-codex-token计费";
    const baseSettings = { modelGroup: codexGroup, accountKeyGroup: codexGroup, supplierKey: "weai",
      scannedModelIds: ["gpt-image-2"], autoModelInterfaces: { "gpt-image-2": {
        model: { id: "gpt-image-2", name: "gpt-image-2", operations: ["image.generate"] },
        connector: { ...saved.autoModelInterfaces[model].connector,
          submit: { ...saved.autoModelInterfaces[model].connector.submit, template: { model: "gpt-image-2" } } },
      } } };
    const fetch = vi.fn<FetchImplementation>(async () => Response.json({ data: [{ url: "https://assets.example/result.png" }] }));
    const resolver = new StaticConnectionResolver([{ id: "one", provider: "weai", apiKey: "offline-only",
      baseUrl: "https://asian-acc.we-token.cc", settings: baseSettings }]);
    const adapter = createDefaultProviderRegistry(resolver, { fetch }).get("weai");
    const codexRequest: NormalizedRequest = { ...request, model: "gpt-image-2",
      parameters: { size: "3840x2160", n: 1, background: "transparent", output_format: "png" } };
    await adapter.submit(codexRequest);
    expect(String(fetch.mock.calls[0]![0])).toBe("https://asian-acc.we-token.cc/v1/images/generations");
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ model: "gpt-image-2", prompt: request.prompt, ...codexRequest.parameters });
    await adapter.submit({ ...codexRequest, parameters: { size: "1024x1024", n: 1, background: "opaque" } });
    expect(String(fetch.mock.calls[1]![0])).toBe("https://asian-acc.we-token.cc/v1/legacy-image");
    expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).toEqual({ model: "gpt-image-2", prompt: request.prompt });

    const deniedFetch = vi.fn<FetchImplementation>(async () => Response.json({ data: [{ url: "https://assets.example/result.png" }] }));
    const deniedResolver = new StaticConnectionResolver([{ id: "one", provider: "weai", apiKey: "offline-only",
      baseUrl: "https://asian-acc.we-token.cc/v1", settings: { ...baseSettings, scannedModelIds: ["unrelated"] } }]);
    const denied = createDefaultProviderRegistry(deniedResolver, { fetch: deniedFetch }).get("weai");
    await expect(denied.submit(codexRequest)).rejects.toThrow(/权限/u);
    await expect(adapter.submit({ ...codexRequest, parameters: { ...codexRequest.parameters, output_format: "jpeg" } })).rejects.toThrow(/PNG/u);
    expect(deniedFetch).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("enables only the measured Synora group and complete model", () => {
    expect(verifiedTransparentImageEvidence(source, model)).toMatchObject({ checkedAt: "2026-10-05",
      transport: { kind: "openai-images", path: "/v1/images/generations" },
      output: { width: 3840, height: 2160, fullyTransparentPixelRatio: 0.7653 } });
    expect(getImageEditingCapabilities(source, model)).toEqual({ transparent: true, mask: null });
    for (const id of ["gpt-image-2", "gpt-image-2.5", `${model}-max`, `${model}-4k`])
      expect(getImageEditingCapabilities(source, id).transparent, id).toBe(false);
    for (const config of [
      { modelGroup: "default", accountKeyGroup: "default" },
      { modelGroup: "default" }, { accountKeyGroup: "default" },
      { supplierArchived: true }, { usage: "agent" }, { usage: "disabled" },
    ]) expect(getImageEditingCapabilities({ ...source, config: { ...source.config, ...config } }, model).transparent).toBe(false);
    expect(getImageEditingCapabilities({ ...source, provider: "weai" }, model).transparent).toBe(false);
    expect(getImageEditingCapabilities({ ...source, provider: "rest" }, model).transparent).toBe(false);
  });

  it.each(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("retains %s transparency across Synora group 115's verified rename", measuredModel => {
    const renamed = { ...source, config: { ...source.config,
      modelGroup: "全参生图专线", accountKeyGroup: "全参生图专线", accountKeyGroupId: "115" } };
    const evidence = verifiedTransparentImageEvidence(renamed, measuredModel)!;
    expect(evidence).toMatchObject({ group: "高质量生图专线", supplierGroupId: "115", model: measuredModel,
      checkedAt: "2026-10-05", request: { size: "3840x2160", quality: "max", background: "transparent", output_format: "png" } });
    expect(getImageEditingCapabilities(renamed, measuredModel)).toEqual({ transparent: true, mask: null });
    expect(verifiedTransparentImageJsonEndpoint(renamed, measuredModel, evidence.request, evidence, "openai-images"))
      .toBe("https://synoralink.com/v1/images/generations");
    for (const config of [
      { accountKeyGroupId: "119" }, { accountKeyGroupId: undefined },
      { modelGroup: group, accountKeyGroup: group, accountKeyGroupId: "119" },
      { modelGroup: "Different group" }, { baseUrl: "https://synoralink.com/custom" },
      { baseUrl: "https://other.example/v1" }, { supplierArchived: true }, { usage: "agent" },
    ]) {
      const mismatched = { ...renamed, config: { ...renamed.config, ...config } };
      expect(verifiedTransparentImageEvidence(mismatched, measuredModel)).toBeUndefined();
      expect(getImageEditingCapabilities(mismatched, measuredModel).transparent).toBe(false);
    }
    expect(verifiedTransparentImageEvidence({ ...renamed, provider: "rest" }, measuredModel)).toBeUndefined();
    expect(verifiedTransparentImageEvidence(renamed, `${measuredModel}-adobe`)).toBeUndefined();
    expect(verifiedTransparentImageEvidence(renamed, "gpt-image-2")).toBeUndefined();
    expect(verifiedTransparentImageEvidence(source, measuredModel)).toBe(evidence);
  });

  it("sends the same measured Images contract after the proven group rename", async () => {
    const f = fixture({ ...saved, modelGroup: "全参生图专线", accountKeyGroup: "全参生图专线", accountKeyGroupId: "115" });
    expect((await f.adapter.validate(request)).valid).toBe(true);
    await f.adapter.submit(request);
    expect(f.fetch).toHaveBeenCalledOnce();
    expect(String(f.fetch.mock.calls[0]![0])).toBe("https://synoralink.com/v1/images/generations");
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toEqual({ model, prompt: request.prompt, ...request.parameters });
  });

  it("rejects unverified origins and paths without trusting supplier labels", () => {
    for (const baseUrl of ["http://synoralink.com/v1", "https://synoralink.com.example/v1", "https://user@synoralink.com/v1",
      "https://synoralink.com:8443/v1", "https://synoralink.com/custom", "https://synoralink.com/v1?route=other", "https://synoralink.com/v1#other"])
      expect(getImageEditingCapabilities({ ...source, config: { ...source.config, baseUrl } }, model).transparent, baseUrl).toBe(false);
    for (const baseUrl of ["https://synoralink.com", "https://synoralink.com/", "https://synoralink.com/v1/"])
      expect(getImageEditingCapabilities({ ...source, config: { ...source.config, baseUrl } }, model).transparent).toBe(true);
  });

  it("keeps evidence about actual transparent pixels and exact request parameters", () => {
    for (const evidence of VERIFIED_TRANSPARENT_IMAGES) {
      expect(evidence.request).toMatchObject({ background: "transparent", output_format: "png" });
      expect(evidence.output.fullyTransparentPixelRatio).toBeGreaterThan(0);
      expect(evidence.output.fullyTransparentPixelRatio).toBeLessThan(1);
      expect(evidence.transport.path.startsWith("/")).toBe(true);
      expect(Object.keys(evidence.selectors ?? {}).every(key => ["series", "tier"].includes(key))).toBe(true);
    }
  });

  it("uses the original opaque PNG to override only Monster B4's exact gpt-image-2.5 transparent mode", () => {
    const measured = { provider: "openai", config: { baseUrl: "https://api.eaheng.com/v1",
      modelGroup: "B4-GPT生图原生渠道V3（高质量）", accountKeyGroup: "B4-GPT生图原生渠道V3（高质量）" } };
    const failed = failedTransparentImageEvidence(measured, "gpt-image-2.5");
    expect(failed).toMatchObject({ checkedAt: "2026-10-05", reason: "opaque-png",
      request: { background: "transparent" }, output: { width: 3584, height: 2016, format: "png", transparentPixels: 0,
        sha256: "3fe934fe32643a339be1bb48298475bffd885226277060e73b2e35d4e9c8197e" } });
    expect(getImageEditingCapabilities(measured, "gpt-image-2.5")).toEqual({ transparent: false, mask: null });
    expect(usesDeclaredImagesEditingRoute(measured, "gpt-image-2.5")).toBe(true);
    expect(imageEditingRequestIssues(measured, { ...request, model: "gpt-image-2.5" })).toContainEqual(expect.objectContaining({
      code: "transparent_test_failed", message: "此线路的透明背景实测未通过，请使用普通模式。",
    }));
    for (const model of ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare-max"]) {
      expect(failedTransparentImageEvidence(measured, model)).toBeUndefined();
      expect(getImageEditingCapabilities(measured, model).transparent).toBe(true);
    }
    for (const config of [
      { modelGroup: "B1-GPT生图原生渠道V1", accountKeyGroup: "B1-GPT生图原生渠道V1" },
      { accountKeyGroup: "other" }, { baseUrl: "http://api.eaheng.com/v1" },
      { baseUrl: "https://api.eaheng.com.example/v1" }, { baseUrl: "https://api.eaheng.com:8443/v1" },
      { baseUrl: "https://user@api.eaheng.com/v1" }, { baseUrl: "https://api.eaheng.com/other" },
      { baseUrl: "https://api.eaheng.com/v1?channel=other" }, { supplierArchived: true }, { usage: "agent" },
    ]) expect(failedTransparentImageEvidence({ ...measured, config: { ...measured.config, ...config } }, "gpt-image-2.5")).toBeUndefined();
    expect(failedTransparentImageEvidence({ ...measured, provider: "rest" }, "gpt-image-2.5")).toBeUndefined();
    expect(FAILED_TRANSPARENT_IMAGE_TESTS.every(row => row.reason === "opaque-png" || row.reason === "background-rejected")).toBe(true);
  });

  it("limits the recovered opaque PNG failure to B4's exact sunburst-high model", () => {
    const measured = { provider: "openai", config: { baseUrl: "https://api.eaheng.com/v1",
      modelGroup: "B4-GPT生图原生渠道V3（高质量）", accountKeyGroup: "B4-GPT生图原生渠道V3（高质量）" } };
    const model = "gpt-image-2.5-sunburst-high";
    expect(failedTransparentImageEvidence(measured, model)).toEqual({
      provider: "openai", hostname: "api.eaheng.com", group: measured.config.modelGroup, model,
      transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
      checkedAt: "2026-10-07", request: { background: "transparent", n: 1, quality: "high", size: "3840x2160", output_format: "png" },
      reason: "opaque-png", output: { width: 3840, height: 2160, format: "png", transparentPixels: 0,
        sha256: "b12bfcea0006cc18c28fbbd4a8b0c5ad7d75c3cdbe0ebb3c8961c040a0002c01" },
    });
    expect(getImageEditingCapabilities(measured, model)).toEqual({ transparent: false, mask: null });
    expect(usesDeclaredImagesEditingRoute(measured, model)).toBe(true);
    // Cases 047-049 ended without image bytes; those errors are not opaque evidence.
    for (const other of ["gpt-image-2.5-flare", "gpt-image-2.5-flare-high", "gpt-image-2.5-sunburst", "gpt-image-2.5-sunburst-max"]) {
      expect(failedTransparentImageEvidence(measured, other)).toBeUndefined();
      expect(getImageEditingCapabilities(measured, other).transparent).toBe(true);
    }
    for (const config of [
      { modelGroup: "B3-GPT生图-特惠渠道", accountKeyGroup: "B3-GPT生图-特惠渠道" },
      { accountKeyGroup: "other" }, { baseUrl: "http://api.eaheng.com/v1" },
      { baseUrl: "https://api.eaheng.com.example/v1" }, { baseUrl: "https://api.eaheng.com:8443/v1" },
      { baseUrl: "https://user@api.eaheng.com/v1" }, { baseUrl: "https://api.eaheng.com/other" },
      { baseUrl: "https://api.eaheng.com/v1?channel=other" }, { supplierArchived: true }, { usage: "agent" },
    ]) expect(failedTransparentImageEvidence({ ...measured, config: { ...measured.config, ...config } }, model)).toBeUndefined();
    expect(failedTransparentImageEvidence({ ...measured, provider: "rest" }, model)).toBeUndefined();
  });

  it.each(["gpt-image-2.5", "gpt-image-2.5-sunburst-high"])("rejects the failed %s transparent test before any request while keeping normal generation on the declared route", async model => {
    const group = "B4-GPT生图原生渠道V3（高质量）";
    const fetch = vi.fn<FetchImplementation>(async () => Response.json({ data: [{ url: "https://assets.example/result.png" }] }));
    const resolver = new StaticConnectionResolver([{ id: "one", provider: "openai", apiKey: "offline-only",
      baseUrl: "https://api.eaheng.com/v1", settings: { modelGroup: group, accountKeyGroup: group } }]);
    const adapter = createDefaultProviderRegistry(resolver, { fetch }).get("openai");
    const transparentRequest = { ...request, model,
      parameters: { ...request.parameters, ...(model.endsWith("-high") ? { quality: "high" } : {}) } };
    expect((await adapter.validate(transparentRequest)).valid).toBe(false);
    await expect(adapter.submit(transparentRequest)).rejects.toThrow(/透明背景实测未通过/u);
    expect(fetch).not.toHaveBeenCalled();
    const task = await adapter.submit({ ...transparentRequest, parameters: { size: "1024x1024", quality: "high", n: 1, background: "opaque" } });
    expect(task.status).toBe("succeeded");
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]![0])).toBe("https://api.eaheng.com/v1/images/generations");
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toMatchObject({ model, prompt: request.prompt,
      size: "1024x1024", quality: "high", n: 1, background: "opaque" });
  });

  it("sends the measured 4K max request through the Images route with the prompt unchanged", async () => {
    const f = fixture(saved);
    expect((await f.adapter.validate(request)).valid).toBe(true);
    const task = await f.adapter.submit(request);
    expect(task.status).toBe("succeeded");
    expect(f.fetch).toHaveBeenCalledOnce();
    expect(String(f.fetch.mock.calls[0]![0])).toBe("https://synoralink.com/v1/images/generations");
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toEqual({ model, prompt: request.prompt, ...request.parameters });
  });

  it("does not replace an ordinary request's saved route when a new transparency proof is added", async () => {
    const f = fixture(saved);
    await f.adapter.submit({ ...request, parameters: { ...request.parameters, background: "opaque" } });
    expect(f.fetch).toHaveBeenCalledOnce();
    expect(String(f.fetch.mock.calls[0]![0])).toBe("https://synoralink.com/v1/legacy-image");
  });

  it.each([undefined, "opaque"])("does not normalize ordinary root requests without transparency: %s", async background => {
    const fetch = vi.fn<FetchImplementation>(async () => Response.json({ data: [{ url: "https://assets.example/result.png" }] }));
    const resolver = new StaticConnectionResolver([{ id: "one", provider: "openai", apiKey: "offline-only",
      baseUrl: "https://synoralink.com", settings: { modelGroup: group, accountKeyGroup: group } }]);
    const parameters: Record<string, unknown> = { size: "3840x2160", quality: "max", n: 1 };
    if (background !== undefined) parameters.background = background;
    await createDefaultProviderRegistry(resolver, { fetch }).get("openai").submit({ ...request, parameters });
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]![0])).toBe("https://synoralink.com/images/generations");
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).prompt).toBe(request.prompt);
  });

  it.each(VERIFIED_TRANSPARENT_IMAGES.flatMap(evidence => ["", "/", "/v1", "/v1/"].map(basePath => ({
    evidence, basePath, hostname: evidence.hostname, group: evidence.group, model: evidence.model,
  }))))("transmits the exact measured JSON contract on $hostname$basePath / $group / $model", async ({ evidence, basePath }) => {
    const measured = { provider: evidence.provider, config: { baseUrl: `https://${evidence.hostname}${basePath}`, modelGroup: evidence.group, accountKeyGroup: evidence.group } };
    expect(verifiedTransparentImageEvidence(measured, evidence.model)).toBe(evidence);
    expect(getImageEditingCapabilities(measured, evidence.model).transparent).toBe(true);
    expect(verifiedTransparentImageEvidence({ ...measured, config: { ...measured.config, modelGroup: "unverified", accountKeyGroup: "unverified" } }, evidence.model)).toBeUndefined();
    expect(verifiedTransparentImageEvidence(measured, `${evidence.model}-unverified`)).toBeUndefined();
    const fetch = vi.fn<FetchImplementation>(async (_, init) => Response.json(evidence.transport.kind === "pdog-async"
      ? init?.method === "POST" ? { task_id: "measured-pdog-task", status: "processing" }
        : { task_id: "measured-pdog-task", status: "completed", image_url: "https://assets.example/result.png" }
      : { data: [{ url: "https://assets.example/result.png" }] }));
    const supplierKey = ({ "api.frimodel.com": "frimodel", "api.mikoto.vip": "mikoto", "asian-acc.we-token.cc": "weai", "tu.988236.xyz": "chentu" } as Record<string, string>)[evidence.hostname];
    const connector: RestConnectorConfig = evidence.transport.kind === "saved-rest" ? {
      submit: { path: evidence.transport.path, method: "POST", bodyMode: "json", template: { model: evidence.model },
        mappings: [{ target: "/prompt", source: { kind: "request", path: "$.prompt" } },
          ...Object.keys(evidence.request).map(key => ({ target: `/${key}`, source: { kind: "request" as const, path: `$.parameters.${key}` } }))] },
      output: { path: "$.data", kind: "image", urlPath: "$.url" },
    } : saved.autoModelInterfaces[model].connector;
    const resolver = new StaticConnectionResolver([{ id: "one", provider: evidence.provider, apiKey: "offline-only", baseUrl: measured.config.baseUrl,
      settings: { ...measured.config, ...(supplierKey ? { supplierKey } : {}), pdogImageMode: "sync",
        autoModelInterfaces: { [evidence.model]: { model: { id: evidence.model, name: evidence.model, operations: ["image.generate"] },
          connector } } } }]);
    const adapter = createDefaultProviderRegistry(resolver, { fetch }).get(evidence.provider);
    const task = await adapter.submit({ ...request, model: evidence.model, parameters: evidence.request });
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]![0])).toBe(`https://${evidence.hostname}${evidence.transport.path}`);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ model: evidence.model, prompt: request.prompt, ...evidence.request });
    if (evidence.transport.kind === "pdog-async") {
      expect(task.status).toBe("running");
      const completed = await adapter.poll!(task);
      expect(completed.status).toBe("succeeded");
      expect(String(fetch.mock.calls[1]![0])).toBe("https://ai.whyshy.cn/v1/images/tasks/measured-pdog-task");
      expect((await adapter.extractOutputs(completed.result))[0]?.url).toBe("https://assets.example/result.png");
    }
  });

  it("preserves Genimage's existing normal-mode Images contract after adding live proof", async () => {
    const measuredModel = "gpt-image-2.5-flare";
    const fetch = vi.fn<FetchImplementation>(async () => Response.json({ data: [{ url: "https://assets.example/result.png" }] }));
    const resolver = new StaticConnectionResolver([{ id: "one", provider: "openai", apiKey: "offline-only", baseUrl: "https://genimage.pro/v1",
      settings: { modelGroup: "gptResponseBase64", accountKeyGroup: "gptResponseBase64", autoModelInterfaces: {
        [measuredModel]: { model: { id: measuredModel, name: measuredModel, operations: ["image.generate"] }, connector: saved.autoModelInterfaces[model].connector },
      } } }]);
    await createDefaultProviderRegistry(resolver, { fetch }).get("openai").submit({ ...request, model: measuredModel,
      parameters: { ...request.parameters, background: "opaque" } });
    expect(String(fetch.mock.calls[0]![0])).toBe("https://genimage.pro/v1/images/generations");
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).background).toBe("opaque");
  });

  it("keeps PDog normal-mode requests unchanged and rejects unmeasured sync transparency", async () => {
    const evidence = VERIFIED_TRANSPARENT_IMAGES.find(row => row.transport.kind === "pdog-async")!;
    const fetch = vi.fn<FetchImplementation>(async () => Response.json({ data: [{ url: "https://assets.example/result.png" }] }));
    const resolver = new StaticConnectionResolver([{ id: "one", provider: "openai", apiKey: "offline-only", baseUrl: "https://ai.whyshy.cn/v1",
      settings: { modelGroup: evidence.group, accountKeyGroup: evidence.group } }]);
    const adapter = new PdogImageAdapter(resolver, { fetch }, "sync");
    await expect(adapter.submit({ ...request, model: evidence.model, parameters: evidence.request })).rejects.toThrow(/异步/u);
    expect(fetch).not.toHaveBeenCalled();
    await adapter.submit({ ...request, model: evidence.model, parameters: { ...evidence.request, background: "opaque" } });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ model: evidence.model, prompt: request.prompt, size: "3840x2160", quality: "max", n: 1 });
    expect(String(fetch.mock.calls[0]![0])).toBe("https://ai.whyshy.cn/v1/images/generations");
  });

  it("retains current model permission, mask, and PNG validation before sending", async () => {
    for (const settings of [{ scannedModelIds: ["unrelated"] },
      { modelCatalogModels: [{ id: model, metadata: { canvasRunnable: false } }] },
      { modelCatalogModels: [{ id: model, metadata: { autoInterfaceStatus: "incomplete" } }] }]) {
      const f = fixture({ ...saved, ...settings });
      await expect(f.adapter.submit(request)).rejects.toThrow(/权限|接口/u);
      expect(f.fetch).not.toHaveBeenCalled();
    }
    const f = fixture();
    await expect(f.adapter.submit({ ...request, parameters: { ...request.parameters, output_format: "jpeg" } })).rejects.toThrow(/PNG/u);
    await expect(f.adapter.submit({ ...request, operation: "image.edit", assets: [
      { id: "original", kind: "image", role: "reference", mimeType: "image/png", data: new Uint8Array([1]) },
      { id: "mask", kind: "image", role: "mask", mimeType: "image/png", data: new Uint8Array([2]) },
    ] })).rejects.toThrow(/蒙版/u);
    expect(f.fetch).not.toHaveBeenCalled();
  });
});
