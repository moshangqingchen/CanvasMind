import { describe, expect, it } from "vitest";
import {
  CHENTU_DEFAULT_MODEL,
  CHENTU_MODEL_GROUP,
  CHENTU_PLATFORM_GROUPS,
  CHENTU_SUPPLIER_KEY,
  chentuConnectionConfig,
  chentuDefaultModelForGroup,
  isChentuImageGroup,
} from "./chentu-presets";

describe("辰途 API image presets", () => {
  it("keeps the model-plaza groups and documented image candidates visible", () => {
    expect(CHENTU_PLATFORM_GROUPS).toHaveLength(21);
    expect(CHENTU_PLATFORM_GROUPS.map((group) => group.id)).toEqual(
      expect.arrayContaining([
        "1k低价生图",
        "image2官key",
        "image2官key生图",
        "低价Adobe生图",
        "低价gemni生图",
        "兜底原生生图",
        "测试生图",
      ]),
    );
    const imageIds = CHENTU_PLATFORM_GROUPS.flatMap((group) =>
      group.models.map((model) => model.id),
    );
    expect(imageIds).toEqual(
      expect.arrayContaining([
        "gpt-image-2",
        "gpt-image-2-4k",
        "gemini-3.1-flash-image-4k",
        "gemini-3-pro-image-4k",
      ]),
    );
    expect(
      CHENTU_PLATFORM_GROUPS.find((group) => group.id === "低价Adobe生图")?.models.find(
        (model) => model.id === "gpt-image-2-4k",
      )?.priceLabel,
    ).toBe("￥ 0.05 / 请求");

    expect(
      CHENTU_PLATFORM_GROUPS.find((group) => group.id === "低价Adobe生图")?.models.map(
        (model) => model.id,
      ),
    ).toEqual([
      "gpt-image-2-1k",
      "gpt-image-2-2k",
      "gpt-image-2-4k",
      "gpt-image-2自由传参",
    ]);
    expect(
      CHENTU_PLATFORM_GROUPS.find((group) => group.id === "image2官key"),
    ).toMatchObject({
      ratio: 4.5,
      canvasSupported: true,
      models: [
        expect.objectContaining({
          id: "gpt-image-2-4k",
          priceLabel: "￥ 0.18 / 请求",
        }),
        expect.objectContaining({
          id: "gpt-image-2自由传参",
          priceLabel: "￥ 0.18 / 请求",
        }),
      ],
    });
    expect(
      CHENTU_PLATFORM_GROUPS.find((group) => group.id === "image2官key生图"),
    ).toMatchObject({
      ratio: 4.5,
      canvasSupported: true,
      models: [
        expect.objectContaining({ id: "gpt-image-2-4k" }),
        expect.objectContaining({ id: "gpt-image-2自由传参" }),
      ],
    });
  });

  it("keeps image groups live-scanned and a long image timeout", () => {
    expect(isChentuImageGroup(CHENTU_MODEL_GROUP)).toBe(true);
    expect(isChentuImageGroup("image2官key生图")).toBe(true);
    expect(isChentuImageGroup("default")).toBe(false);
    expect(chentuDefaultModelForGroup(CHENTU_MODEL_GROUP)).toBe(
      CHENTU_DEFAULT_MODEL,
    );
    expect(chentuConnectionConfig()).toMatchObject({
      supplierKey: CHENTU_SUPPLIER_KEY,
      modelGroup: CHENTU_MODEL_GROUP,
      defaultModel: CHENTU_DEFAULT_MODEL,
      requestTimeoutMs: 600_000,
    });
  });
});
