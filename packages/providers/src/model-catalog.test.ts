import { describe, expect, it } from "vitest";
import { scanProviderModelCatalog } from "./model-catalog.js";

describe("provider model catalog scanner", () => {
  it("recognizes new video families and does not mistake visual understanding for generation", () => {
    const ids = ["happyhorse-1.1", "minimax-h3-4k", "wan3.0-15s", "gpt-4-vision-preview", "nano-banana2"];
    const models = scanProviderModelCatalog(ids.map(id => ({id}))).models;
    expect(models.slice(0, 3).every(m => m.operations.includes("video.generate"))).toBe(true);
    expect(models[3]?.operations).toEqual([]);
    expect(models[4]?.operations).toContain("image.generate");
  });
  it("keeps every group membership when one model occurs in multiple groups", () => {
    const scan = scanProviderModelCatalog({ data: [
      { id: "image-pro", group: "A" },
      { id: "image-pro", group: "B" },
      { model_name: "video-pro", enable_groups: ["A", "B"] },
    ] });
    expect(scan.models).toHaveLength(2);
    expect(scan.groups).toEqual([
      { id: "A", label: "A", modelIds: ["image-pro", "video-pro"] },
      { id: "B", label: "B", modelIds: ["image-pro", "video-pro"] },
    ]);
  });
  it("keeps live models grouped and carries price metadata", () => {
    const scan = scanProviderModelCatalog({
      data: [
        {
          id: "image-pro",
          name: "Image Pro",
          group: "图片组",
          price_label: "¥0.12/张",
          billing_mode: "per_request",
        },
        {
          id: "video-pro",
          name: "Video Pro",
          model_group: "视频组",
          pricing: { label: "$0.4/秒", unit: "second" },
          type: "video",
        },
      ],
    });

    expect(scan.models).toHaveLength(2);
    expect(scan.models[0]).toMatchObject({
      id: "image-pro",
      operations: ["image.generate", "image.edit"],
      metadata: {
        priceLabel: "¥0.12/张",
        billingLabel: "per_request",
        catalogGroup: "图片组",
        canvasRunnable: true,
      },
    });
    expect(scan.models[1]).toMatchObject({
      id: "video-pro",
      operations: ["video.generate", "video.image-to-video"],
      metadata: { priceLabel: "$0.4/秒", billingLabel: "second" },
    });
    expect(scan.groups).toEqual([
      { id: "图片组", label: "图片组", modelIds: ["image-pro"] },
      { id: "视频组", label: "视频组", modelIds: ["video-pro"] },
    ]);
  });

  it("marks unknown models as visible but not callable", () => {
    const scan = scanProviderModelCatalog({ models: [{ id: "chat-model" }] });
    expect(scan.models[0]).toMatchObject({
      id: "chat-model",
      operations: [],
      metadata: {
        canvasRunnable: false,
        canvasUnavailableReason: "尚未验证该模型的画布调用协议",
      },
    });
  });

  it("accepts direct arrays and recognizes common image/video model names", () => {
    const scan = scanProviderModelCatalog([
      { id: "dall-e-3", group: "绘图", price: "$0.04" },
      { id: "sora-2", group: "视频", pricing: { unit: "每秒" } },
    ]);

    expect(scan.models[0]?.operations).toContain("image.generate");
    expect(scan.models[0]?.metadata?.priceLabel).toBe("$0.04");
    expect(scan.models[1]?.operations).toContain("video.generate");
    expect(scan.groups.map((group) => group.label)).toEqual(["绘图", "视频"]);
  });
});
