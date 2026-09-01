import { describe, expect, it } from "vitest";
import {
  FRIMODEL_PLATFORM_GROUPS,
  FRIMODEL_SUPPLIER_KEY,
  friModelConnectionConfig,
  friModelDefaultModelForGroup,
  friModelFallbackImageDescriptor,
  isFriModelImageGroup,
  friModelSupportsImageEdit,
} from "./frimodel-presets";

describe("FriModel marketplace presets", () => {
  it("keeps every platform token group visible", () => {
    expect(FRIMODEL_PLATFORM_GROUPS.map((group) => group.id)).toEqual([
      "Kling",
      "Seedance2.0",
      "claude_max",
      "claude_max_外接",
      "codex_image",
      "default",
      "gemini_image",
      "gemini_pro",
      "gpt_image_adobe",
      "gpt_image_wc",
      "gpt_image_web",
      "grok",
      "gpt_image_super",
    ]);
  });

  it("only enables image groups with a verified canvas protocol", () => {
    expect(isFriModelImageGroup("codex_image")).toBe(true);
    expect(isFriModelImageGroup("gpt_image_super")).toBe(true);
    expect(isFriModelImageGroup("Seedance2.0")).toBe(false);
    expect(isFriModelImageGroup("claude_max")).toBe(false);
  });

  it("creates an isolated, live-scanned connection for each image group", () => {
    expect(friModelDefaultModelForGroup("gemini_image")).toBe(
      "gemini-3.1-flash-image-preview",
    );
    expect(friModelConnectionConfig("gpt_image_web")).toMatchObject({
      supplierKey: FRIMODEL_SUPPLIER_KEY,
      usage: "canvas",
      modelGroup: "gpt_image_web",
      defaultModel: "gpt-image-2-w",
      requestTimeoutMs: 300_000,
    });
  });

  it("declares the documented GPT Image 2 edit contract in scan fallbacks", () => {
    expect(friModelSupportsImageEdit("gpt-image-2-adobe")).toBe(true);
    expect(friModelSupportsImageEdit("gpt-image-2-high")).toBe(true);
    expect(friModelSupportsImageEdit("gemini-3.1-flash-image-preview")).toBe(
      false,
    );
    const descriptor = friModelFallbackImageDescriptor(
      "gpt-image-2-adobe",
      "gpt_image_adobe",
    );
    expect(descriptor).toMatchObject({
      operations: ["image.generate", "image.edit"],
      inputKinds: ["text", "image"],
      outputKinds: ["image"],
      metadata: {
        supportsImageEdit: true,
        referenceEditEndpoint: "/v1/images/edits",
      },
    });
    expect(descriptor?.parameters?.map((parameter) => parameter.key)).toEqual([
      "size",
      "quality",
      "output_format",
    ]);
    expect(descriptor?.parameters?.[0]?.options).toEqual(
      expect.arrayContaining([
        { label: "1K · 1:1 · 1024 × 1024", value: "1024x1024" },
        { label: "2K · 16:9 · 2560 × 1440", value: "2560x1440" },
        { label: "4K · 16:9 · 3840 × 2160", value: "3840x2160" },
      ]),
    );
    expect(
      friModelFallbackImageDescriptor("gpt-image-2-low")?.parameters?.find(
        (parameter) => parameter.key === "quality",
      ),
    ).toMatchObject({
      default: "low",
      options: [{ label: "低（low，模型固定）", value: "low" }],
    });
    expect(
      friModelFallbackImageDescriptor("gpt-image-2-medium")?.parameters?.find(
        (parameter) => parameter.key === "quality",
      ),
    ).toMatchObject({
      default: "medium",
      options: [{ label: "中（medium，模型固定）", value: "medium" }],
    });
  });
});
