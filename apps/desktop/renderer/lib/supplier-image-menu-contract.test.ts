import { describe, expect, it } from "vitest";
import type { SupplierRecord } from "@super-canvas/db";
import { OpenAIImageAdapter, StaticConnectionResolver, type ModelDescriptor } from "@super-canvas/providers";
import { applyMonsterImageCapabilities } from "@super-canvas/providers/monster-image-capabilities";
import { effectiveImageCapabilities } from "./supplier-capabilities";
import { normalizedParametersForModel, parameterDescriptorsForValues, parametersWithDefaults } from "./model-parameters";
import { supplierImageMenuContract } from "./supplier-image-menu-contract";
import { cyberAfeiDocumentedModel } from "./cyberafei-catalog";

const sparse = (id: string): ModelDescriptor => ({ id, name: id, operations: ["image.generate", "image.edit"] });
function fixture(baseUrl: string, group: string, model: ModelDescriptor) {
  const connection = { id: "fixture", provider: "openai", config: { baseUrl, accountKeyGroup: group, usage: "canvas" } };
  const supplier = { id: "supplier", name: "supplier", supplierKey: "custom-fixture", kind: "newapi", scanStatus: "live", apiUrl: baseUrl, siteUrl: baseUrl, createdAt: "now", updatedAt: "now",
    catalog: { groups: [{ id: group, label: group, models: [], details: { source: "model-plaza", description: "支持 medium high xhigh max 质量" } }] } } as SupplierRecord;
  const enrich = (current = model) => effectiveImageCapabilities({ supplier, connection, model: current, fingerprint: "f" });
  const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: connection.id, provider: "openai", apiKey: "fixture",
    baseUrl, settings: connection.config }]));
  return { connection, enrich, adapter };
}

