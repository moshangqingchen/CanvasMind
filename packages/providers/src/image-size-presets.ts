import type { ModelParameterOption } from "./contracts.js";

export const IMAGE_SIZE_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "21:9",
  "9:21",
] as const;
export type ImageSizeTier = "1K" | "2K" | "4K";

/** Pixel budgets for the verified 2.5 channels, with provider-required 16px alignment. */
export function imageSizeForTier(
  tier: ImageSizeTier,
  ratioText = "1:1",
  maxEdge = 3840,
): string {
  const [a, b] = ratioText.split(":").map(Number);
  const rawRatio = a && b ? a / b : 1;
  const ratio = Math.max(1 / 3, Math.min(3, rawRatio));
  const pixels = { "1K": 1024 ** 2, "2K": 2048 ** 2, "4K": 3840 * 2160 }[tier];
  const scale = Math.min(
    1,
    maxEdge / Math.sqrt(pixels * ratio),
    maxEdge / Math.sqrt(pixels / ratio),
  );
  let width = Math.max(
    16,
    Math.round((Math.sqrt(pixels * ratio) * scale) / 16) * 16,
  );
  let height = Math.max(
    16,
    Math.round((Math.sqrt(pixels / ratio) * scale) / 16) * 16,
  );
  while (width * height > pixels) {
    if (width >= height) width -= 16;
    else height -= 16;
  }
  return `${width}x${height}`;
}

export function imageSizeOptions(
  tiers: readonly ImageSizeTier[],
  maxEdge = 3840,
): ModelParameterOption[] {
  return [
    { label: "自动（提示词比例优先，其次参考图）", value: "auto" },
    ...tiers.flatMap((tier) =>
      IMAGE_SIZE_RATIOS.map((ratio) => {
        const value = imageSizeForTier(tier, ratio, maxEdge);
        return {
          label: `${tier} · ${ratio} · ${value.replace("x", " × ")}`,
          value,
        };
      }),
    ),
  ];
}
