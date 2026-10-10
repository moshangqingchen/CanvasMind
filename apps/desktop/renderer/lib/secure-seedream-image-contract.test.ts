import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupplierRecord } from "@super-canvas/db";
import { OpenAIImageAdapter, StaticConnectionResolver, type ModelDescriptor } from "@super-canvas/providers";
import { secureSeedreamImageContract } from "./secure-seedream-image-contract";
import { effectiveImageCapabilities } from "./supplier-capabilities";
import { normalizedParametersForModel, parameterDescriptorsForValues, parametersWithDefaults, parameterValueForModel, setParameterValue } from "./model-parameters";
import { NodeParameterFields } from "../components/node-parameter-fields";

const connection = { id: "secure-seedream", provider: "openai", config: { baseUrl: "https://token.secure-skill.com/v1", accountKeyGroupId: "35", modelGroup: "seedream-5.0-pro", usage: "canvas" } };
const sparse: ModelDescriptor = { id: "seedream-5.0-pro", name: "Seedream", operations: ["image.generate"] };
const supplier = { id: "secure", siteUrl: "https://token.secure-skill.com", apiUrl: connection.config.baseUrl, updatedAt: "now", catalog: { groups: [] } } as unknown as SupplierRecord;
const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: connection.id, provider: "openai", apiKey: "test", baseUrl: connection.config.baseUrl, settings: connection.config }]));

describe("Secure Seedream exact image controls", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());
  it("keeps all 22 official sizes through enrichment and validates their real request defaults", async () => {
    const model = effectiveImageCapabilities({ supplier, connection, model: sparse, fingerprint: "f" }).model;
    const size = model.parameters!.find(p => p.key === "size")!;
    expect(size.options).toHaveLength(22);
    expect(effectiveImageCapabilities({ supplier, connection, model, fingerprint: "f" }).sizeIsTier).toBe(false);
    expect(size).toMatchObject({ default: "2048x2048", min: 768, max: 2048, step: 1 });
    expect(size.options).toContainEqual({ value: "1536x1920", label: "2K · 4:5 · 1536 × 1920" });
    expect(size.options).toContainEqual({ value: "864x2016", label: "2K · 9:21 · 864 × 2016" });
    expect(model.parameters!.map(p => p.key)).toEqual(["size", "width", "height", "n", "strength"]);
    expect(effectiveImageCapabilities({ supplier, connection, model, fingerprint: "f" }).model.parameters).toEqual(model.parameters);
    for (const option of size.options!) {
      const parameters = parametersWithDefaults(parameterDescriptorsForValues("image-generation", "openai", model, { size: option.value }, "image.generate"), { size: option.value });
      expect(parameters).toEqual({ size: option.value, n: 1 });
      const result = await adapter.validate({ connectionId: connection.id, idempotencyKey: "offline", operation: "image.generate", model: model.id, prompt: "test image", parameters });
      expect(result.issues).toEqual([]);
    }
  });
  it("retains old selections for an explicit rejection and never restores generic quality or 4K", async () => {
    const model = secureSeedreamImageContract(connection, { ...sparse, parameters: [{ key: "quality", label: "质量", control: "select", default: "max" }] });
    const parameters = normalizedParametersForModel("image-generation", "openai", model, { size: "4096x4096", quality: "max" });
    expect(parameters).toMatchObject({ size: "4096x4096", quality: "max" });
    const result = await adapter.validate({ connectionId: connection.id, idempotencyKey: "offline", operation: "image.generate", model: model.id, prompt: "test image", parameters });
    expect(result.issues.some(issue => issue.path === "parameters.size")).toBe(true);
    expect(result.issues.some(issue => issue.path === "parameters.quality")).toBe(true);
  });
  it("keeps permission failures and does not apply the contract across origins or aliases", () => {
    const blocked = { ...sparse, metadata: { canvasRunnable: false, canvasUnavailableReason: "401", parameterControlsUnavailable: true } };
    expect(secureSeedreamImageContract(connection, blocked).metadata).toMatchObject(blocked.metadata);
    for (const [provider, baseUrl, id] of [["rest", connection.config.baseUrl, sparse.id], ["openai", "https://other.example", sparse.id],
      ["openai", "https://token.secure-skill.com/other", sparse.id], ["openai", connection.config.baseUrl, "seedream-5.0-pro-x"]]) {
      const model = { ...sparse, id };
      expect(secureSeedreamImageContract({ provider, config: { baseUrl } }, model)).toBe(model);
    }
  });
  it("shows one W/H pair using actual supplier precedence, without mutating saved fields", () => {
    const model = secureSeedreamImageContract(connection, sparse);
    const parameters = { size: "1024x1024", aspect_ratio: "16:9", width: 1111, height: 777 };
    const original = JSON.stringify(parameters);
    const html = renderToStaticMarkup(React.createElement(NodeParameterFields, { nodeId: "seedream", nodeType: "image-generation", provider: "openai", model,
      parameters, onChange: () => {}, showAdvanced: false, operation: "image.generate" }));
    expect(html.match(/aria-label="图片宽度"/gu)).toHaveLength(1);
    expect(html.match(/aria-label="图片高度"/gu)).toHaveLength(1);
    expect(html).not.toContain("指定 W"); expect(html).not.toContain("指定 H");
    expect(html).toContain('value="1111"'); expect(html).toContain('value="777"');
    expect(html).not.toContain("16 倍数对齐");
    expect(parameterValueForModel(model, parameters, "size")).toBe("1111x777");
    expect(parameterValueForModel(model, { size: "1024x1024", aspect_ratio: "16:9" }, "size")).toBe("1920x1080");
    expect(parameterValueForModel(model, { size: "1024x1024", width: 1111 }, "size")).toBe("1111x");
    expect(JSON.stringify(parameters)).toBe(original);
  });
  it("a new size takes effect in validation and request data instead of being overridden by old W/H or ratio", async () => {
    const model = secureSeedreamImageContract(connection, sparse);
    const old = { size: "1024x1024", aspect_ratio: "16:9", width: 1111, height: 777, n: 1 };
    for (const size of ["2048x2048", "1536x1920", "1113x779"]) {
      const changed = setParameterValue(old, "size", size, model);
      expect(changed).toEqual({ size, n: 1 });
      expect(normalizedParametersForModel("image-generation", "openai", model, changed)).toEqual(changed);
      expect((await adapter.validate({ connectionId: connection.id, idempotencyKey: "offline", operation: "image.generate", model: model.id, prompt: "test image", parameters: changed })).issues).toEqual([]);
    }
    expect(setParameterValue(old, "size", "2048x2048", sparse)).toEqual({ ...old, size: "2048x2048" });
  });
});