describe("supplier image menu contract survives capability enrichment", () => {
  it.each(["grok-imagine-image", "grok-imagine-image-2.0", "grok-imagine-image-quality"])("keeps Hang %s on measured defaults without invented K pixels or quality", id => {
    const model = supplierImageMenuContract({ provider: "openai", config: { baseUrl: "https://api.hangzhale.com", accountKeyGroupId: "74" } }, sparse(id));
    expect(parameterDescriptorsForValues("image-generation", "openai", model, {})).toEqual([]);
    expect(model.metadata?.imageOutputDimensions).toBeUndefined();
    expect(model.metadata?.imageParameterContractNote).toContain("计费标签");
    const saved = { size: "2048x2048", quality: "high", aspect_ratio: "1:1" };
    expect(normalizedParametersForModel("image-generation", "openai", model, saved)).toEqual(saved);
  });
  it.each(["grok-imagine-image", "grok-imagine-image-2.0", "grok-imagine-image-2.0福利"])("does not expose filtered GPT quality or guessed sizes for Chentu %s", async id => {
    const model = sparse(id);
    const { enrich, adapter, connection } = fixture("https://tu.988236.xyz/v1", "grok生图", model);
    const current = enrich().model;
    const controls = parameterDescriptorsForValues("image-generation", "openai", current, {}, "image.generate");
    expect(controls.map(control => control.key)).toEqual(["response_format"]);
    const parameters = parametersWithDefaults(controls, {});
    expect(parameters).toEqual({ response_format: "url" });
    expect(current.metadata?.imageParameterContract).toBe("keyed-size-schema-unavailable");
    expect(current.metadata?.imageSupportedResolutions).toEqual([]);
    expect((await adapter.validate({ idempotencyKey: "offline-grok", connectionId: "fixture", model: id, operation: "image.generate", prompt: "test", parameters })).valid).toBe(true);
    const saved = { size: "1792x1024", quality: "medium", aspect_ratio: "16:9" };
    expect(normalizedParametersForModel("image-generation", "openai", current, saved)).toMatchObject(saved);
    const keyed = { ...model, parameters: [{ key: "size", label: "尺寸", control: "select" as const, options: [{ value: "1792x1024", label: "16:9" }] }], metadata: { imageSizeCapabilitiesSource: "/v1/image/model-capabilities" } };
    expect(supplierImageMenuContract(connection, keyed)).toBe(keyed);
    expect(supplierImageMenuContract({ ...connection, config: { ...connection.config, accountKeyGroup: "another" } }, model)).toBe(model);
  });
  it.each(["gemini-3.1-flash-image-preview-2K", "gemini-3.1-flash-image-preview-4K", "grok-image-破甲", "grok-imagine-image", "grok-imagine-image-2.0", "grok-imagine-image-quality", "nano-banana-pro", "nano-banana2"])("does not manufacture controls for Afei's upstream-decided %s", id => {
    const documented = cyberAfeiDocumentedModel(id, { endpointTypes: id.startsWith("nano-banana") ? ["image-generation", "openai"] : ["openai"] })!;
    expect(documented.parameters).toEqual([]);
    expect(documented.metadata?.imageParameterContract).toBe("provider-decided");
    const { enrich } = fixture("https://api.3365api.cn", "图片视频模型综合分组", documented);
    const current = enrich().model;
    expect(parameterDescriptorsForValues("image-generation", "rest", current, {})).toEqual([]);
    expect(parametersWithDefaults(parameterDescriptorsForValues("image-generation", "rest", current, {}), {})).toEqual({});
    const saved = { size: "2048x2048", quality: "medium", aspect_ratio: "16:9" };
    expect(normalizedParametersForModel("image-generation", "rest", current, saved)).toEqual(saved);
    expect(current.metadata?.imageParameterContractNote).toContain("由上游决定");
  });
  it.each(["flare", "sunburst"])("keeps Fri base %s high and documented sizes after sparse scans and rereads", async variant => {
    const model = sparse(`gpt-image-2.5-${variant}`);
    for (const group of ["openai_official", "openai_official_外接", "openai_official_外接2"]) {
      const { enrich, adapter } = fixture("https://api.frimodel.com/v1", group, model);
      const current = enrich().model;
      const quality = current.parameters!.find(parameter => parameter.key === "quality")!;
      expect(quality.options?.map(option => option.value)).toEqual(["auto", "low", "medium", "high"]);
      expect(quality.default).toBe("high");
      expect(enrich(current).model.parameters).toEqual(current.parameters);
      expect(parametersWithDefaults(current.parameters!, { size: "2048x2048", quality: "medium" })).toMatchObject({ size: "2048x2048", quality: "medium" });
      for (const operation of model.operations) for (const value of quality.options!) {
        const parameters = parametersWithDefaults(current.parameters!, { quality: value.value });
        const result = await adapter.validate({ idempotencyKey: "offline-fixture", connectionId: "fixture", model: model.id, operation, prompt: "fixture", parameters,
          ...(operation === "image.edit" ? { assets: [{ id: "image", kind: "image", role: "reference", mimeType: "image/png", data: new Uint8Array([1]) }] } : {}) });
        expect(result.issues).toEqual([]);
      }
    }
  });

  it.each(["2k", "4k"])("keeps Chentu fixed %s native sizes without synthesizing auto or max from a group description", async tier => {
    const model = sparse(`gpt-image-2-${tier}`);
    const { enrich, adapter } = fixture("https://tu.988236.xyz/v1", "image2.5全参", model);
    const current = enrich().model;
    const size = current.parameters!.find(parameter => parameter.key === "size")!;
    expect(size.default).toBe(tier === "4k" ? "2880x2880" : "2048x2048");
    expect(size.options?.some(option => option.value === "auto")).toBe(false);
    expect(current.parameters!.find(parameter => parameter.key === "quality")?.default).toBe("high");
    expect(enrich(current).model.parameters).toEqual(current.parameters);
    expect(parametersWithDefaults(parameterDescriptorsForValues("image-generation", "openai", current, {}, "image.generate"), {}).size).toBe(size.default);
    for (const value of size.options!) {
      const result = await adapter.validate({ idempotencyKey: "offline-fixture", connectionId: "fixture", model: model.id, operation: "image.generate", prompt: "fixture",
        parameters: parametersWithDefaults(current.parameters!, { size: value.value }) });
      expect(result.issues).toEqual([]);
    }
  });

  it.each(["flare", "sunburst"])("keeps Monster B4 base %s high despite a group-wide max declaration", async variant => {
    const model = sparse(`gpt-image-2.5-${variant}`);
    const { connection, enrich, adapter } = fixture("https://api.eaheng.com", "B4-GPT生图原生渠道V3（高质量）", model);
    const current = enrich(applyMonsterImageCapabilities(connection, model)).model;
    expect(current.parameters!.find(parameter => parameter.key === "quality")).toMatchObject({ default: "high", options: [{ value: "high" }] });
    expect(enrich(current).qualityOptions).toEqual(["high"]);
    const result = await adapter.validate({ idempotencyKey: "offline-fixture", connectionId: "fixture", model: model.id, operation: "image.generate", prompt: "fixture",
      parameters: parametersWithDefaults(current.parameters!, {}) });
    expect(result.issues).toEqual([]);
  });

  it("does not transfer controls to other origins, full IDs, providers or remove permission rejection", () => {
    const model = { ...sparse("gpt-image-2.5-flare"), metadata: { canvasRunnable: false, canvasUnavailableReason: "403" } };
    for (const [provider, baseUrl, id] of [["openai", "https://other.example/v1", model.id], ["rest", "https://api.frimodel.com/v1", model.id],
      ["openai", "https://api.frimodel.com/v1", `${model.id}-adobe`], ["openai", "https://api.frimodel.com/other", model.id]]) {
      const original = { ...model, id };
      expect(supplierImageMenuContract({ provider, config: { baseUrl } }, original)).toBe(original);
    }
    expect(supplierImageMenuContract({ provider: "openai", config: { baseUrl: "https://api.frimodel.com/v1" } }, model).metadata).toMatchObject(model.metadata);
  });
});
