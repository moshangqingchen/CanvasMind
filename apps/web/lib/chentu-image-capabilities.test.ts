import { expect, it } from "vitest";
import { applyChentuImageCapabilities } from "./chentu-image-capabilities";
import { chentuFallbackImageDescriptor } from "./chentu-catalog";

it("uses exact keyed sizes for a fixed model and preserves quality", () => {
  const model = chentuFallbackImageDescriptor(
    "gpt-image-2-4k",
    "兜底原生生图",
  )!;
  const result = applyChentuImageCapabilities(
    [model],
    {
      data: [
        {
          model: model.id,
          sizes: [
            { ratio: "1:1", value: "2880x2880" },
            { ratio: "16:9", value: "3840x2160" },
            { value: "garbage" },
          ],
        },
      ],
    },
    "2026-09-15",
  )[0]!;
  expect(result.parameters?.find((p) => p.key === "size")?.options).toEqual([
    { label: "4K · 1:1 · 2880 × 2880", value: "2880x2880" },
    { label: "4K · 16:9 · 3840 × 2160", value: "3840x2160" },
  ]);
  expect(result.parameters?.find((p) => p.key === "quality")).toEqual(
    model.parameters?.find((p) => p.key === "quality"),
  );
  expect(result.metadata?.imageSizeCapabilitiesCheckedAt).toBe("2026-09-15");
});

it("does not apply another model's sizes or empty/failed capability responses", () => {
  const model = chentuFallbackImageDescriptor(
    "gpt-image-2-2k",
    "兜底原生生图",
  )!;
  for (const payload of [
    null,
    { success: false, data: [] },
    { data: [{ model: model.id, sizes: [] }] },
    { data: [{ model: "gpt-image-2-4k", sizes: [{ value: "3840x2160" }] }] },
  ]) {
    expect(applyChentuImageCapabilities([model], payload, "today")[0]).toBe(
      model,
    );
  }
});

it("keeps native Gemini and custom-size protocols separate from generic Images samples", () => {
  for (const id of [
    "gemini-3.1-flash-image-preview",
    "gpt-image-2自由传参",
    "gpt-image-2.5-flare",
  ]) {
    const model = chentuFallbackImageDescriptor(id, "低价Adobe生图") ?? {
      id,
      name: id,
      operations: ["image.generate"] as const,
      metadata: { protocol: "gemini-generate-content" },
    };
    expect(
      applyChentuImageCapabilities(
        [model],
        { data: [{ model: id, sizes: [{ value: "1024x1024" }] }] },
        "today",
      )[0],
    ).toBe(model);
  }
});
