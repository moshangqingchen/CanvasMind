import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const offline = vi.hoisted(() => ({
  lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]),
  fetch: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({ lookup: offline.lookup }));
import type { FetchImplementation, ModelDescriptor, NormalizedRequest, ProviderAdapter, ProviderAssetInput, ProviderTask } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { OpenAIImageAdapter } from "./openai.js";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import { createDefaultProviderRegistry } from "./registry.js";

const baseUrl = "https://vapi.chuangxiangai.asia/v1";
const modeNames = ["direct-openai", "auto-openai", "registry-openai", "registry-rest"] as const;
type Mode = typeof modeNames[number];
const original: ProviderAssetInput = { id: "original", kind: "image", mimeType: "image/png", url: "https://assets.example/original.png" };
const mask: ProviderAssetInput = { id: "mask", kind: "image", role: "mask", mimeType: "image/png", url: "https://assets.example/mask.png" };
const input: NormalizedRequest = { connectionId: "cx", operation: "image.generate", model: "midjourney-2k", prompt: "A glass garden",
  idempotencyKey: "offline-midjourney-one", parameters: { size: "16:9" } };
const pending = (id: string): ModelDescriptor => ({ id, name: id, operations: [], outputKinds: ["image"],
  metadata: { canvasRunnable: false, autoInterfaceStatus: "incomplete", canvasUnavailableReason: "当前分组没有匹配的调用协议，请选择对应的图片或视频分组" } });

beforeEach(() => {
  offline.lookup.mockClear();
  offline.fetch.mockReset().mockRejectedValue(new Error("Unexpected real HTTP in integration regression"));
  vi.stubGlobal("fetch", offline.fetch);
});
afterEach(() => {
  try { expect(offline.fetch).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); }
});

function fixture(mode: Mode, settings: Record<string, unknown> = {}) {
  const provider = mode === "registry-rest" ? "rest" : "openai";
  const fetch = vi.fn<FetchImplementation>(async (url, init) => {
    if (init?.method === "GET" && String(url) === `${baseUrl}/models`)
      return Response.json({ data: [{ id: "midjourney-1k" }, { id: "midjourney-2k" }] });
    if (init?.method === "POST" && [`${baseUrl}/images/generations`, `${baseUrl}/images/edits`].includes(String(url)))
      return Response.json({ data: Array.from({ length: 4 }, (_, i) => ({ url: `https://assets.example/result-${i}.png` })) });
    throw new Error(`Unexpected fixture endpoint: ${String(url)}`);
  });
  const resolver = new StaticConnectionResolver([{ id: "cx", provider, baseUrl, apiKey: "synthetic-midjourney-key", settings: {
    baseUrl, usage: "canvas", modelGroup: "生图", accountKeyGroup: "生图", defaultModel: "midjourney-2k", modelScanStatus: "live",
    scannedModelIds: ["midjourney-1k", "midjourney-2k"], modelCatalogModels: [pending("midjourney-1k"), pending("midjourney-2k")],
    ...settings,
  } }]);
  const fallback = { testConnection: vi.fn(async () => undefined), listModels: vi.fn(async () => []),
    validate: vi.fn(async () => ({ valid: true, issues: [] })),
    submit: vi.fn(async (): Promise<ProviderTask> => { throw new Error("Unexpected fallback submission"); }),
    extractOutputs: vi.fn(async () => []) } satisfies ProviderAdapter;
  const adapter = mode === "direct-openai" ? new OpenAIImageAdapter(resolver, { fetch })
    : mode === "auto-openai" ? new AutoInterfaceAdapter(resolver, fallback, { fetch })
      : createDefaultProviderRegistry(resolver, { fetch }).get(provider);
  return { adapter, fetch, fallback };
}

