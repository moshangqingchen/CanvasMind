import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { PDOG_GEMINI_LEGACY_UNAVAILABLE } from "@super-canvas/providers/pdog-image-contract";
import { MIAOWU_VIDEO_CONTRACT_PENDING_REASON } from "@super-canvas/providers";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { cyberAfeiConnectorForModels } from "./cyberafei-catalog";
import { MIAOWU_CONNECTOR, MIAOWU_CHAT_VIDEO_OVERRIDE } from "./miaowu-presets";

const pending = (id: string, kind: "image" | "video", reason = "当前分组没有匹配的调用协议，请选择对应的图片或视频分组"): ModelDescriptor => ({
  id, name: `${id} · ￥0.5 / 请求`, operations: kind === "image" ? ["image.generate"] : ["video.generate", "video.image-to-video"],
  outputKinds: [kind], pricing: { kind: "per-request", currency: "CNY", unitAmount: 0.5, confidence: "exact", checkedAt: "2026-10-09T00:00:00.000Z" },
  metadata: { canvasRunnable: false, canvasUnavailableReason: reason, priceLabel: "￥0.5 / 请求" },
});

describe("current directory contract migration", () => {
  it.each(["gemini-3.6-flash-image", "gemini-nano-banana-2.1"])("repairs the saved PDog example whitelist for %s", id => {
    const model = pending(id, "image", PDOG_GEMINI_LEGACY_UNAVAILABLE);
    const result = bindScannedModelProtocols({ provider: "openai", config: { baseUrl: "https://ai.whyshy.cn",
      modelGroup: "香蕉", usage: "canvas", scannedModelIds: [id], modelScanStatus: "live" } }, [model]).models[0]!;
    expect(result.id).toBe(id);
    expect(result.metadata?.canvasRunnable).toBe(true);
    expect(result.parameters?.find(parameter => parameter.key === "image_size")?.default).toBe("auto");
    expect(result.pricing).toEqual(model.pricing);
    expect(model.metadata?.canvasRunnable).toBe(false);
  });
  it.each(["gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"])("repairs Chentu's missing native contract for %s", id => {
    const result = bindScannedModelProtocols({ provider: "openai", config: { baseUrl: "https://tu.988236.xyz",
      preset: "chentu-openai-images", modelGroup: "低价gemni生图", usage: "canvas", scannedModelIds: [id], modelScanStatus: "live" } },
      [pending(id, "image", "尚无已验证的画布生成协议")]).models[0]!;
    expect(result.metadata).toMatchObject({ canvasRunnable: true, protocol: "gemini-generate-content" });
    expect(result.operations).toContain("image.edit");
  });
  it.each(["midjourney-1k", "midjourney-2k"])("restores the exact Midjourney SKU %s and its four outputs", id => {
    const result = bindScannedModelProtocols({ provider: "openai", config: { baseUrl: "https://vapi.chuangxiangai.asia",
      modelGroup: "生图", usage: "canvas", scannedModelIds: [id] } }, [pending(id, "image")]).models[0]!;
    expect(result.metadata).toMatchObject({ canvasRunnable: true, fixedOutputCount: 4, fixedRequestCount: 1 });
    expect(result.parameters?.find(parameter => parameter.key === "n")).toMatchObject({ default: 1, max: 1 });
  });
  it.each(["dreamina-seedance-2.0-fast", "dreamina-seedance-2.0-mini", "seedance-2.0-fast-deal", "seedance-2.5-deal"])(
    "removes the old automatic pending guard for Miaowu %s", id => {
      const cached = pending(id, "video", MIAOWU_VIDEO_CONTRACT_PENDING_REASON);
      const model = { ...cached, metadata: { ...cached.metadata, miaowuVideoContractPending: true,
        parameterSource: "key-model-scan", parameterControlsUnavailable: true } };
      const connector = { ...structuredClone(MIAOWU_CONNECTOR), models: [model],
        modelOverrides: { [id]: structuredClone(MIAOWU_CHAT_VIDEO_OVERRIDE) } };
      const result = bindScannedModelProtocols({ provider: "rest", config: { baseUrl: "https://api.miaowuai.store",
        preset: "miaowu-openai-videos", modelGroup: "default", usage: "canvas", scannedModelIds: [id], modelScanStatus: "live", connector } }, [model]).models[0]!;
      expect(result.metadata).toMatchObject({ canvasRunnable: true, parameterSource: "supplier-documented-contract" });
      expect(result.metadata?.canvasUnavailableReason).toBeUndefined();
      expect(result.parameters?.some(parameter => parameter.key === "duration")).not.toBe(true);
      expect(result.metadata?.protocol).toBe("openai-chat");
    });
  it.each(["nano-banana-pro", "nano-banana2", "gemini-3.1-flash-image", "gemini-3.1-flash-image-preview-2K", "gemini-3.1-flash-image-preview-4K", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])(
    "binds a concrete Cyber Afei transport and price for %s", id => {
      const model = pending(id, "image");
      const result = bindScannedModelProtocols({ provider: "rest", config: { baseUrl: "https://api.3365api.cn",
        preset: "cyberafei-api", modelGroup: "图片视频模型综合分组", scannedModelIds: [id], modelScanStatus: "live",
        connector: cyberAfeiConnectorForModels([]) } }, [model]);
      expect(result.models[0]!.metadata?.canvasRunnable).toBe(true);
      expect(result.models[0]!.pricing).toEqual(model.pricing);
      expect(result.connector?.modelOverrides?.[id]?.submit?.path).toMatch(/^\/v1(?:beta\/models\/.*:generateContent|\/images\/generations|\/chat\/completions)$/u);
      expect(result.models[0]!.id).toBe(id);
    });
  it("preserves explicit permission failures while restoring protocol caches", () => {
    const id = "midjourney-1k", model = pending(id, "image", "当前 Key 未开通（403）");
    const result = bindScannedModelProtocols({ provider: "openai", config: { baseUrl: "https://vapi.chuangxiangai.asia", modelGroup: "生图", scannedModelIds: [id] } }, [model]).models[0]!;
    expect(result.metadata).toMatchObject(model.metadata!);
  });
  it("restores Omni's video directory entry when old agent discovery stamped it as Chat text", () => {
    const model: ModelDescriptor = { ...pending("omni-flash", "video", "尚无已验证的画布生成协议"), outputKinds: ["text"],
      metadata: { canvasRunnable: false, canvasUnavailableReason: "尚无已验证的画布生成协议", catalogCapability: "video",
        modelFactsSource: "model-api", outputKindsSource: "declared", endpointTypes: ["openai", "openai-video"] } };
    const connection = { provider: "rest", config: { baseUrl: "https://api.3365api.cn", preset: "cyberafei-api",
      usage: "canvas", modelGroup: "图片视频模型综合分组", modelScanStatus: "live", scannedModelIds: [model.id], connector: cyberAfeiConnectorForModels([]) } };
    const result = bindScannedModelProtocols(connection, [model]);
    expect(result.models[0]?.metadata?.canvasRunnable).toBe(true);
    expect(result.models[0]?.outputKinds).toContain("video");
    expect(result.connector?.modelOverrides?.[model.id]?.submit?.path).toBe("/v1/videos");
    expect(model.outputKinds).toEqual(["text"]);
    for (const input of [
      { ...model, id: "another-model" },
      { ...model, metadata: { ...model.metadata, canvasUnavailableReason: "403 权限拒绝" } },
      { ...model, metadata: { ...model.metadata, catalogCapability: "chat" } },
      { ...model, metadata: { ...model.metadata, endpointTypes: ["openai"] } },
    ]) expect(bindScannedModelProtocols(connection, [input]).models[0]?.outputKinds).toEqual(["text"]);
  });
});
