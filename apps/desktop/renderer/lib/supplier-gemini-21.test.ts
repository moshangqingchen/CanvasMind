import { describe, expect, it, vi } from "vitest";
import { createDefaultProviderRegistry, GenericRestAdapter, StaticConnectionResolver, type ModelDescriptor } from "@super-canvas/providers";
import { GEMINI_NANO_BANANA_21_MODEL } from "@super-canvas/providers/banana-image-contract";
import { chentuCatalogFromPricing, resolveChentuScannedGroup } from "./chentu-catalog";
import { chentuNativeGeminiConnector, chentuNativeGeminiDescriptor, isChentuNativeGeminiModel } from "./chentu-gemini";
import { friModelFallbackImageDescriptor } from "./frimodel-presets";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { discoverSupplierModelInterfaces } from "./supplier-interface-discovery";

const modelId = GEMINI_NANO_BANANA_21_MODEL;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aKcAAAAASUVORK5CYII=";

describe("supplier Gemini Nano Banana 2.1 onboarding", () => {
  it("keeps the current Chentu catalog and group-key ID callable through native Gemini", () => {
    const catalog = chentuCatalogFromPricing({ group_ratio: { 稳定gemini生图: 1, 低价gemni生图: 0.7143 }, data: [{
      model_name: modelId, quota_type: 1, model_price: 0.07, enable_groups: ["稳定gemini生图", "低价gemni生图"], supported_endpoint_types: ["gemini", "openai"],
    }] });
    for (const group of ["稳定gemini生图", "低价gemni生图"]) {
      const resolved = resolveChentuScannedGroup(catalog, group, [modelId]);
      expect(resolved.canvasModels).toHaveLength(1);
      const model = resolved.canvasModels[0]!;
      expect(model.id).toBe(modelId);
      expect(model.metadata).toMatchObject({ canvasRunnable: true, protocol: "gemini-generate-content", bananaInputLimitSource: "adapter" });
      expect(model.parameters?.map(p => p.key)).toEqual(["aspect_ratio", "image_size", "n"]);
      expect(model.parameters?.find(p => p.key === "image_size")?.default).toBe("auto");
      expect(resolveChentuScannedGroup(catalog, group, []).canvasModels).toEqual([]);
    }
    expect(isChentuNativeGeminiModel(modelId)).toBe(true);
  });

  it("maps the new Chentu REST preset to exact generateContent, inline references and all candidates", async () => {
    const descriptor = chentuNativeGeminiDescriptor(modelId);
    const fetch = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ text: "done" }] } }, { content: { parts: [{ inlineData: { mimeType: "image/png", data: png } }] } }] }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "ct-native", provider: "rest", baseUrl: "https://tu.988236.xyz/v1", apiKey: "fixture-key" }]),
      { config: chentuNativeGeminiConnector([descriptor]), fetch });
    const task = await adapter.submit({ connectionId: "ct-native", model: modelId, operation: "image.edit", prompt: "blue vase", idempotencyKey: "one-native-edit",
      parameters: { image_size: "auto", aspect_ratio: "16:9", n: 1 }, assets: [{ id: "ref", kind: "image", mimeType: "image/png", data: new Uint8Array([1, 2, 3]) }] });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://tu.988236.xyz/v1beta/models/${modelId}:generateContent`);
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe("fixture-key");
    expect(JSON.parse(String(init.body))).toEqual({ contents: [{ role: "user", parts: [{ text: "blue vase" }, { inlineData: { mimeType: "image/png", data: "AQID" } }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "16:9" } } });
    expect(await adapter.extractOutputs(task.result)).toEqual([{ kind: "image", mimeType: "image/png", data: new Uint8Array(Buffer.from(png, "base64")) }]);
  });

  it.each([
    ["chentu", "https://tu.988236.xyz/v1", "稳定gemini生图", "openai"],
    ["frimodel", "https://api.frimodel.com/v1", "gemini_pro", "openai"],
    ["chentu", "https://tu.988236.xyz/v1", "稳定gemini生图", "rest"],
  ])("keeps %s native protocol after binding, fresh document discovery and an obsolete Images binding (%s, %s, %s)", async (supplierKey, baseUrl, modelGroup, provider) => {
    const stale: ModelDescriptor = { id: modelId, name: modelId, operations: ["image.generate"],
      metadata: { canvasRunnable: true, endpointTypes: ["/v1beta/models/{model}:generateContent", "/v1/chat/completions"] },
      parameters: [{ key: "size", label: "旧尺寸", control: "text" }] };
    const obsoleteBinding = { version: 1, model: stale, sourceUrl: "https://supplier.example/old", connector: {
      auth: { type: "bearer" }, models: [stale], submit: { path: "/v1/images/generations", method: "POST", bodyMode: "json" }, output: { path: "$.data", kind: "image" },
    } };
    const connection = { provider: provider!, config: { baseUrl, supplierKey, modelGroup, usage: "canvas", scannedModelIds: [modelId], autoModelInterfaces: { [modelId]: obsoleteBinding }, connector: chentuNativeGeminiConnector([chentuNativeGeminiDescriptor(modelId)]) } };
    const bound = bindScannedModelProtocols(connection, [stale]);
    expect(bound.models[0]?.metadata?.protocol).toBe("gemini-generate-content");
    const read = vi.fn(async () => []);
    const discovered = await discoverSupplierModelInterfaces(connection, bound.models, connection, read);
    const final = discovered.models[0]!;
    expect(final.metadata).toMatchObject({ canvasRunnable: true, protocol: "gemini-generate-content" });
    expect(final.parameters?.map(p => p.key)).toEqual(["aspect_ratio", "image_size", "n"]);
    expect(discovered.bindings[modelId]).toBeUndefined();
    const fetch = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png } }] } }] }));
    const adapter = createDefaultProviderRegistry(new StaticConnectionResolver([{ id: "native", provider: provider!, baseUrl, apiKey: "fixture-key",
      settings: { ...connection.config, autoModelInterfaces: discovered.bindings, modelCatalogModels: discovered.models } }]), { fetch }).get(provider!);
    const task = await adapter.submit({ connectionId: "native", model: modelId, operation: "image.generate", prompt: "blue vase", idempotencyKey: "fresh-native", parameters: { image_size: "auto" } });
    expect(fetch).toHaveBeenCalledOnce();
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(`${new URL(baseUrl).origin}/v1beta/models/${modelId}:generateContent`);
    expect(await adapter.extractOutputs(task.result)).toHaveLength(1);
  });

  it.each([["chentu", "https://tu.988236.xyz/v1"], ["frimodel", "https://api.frimodel.com/v1"]])("repairs %s protocol-only stale errors without reopening denied key models", async (supplierKey, baseUrl) => {
    const connection = { provider: "openai", config: { baseUrl, supplierKey, usage: "canvas", scannedModelIds: [modelId] } };
    const stale: ModelDescriptor = { id: modelId, name: modelId, operations: ["image.generate"], metadata: { canvasRunnable: false, autoInterfaceStatus: "incomplete", canvasUnavailableReason: "画布协议尚未内置" } };
    const bound = bindScannedModelProtocols(connection, [stale]);
    expect(bound.models[0]?.metadata).toMatchObject({ canvasRunnable: true, protocol: "gemini-generate-content" });
    expect(bound.models[0]?.parameters?.map(p => p.key)).toEqual(["aspect_ratio", "image_size", "n"]);
    const repaired = await discoverSupplierModelInterfaces(connection, [stale], connection, async () => []);
    expect(repaired.models[0]?.metadata).toMatchObject({ canvasRunnable: true, protocol: "gemini-generate-content" });
    const denied = { ...stale, metadata: { canvasRunnable: false, canvasUnavailableReason: "当前 Key 未返回该模型" } };
    expect((await discoverSupplierModelInterfaces(connection, [denied], connection, async () => [])).models[0]?.metadata?.canvasRunnable).toBe(false);
  });

  it("gives a FriModel pending scan the exact native alias without granting stale permissions", () => {
    const model = friModelFallbackImageDescriptor(modelId, "gemini_pro")!;
    expect(model.id).toBe(modelId);
    expect(model.metadata).toMatchObject({ protocol: "gemini-generate-content", pendingLiveScan: true, supportsImageEdit: true });
    expect(model.parameters?.find(p => p.key === "image_size")?.default).toBe("auto");
  });
});