describe("Midjourney native contracts through real provider bridges", () => {
  it.each(modeNames)("recovers a protocol-pending cached model and submits exactly one four-image task via %s", async mode => {
    const f = fixture(mode);
    expect(await f.adapter.validate(input)).toEqual({ valid: true, issues: [] });
    expect(f.fetch).not.toHaveBeenCalled();
    const task = await f.adapter.submit({ ...input, parameters: { ...input.parameters, quality: "max", image_size: "4K", resolution: "4K" } });
    expect(task.status).toBe("succeeded");
    expect(f.fetch).toHaveBeenCalledOnce();
    const [url, init] = f.fetch.mock.calls[0]!;
    expect(String(url)).toBe(`${baseUrl}/images/generations`);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer synthetic-midjourney-key");
    expect(JSON.parse(String(init?.body))).toEqual({ model: input.model, prompt: input.prompt, n: 1, speed: "relax", size: "16:9", response_format: "url" });
    const outputs = await f.adapter.extractOutputs(task.result);
    expect(outputs.map(output => output.url)).toEqual(Array.from({ length: 4 }, (_, i) => `https://assets.example/result-${i}.png`));
    expect(f.fallback.validate).not.toHaveBeenCalled();
    expect(f.fallback.submit).not.toHaveBeenCalled();
    expect(f.fallback.extractOutputs).not.toHaveBeenCalled();
  });
  it.each(modeNames)("keeps ordinary reference edits on generations and editor masks on edits via %s", async mode => {
    for (const reference of ["image", "style", "edit", "moodboard", "editor"]) {
      const f = fixture(mode);
      const request = { ...input, operation: "image.edit" as const, parameters: { reference }, assets: reference === "editor" ? [original, mask] : [original] };
      expect((await f.adapter.validate(request)).valid).toBe(true);
      const task = await f.adapter.submit(request);
      expect(f.fetch).toHaveBeenCalledOnce();
      const [url, init] = f.fetch.mock.calls[0]!;
      expect(String(url)).toBe(`${baseUrl}/images/${reference === "editor" ? "edits" : "generations"}`);
      expect(JSON.parse(String(init?.body))).toEqual({ model: input.model, prompt: input.prompt, n: 1, speed: "relax", reference,
        response_format: "url", images: [original.url], ...(reference === "editor" ? { mask: mask.url } : {}) });
      expect(await f.adapter.extractOutputs(task.result)).toHaveLength(4);
      expect(f.fallback.submit).not.toHaveBeenCalled();
    }
  });
  it.each(modeNames)("blocks Key inventory omissions, permission denials and declared text output without submitting via %s", async mode => {
    const explicitText: ModelDescriptor = { id: "midjourney-2k", name: "Text result", operations: [], outputKinds: ["text"],
      metadata: { outputKindsSource: "declared", catalogCapability: "chat" } };
    const forbidden: ModelDescriptor = { ...pending("midjourney-2k"), metadata: { canvasRunnable: false,
      autoInterfaceStatus: "incomplete", canvasUnavailableReason: "403 当前 Key 无此型号权限" } };
    for (const settings of [ { scannedModelIds: ["midjourney-1k"] }, { modelScanStatus: "empty" }, { modelScanStatus: "unauthorized" },
      { unavailableModels: ["midjourney-2k"] }, { modelCatalogModels: [explicitText] }, { modelCatalogModels: [forbidden] } ]) {
      const f = fixture(mode, settings);
      expect((await f.adapter.validate(input)).valid).toBe(false);
      await expect(f.adapter.submit(input)).rejects.toThrow();
      expect(f.fetch).not.toHaveBeenCalled();
      expect(f.fallback.submit).not.toHaveBeenCalled();
    }
  });
  it.each(["direct-openai", "registry-openai"] as const)("keeps both authenticated Midjourney IDs in the live catalog via %s", async mode => {
    const f = fixture(mode);
    const models = await f.adapter.listModels("cx");
    expect(models.filter(model => model.id.startsWith("midjourney-")).map(model => model.id).sort()).toEqual(["midjourney-1k", "midjourney-2k"]);
    for (const model of models.filter(model => model.id.startsWith("midjourney-"))) {
      expect(model).toMatchObject({ limits: { maxOutputImages: 4 }, metadata: { canvasRunnable: true, fixedOutputCount: 4, fixedRequestCount: 1 } });
      expect(model.parameters?.find(parameter => parameter.key === "n")).toMatchObject({ default: 1, min: 1, max: 1 });
    }
    expect(f.fetch).toHaveBeenCalledOnce();
    expect(f.fetch.mock.calls[0]?.[1]?.method).toBe("GET");
  });
});
