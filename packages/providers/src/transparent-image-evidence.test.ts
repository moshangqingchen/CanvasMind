import { describe, expect, it, vi } from "vitest";
import type { FetchImplementation, NormalizedRequest } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { getImageEditingCapabilities } from "./image-editing-capabilities.js";
import { VERIFIED_TRANSPARENT_IMAGES, verifiedTransparentImageEvidence } from "./transparent-image-evidence.js";
import { PdogImageAdapter } from "./pdog-image.js";

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

describe("measured transparent image routes", () => {
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
    const resolver = new StaticConnectionResolver([{ id: "one", provider: evidence.provider, apiKey: "offline-only", baseUrl: measured.config.baseUrl,
      settings: { ...measured.config, ...(supplierKey ? { supplierKey } : {}), pdogImageMode: "sync",
        autoModelInterfaces: { [evidence.model]: { model: { id: evidence.model, name: evidence.model, operations: ["image.generate"] },
          connector: saved.autoModelInterfaces[model].connector } } } }]);
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
