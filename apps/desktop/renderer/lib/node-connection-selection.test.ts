import { describe, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { applyJijiuImageCapabilities } from "@super-canvas/providers/jijiu-image-contract";
import { nodeConnectionSelection, preferredConnectionModel, runnableConnectionModels } from "./node-connection-selection";
import { rememberModelParameters } from "./saved-model-parameters";

const image = (id: string, extra: Partial<ModelDescriptor> = {}): ModelDescriptor => ({ id, name: id, operations: ["image.generate"], ...extra });
const target = { id: "target", provider: "openai", config: { defaultModel: " target-default " } };
const models = [image("current-model"), image("target-default", { isDefault: true }), image("last-target-choice")];
const select = (preferredId?: string) => preferredConnectionModel(models, preferredId);

describe("connection selection and read-only route preview share one model decision", () => {
  it("restores the target connection's last model rather than the same-ID comparison candidate", () => {
    const selections = rememberModelParameters({ connectionId: target.id, model: "last-target-choice", parameters: { quality: "high" }, qualityMode: "custom" });
    const data = { connectionId: "source", model: "current-model", parameters: { size: "4K", maskAssetId: "canvas-mask" }, modelParameterSelections: selections };
    const before = JSON.stringify(data);
    const preview = nodeConnectionSelection(data, "image-generation", undefined, target, select);
    const command = nodeConnectionSelection(data, "image-generation", undefined, target, select, rememberModelParameters(data));
    expect(preview).toEqual(command);
    expect(preview.configuredModel?.id).toBe("last-target-choice");
    expect(preview.restoredSelection?.parameters).toEqual({ quality: "high" });
    expect(preview.restoredSelection?.qualityMode).toBe("custom");
    expect(JSON.stringify(data)).toBe(before);
  });

  it("uses the configured default on a first visit and leaves absent saved models to the original selector", () => {
    const data = { connectionId: "source", model: "current-model", parameters: {} };
    const first = nodeConnectionSelection(data, "image-generation", undefined, target, select);
    expect(first.configuredModel?.id).toBe("target-default");
    expect(first.restoredSelection).toBeUndefined();

    const missing = { ...data, modelParameterSelections: [{ connectionId: target.id, model: "removed-model", parameters: { size: "old" } }] };
    const preferred = vi.fn(select);
    const restored = nodeConnectionSelection(missing, "image-generation", undefined, target, preferred);
    expect(preferred).toHaveBeenCalledExactlyOnceWith("removed-model");
    expect(restored.configuredModel?.id).toBe("target-default");
    expect(restored.restoredSelection).toBeUndefined();
  });

  it("retains the existing Jijiu first-visit transfer and gives explicit target history priority", () => {
    const id = "gpt-image-2-2K/4K";
    const source = { id: "jijiu-source", provider: "openai", config: { baseUrl: "https://newapi.jijiucanvas.com/v1", modelGroup: "default" } };
    const destination = { id: "jijiu-target", provider: "openai", config: { baseUrl: "https://newapi.jijiucanvas.com", modelGroup: "图片-GPT-image-2-2K/4K" } };
    const transferredModel = applyJijiuImageCapabilities(destination, image(id));
    const data = { connectionId: source.id, provider: source.provider, model: id,
      parameters: { size: "4K", quality: "high", n: 1, maskAssetId: "active-mask" }, qualityMode: "custom" as const };
    const find = (preferredId?: string) => preferredConnectionModel([image("default", { isDefault: true }), transferredModel], preferredId);
    const transferred = nodeConnectionSelection(data, "image-generation", source, destination, find);
    expect(transferred.configuredModel?.id).toBe(id);
    expect(transferred.restoredSelection).toMatchObject({ connectionId: destination.id, parameters: { size: "4K", quality: "high", n: 1 }, qualityMode: "custom" });
    expect(transferred.restoredSelection?.parameters).not.toHaveProperty("maskAssetId");
    expect(data.parameters.maskAssetId).toBe("active-mask");
    const otherSupplier = { ...destination, config: { ...destination.config, baseUrl: "https://other.example" } };
    expect(nodeConnectionSelection(data, "image-generation", source, otherSupplier, find).configuredModel?.id).toBe("default");

    const saved = rememberModelParameters({ connectionId: destination.id, model: "default", parameters: { size: "auto" } });
    expect(nodeConnectionSelection({ ...data, modelParameterSelections: saved }, "image-generation", source, destination, find).configuredModel?.id).toBe("default");
  });

  it("does not start restoring image history for video or audio", () => {
    const data = { connectionId: "source", model: "current-model", parameters: {},
      modelParameterSelections: [{ connectionId: target.id, model: "last-target-choice", parameters: {} }] };
    for (const nodeType of ["video-generation", "music-generation"] as const) {
      const chosen = vi.fn(select);
      const result = nodeConnectionSelection(data, nodeType, undefined, target, chosen);
      expect(chosen).toHaveBeenCalledExactlyOnceWith("target-default");
      expect(result.restoredSelection).toBeUndefined();
    }
  });

  it("keeps media eligibility, saved aliases, supplier defaults, first-model order and an empty directory", () => {
    const compatible = runnableConnectionModels([
      { id: "video", name: "video", operations: ["video.generate"] },
      image("denied", { metadata: { canvasRunnable: false } }),
      image("first"), image("default", { isDefault: true }),
    ], "image-generation");
    expect(compatible.map(model => model.id)).toEqual(["first", "default"]);
    expect(preferredConnectionModel(compatible, "first")?.id).toBe("first");
    expect(preferredConnectionModel(compatible, "missing")?.id).toBe("default");
    expect(preferredConnectionModel([compatible[0]!], "missing")?.id).toBe("first");
    expect(preferredConnectionModel([], "missing")).toBeNull();
    expect(preferredConnectionModel([image("gpt-image-2-low"), image("gpt-image-2-high")], "gpt-image-2-high::4k")?.id).toBe("gpt-image-2-high");
  });
});
