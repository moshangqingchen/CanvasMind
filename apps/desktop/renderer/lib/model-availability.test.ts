import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { inventoryChanges, modelAvailability, savedModelAvailabilityError } from "./model-availability";
const model = (id: string): ModelDescriptor => ({ id, name: id, operations: ["image.generate"] });
describe("model availability after supplier refresh", () => {
  it("blocks a removed saved selection without selecting another model or group", () => {
    const config = { modelScanStatus: "live", modelCatalogModels: [model("gemini-image")],
      defaultModel: "gpt-image-2.5-sunburst", modelGroup: "geminiResponseUrl" };
    expect(savedModelAvailabilityError(config, "gpt-image-2.5-sunburst")).toContain("已不在当前分组");
    expect(savedModelAvailabilityError(config)).toContain("已不在当前分组");
    expect(savedModelAvailabilityError(config, "gemini-image")).toBeNull();
    expect(savedModelAvailabilityError({ ...config, defaultModel: "" })).toContain("请先选择");
    expect(config.defaultModel).toBe("gpt-image-2.5-sunburst");
    expect(config.modelGroup).toBe("geminiResponseUrl");
  });
  it("respects empty, revoked, and unsupported inventories while leaving legacy unscanned connections unchanged", () => {
    expect(savedModelAvailabilityError({ modelScanStatus: "empty" }, "old")).toContain("为空");
    expect(savedModelAvailabilityError({ modelScanStatus: "unauthorized" }, "old")).toContain("鉴权失败");
    expect(savedModelAvailabilityError({ modelScanStatus: "live", modelCatalogModels: [
      { ...model("unsupported"), metadata: { canvasRunnable: false } },
    ] }, "unsupported")).toContain("不可用于画布");
    expect(savedModelAvailabilityError({ modelScanStatus: "failed", modelCatalogModels: [model("kept")] }, "removed")).toContain("已不在当前分组");
    expect(savedModelAvailabilityError({}, "legacy-image")).toBeNull();
    expect(savedModelAvailabilityError({ modelScanStatus: "live" }, "legacy-image")).toBeNull();
  });
  it("tracks additions, removals, and restoration without losing old removed IDs", () => {
    const first = inventoryChanges({ modelCatalogModels: [model("old"), model("kept")] }, [model("kept"), model("new")]);
    expect(first.modelAddedIds).toEqual(["new"]);
    expect(first.modelRemovedModels.map(m => m.id)).toEqual(["old"]);
    const second = inventoryChanges({ ...first, modelCatalogModels: [model("kept"), model("new")] }, [model("old"), model("new")]);
    expect(second.modelRemovedModels.map(m => m.id)).toEqual(["kept"]);
    expect(second.modelAddedIds).toEqual(["old"]);
  });
  it("never labels cached models available after failed authentication or a network failure", () => {
    expect(modelAvailability(model("image"), "failed").label).toBe("待确认");
    expect(modelAvailability(model("image"), "unauthorized").label).toBe("鉴权失败");
    expect(modelAvailability({ ...model("unsupported"), operations: [] }, "live").label).toBe("协议待适配");
    expect(modelAvailability(model("image"), "live").label).toBe("可用");
  });
  it("shows paid verification without treating an authentication failure as available", () => {
    const tested = { ...model("tested"), metadata: { imageCapabilitiesVerifiedAt: "2026-09-20", imageCapabilityNote: "实际像素可能调整" } };
    expect(modelAvailability(tested, "live")).toMatchObject({ label: "已实测", detail: expect.stringContaining("实际像素可能调整") });
    expect(modelAvailability(tested, "failed").label).toBe("待确认");
    expect(modelAvailability(tested, "unauthorized").label).toBe("鉴权失败");
    expect(modelAvailability({ ...tested, metadata: { ...tested.metadata, canvasRunnable: false } }, "live").label).toBe("协议待适配");
  });
});
