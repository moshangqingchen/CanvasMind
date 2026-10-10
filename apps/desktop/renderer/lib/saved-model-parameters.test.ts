import { describe, expect, it } from "vitest";
import { applyJijiuImageCapabilities } from "@super-canvas/providers/jijiu-image-contract";
import { rememberModelParameters, savedModelParameters, transferableJijiuModelParameters } from "./saved-model-parameters";

describe("saved model parameters", () => {
  const highTier = "gpt-image-2-2K/4K";
  const original = { connectionId: "jijiu-high-tier", model: highTier, provider: "openai",
    parameters: { size: "4K", quality: "high", n: 1 }, qualityMode: "custom" as const };
  const source = { id: original.connectionId, provider: "openai", config: { baseUrl: "https://newapi.jijiucanvas.com/v1", modelGroup: "default" } };
  const target = { id: "new-jijiu-group", provider: "openai", config: { baseUrl: "https://newapi.jijiucanvas.com", modelGroup: "图片-GPT-image-2-2K/4K" } };
  const model = applyJijiuImageCapabilities(target, { id: highTier, name: highTier, operations: ["image.generate"] });

  it.each(["2K", "4K"])("carries legal %s/high into a first-visited group of the same supplier", size => {
    const selected = { ...original, parameters: { size, quality: "high", n: 1 } };
    const transferred = transferableJijiuModelParameters(selected, source, target, model);
    expect(transferred).toEqual({ ...selected, connectionId: target.id });
    const defaultTarget = { ...source, config: { ...source.config, defaultModel: "gpt-image-2" } };
    expect(transferableJijiuModelParameters({ ...selected, connectionId: target.id }, target, defaultTarget, model))
      .toEqual({ ...selected, connectionId: source.id });
  });

  it("never copies parameters across suppliers, different models, denied groups, or incompatible target controls", () => {
    expect(transferableJijiuModelParameters(original, { ...source, config: { ...source.config, baseUrl: "https://other.example/v1" } }, target, model)).toBeUndefined();
    expect(transferableJijiuModelParameters(original, source, { ...target, config: { ...target.config, baseUrl: "https://other.example/v1" } }, model)).toBeUndefined();
    expect(transferableJijiuModelParameters(original, source, target, { ...model, id: "gpt-image-2" })).toBeUndefined();
    expect(transferableJijiuModelParameters(original, source, { ...target, config: { ...target.config, modelGroup: "图片-GPT-image-2/2.5-1K" } }, model)).toBeUndefined();
    expect(transferableJijiuModelParameters(original, source, target, { ...model, parameters: [] })).toBeUndefined();
    expect(transferableJijiuModelParameters({ ...original, parameters: { size: "8K", quality: "max" } }, source, target, model)).toBeUndefined();
    expect(transferableJijiuModelParameters({ ...original, parameters: { size: "4K", resolution: "2K", quality: "high" } }, source, target, model)).toBeUndefined();
    expect(transferableJijiuModelParameters(original, source, target, { ...model, metadata: { ...model.metadata, canvasRunnable: false } })).toBeUndefined();
  });

  it("restores native 4K/high after a different model and a JSON save/restart", () => {
    const before = structuredClone(original);
    const first = rememberModelParameters(original);
    const second = rememberModelParameters({ ...original, model: "gpt-image-2", parameters: { size: "auto", n: 1 }, modelParameterSelections: first });
    const restored = JSON.parse(JSON.stringify(second));
    expect(savedModelParameters(restored, original.connectionId, highTier)).toEqual(original);
    expect(savedModelParameters(restored, original.connectionId)?.model).toBe("gpt-image-2");
    expect(original).toEqual(before);
  });

  it("keeps each group's full-model choice separate and replaces only the edited choice", () => {
    const selections = rememberModelParameters({ ...original, connectionId: "jijiu-default", parameters: { size: "2K", quality: "auto" },
      modelParameterSelections: rememberModelParameters(original) });
    const changed = rememberModelParameters({ ...original, parameters: { size: "2K", quality: "high" }, modelParameterSelections: selections });
    expect(changed).toHaveLength(2);
    expect(savedModelParameters(changed, "jijiu-default", highTier)?.parameters).toEqual({ size: "2K", quality: "auto" });
    expect(savedModelParameters(changed, original.connectionId, highTier)?.parameters).toEqual({ size: "2K", quality: "high" });
    expect(savedModelParameters(changed, "unknown", highTier)).toBeUndefined();
    expect(savedModelParameters(changed, original.connectionId, "gpt-image-2")).toBeUndefined();
  });

  it("never resurrects an old mask, and tolerates absent or malformed saved history", () => {
    const remembered = rememberModelParameters({ ...original, parameters: { ...original.parameters, maskAssetId: "old-mask", maskSourceAssetId: "old-source", mask: "old-url" },
      modelParameterSelections: [null, {}, { connectionId: "bad", model: highTier, parameters: [] }] });
    expect(remembered).toHaveLength(1);
    expect(remembered[0]?.parameters).toEqual(original.parameters);
    expect(rememberModelParameters({})).toEqual([]);
  });
});
