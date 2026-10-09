import { describe, expect, it, vi } from "vitest";
import type { ModelDescriptor, NormalizedRequest } from "./contracts.js";
import { applySupplierImageConstraints, isMikotoDocumentedImageSize, supplierImageParameterIssues } from "./supplier-image-constraints.js";
import { StaticConnectionResolver } from "./credentials.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { OpenAIImageAdapter, WeAIImageAdapter } from "./openai.js";

const model: ModelDescriptor = { id: "gpt-image-2.5-flare", name: "Image", operations: ["image.generate"],
  parameters: [ { key: "size", label: "尺寸", control: "dimensions", default: "3840x2160" },
    { key: "quality", label: "质量", control: "select", default: "high" },
    { key: "aspect_ratio", label: "比例", control: "select" } ], metadata: { canvasRunnable: false } };
const connection = (baseUrl = "https://token.secure-skill.com/v1", modelGroup = "gpt-image-2.5") =>
  ({ provider: "openai", config: { baseUrl, modelGroup } });
const request: NormalizedRequest & { model: string } = { connectionId: "test", model: model.id,
  operation: "image.generate", prompt: "image", idempotencyKey: "test", parameters: { size: "3840x2160" } };

describe("supplier image parameter boundaries", () => {
  it("gives cached Image 2.5 group 44 the three documented dimensions without overriding Key denial", () => {
    const result = applySupplierImageConstraints(connection(), model);
    expect(result.parameters?.find(p => p.key === "size")).toMatchObject({ control: "select", default: "1024x1024" });
    expect(result.parameters?.find(p => p.key === "size")?.options?.map(o => o.value)).toEqual(["1024x1024", "1536x1024", "1024x1536"]);
    expect(result.parameters?.find(p => p.key === "aspect_ratio")).toBeUndefined();
    expect(result.metadata?.canvasRunnable).toBe(false);
    expect(supplierImageParameterIssues(connection(), request)).toHaveLength(1);
  });
  it("keeps the independently documented 124K group, foreign hosts, and other model IDs unchanged", () => {
    for (const source of [connection(undefined, "image2.5特价"), connection("https://other.example/v1"),
      connection("https://token.secure-skill.com.evil.test/v1")]) {
      expect(applySupplierImageConstraints(source, model)).toBe(model);
      expect(supplierImageParameterIssues(source, request)).toEqual([]);
    }
    expect(applySupplierImageConstraints(connection(), { ...model, id: "gpt-image-2.5-other" }).parameters).toBe(model.parameters);
  });
  it("removes GPT Image 2 quality control only at secure-skill", () => {
    expect(applySupplierImageConstraints(connection(), { ...model, id: "gpt-image-2" }).parameters?.some(p => p.key === "quality")).toBe(false);
    expect(applySupplierImageConstraints(connection("https://other.example/v1"), { ...model, id: "gpt-image-2" }).parameters?.some(p => p.key === "quality")).toBe(true);
  });
  it.each(["codex_image", "gpt_image_web"])("limits FriModel %s to its documented 1K presets", group => {
    const source = connection("https://platform.frimodel.com/v1", group);
    const result = applySupplierImageConstraints(source, { ...model, id: "gpt-image-2-w" });
    expect(result.parameters?.find(p => p.key === "size")?.options?.every(o => o.value === "auto" || o.label.startsWith("1K"))).toBe(true);
    expect(supplierImageParameterIssues(source, { ...request, model: "gpt-image-2-w" })).toHaveLength(1);
    expect(supplierImageParameterIssues(source, { ...request, model: "gpt-image-2-w", parameters: { size: "1920x1088" } })).toEqual([]);
  });
  it.each(["3840x1646", "2560x1097"])("accepts Mikoto's published %s preset without loosening another supplier", async size => {
    expect(isMikotoDocumentedImageSize(connection("https://api.mikoto.vip/v1"), "gpt-image-2", size)).toBe(true);
    expect(isMikotoDocumentedImageSize(connection("https://other.example/v1"), "gpt-image-2", size)).toBe(false);
    for (const baseUrl of ["https://api.mikoto.vip/v1", "https://other.example/v1"]) {
      const fetcher = vi.fn<typeof fetch>();
      const adapter = createDefaultProviderRegistry(new StaticConnectionResolver([{ id: "test", provider: "openai", baseUrl, apiKey: "test" }]), { fetch: fetcher }).get("openai");
      expect((await adapter.validate({ ...request, model: "gpt-image-2", parameters: { size } })).valid).toBe(baseUrl.includes("mikoto"));
      expect(fetcher).not.toHaveBeenCalled();
    }
  });
  it("includes the exact Nano 2.1 directory ID despite not containing image in its name", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ id: "gemini-nano-banana-2.1" }, { id: "random-text-model" }] }));
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "test", provider: "openai", apiKey: "test",
      baseUrl: "https://asian-acc.we-token.cc/v1", settings: { modelGroup: "aistudio香蕉", defaultModel: "gemini-nano-banana-2.1" } }]), { fetch: fetcher });
    const models = await adapter.listModels("test");
    expect(models.map(m => m.id)).toEqual(["gemini-nano-banana-2.1"]);
    expect(models[0]?.parameters?.find(p => p.key === "thinking_level")?.default).toBe("medium");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]?.method).not.toBe("POST");
  });
  it("repairs the exact obsolete Adobe alias blocker in cached runtime selection while retaining Key denial", async () => {
    const id = "gemini-3.0-pro-image-preview";
    const obsolete = "此模型虽在分组列表中，但供应商香蕉接口仅声明支持 gemini-3-pro-image 和 gemini-3.1-flash-image；请选已支持的型号";
    for (const reason of [obsolete, "上游 403 当前 Key 未开通"]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }] } }] }));
      const adapter = createDefaultProviderRegistry(new StaticConnectionResolver([{ id: "test", provider: "openai", apiKey: "test",
        baseUrl: "https://asian-acc.we-token.cc/v1", settings: { modelGroup: "adobe香蕉", scannedModelIds: [id],
          modelCatalogModels: [{ id, name: id, operations: ["image.generate"], metadata: { canvasRunnable: false, canvasUnavailableReason: reason } }] } }]), { fetch: fetcher }).get("openai");
      const selected = { ...request, model: id, parameters: {} };
      if (reason === obsolete) {
        await adapter.submit(selected);
        expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://asian-acc.we-token.cc/v1beta/models/gemini-3-pro-image:generateContent");
      } else {
        await expect(adapter.submit(selected)).rejects.toThrow("可用权限");
        expect(fetcher).not.toHaveBeenCalled();
      }
    }
  });
  it("keeps remembered We-AI rejection across the native adapter, wrapper and model list", async () => {
    const id = "gemini-3.0-pro-image-preview";
    for (const rejected of [id, { id: "gemini-3-pro-image" }]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ id }] }));
      const resolver = new StaticConnectionResolver([{ id: "test", provider: "weai", apiKey: "test",
        baseUrl: "https://asian-acc.we-token.cc/v1", settings: { defaultModel: id, modelGroup: "adobe香蕉",
          scannedModelIds: [id], unavailableModels: [rejected] } }]);
      const direct = new WeAIImageAdapter(resolver, { fetch: fetcher });
      const wrapped = createDefaultProviderRegistry(resolver, { fetch: fetcher }).get("weai");
      for (const adapter of [direct, wrapped]) {
        expect((await adapter.validate({ ...request, model: id, parameters: {} })).valid).toBe(false);
        await expect(adapter.submit({ ...request, model: id, parameters: {} })).rejects.toThrow("已记录此型号不可用");
      }
      expect(fetcher).not.toHaveBeenCalled();
      expect(await direct.listModels("test")).toEqual([]);
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
});
