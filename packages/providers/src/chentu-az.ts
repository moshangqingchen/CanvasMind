import type { ModelDescriptor } from "./contracts.js";

export const CHENTU_AZ_IMAGE_MODELS = [
  "AZ-gpt-image-2",
  "AZ-gpt-image-2.5-flare",
  "AZ-gpt-image-2.5-sunburst",
] as const;

export function isChentuAzImageModel(id: string): boolean {
  return (CHENTU_AZ_IMAGE_MODELS as readonly string[]).includes(id);
}

export const CHENTU_AZ_IMAGE_SIZES = [
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "1824x1024",
  "1024x1824",
  "1792x768",
  "768x1792",
  "1024x768",
  "768x1024",
] as const;

/** Exact keyed generation/edit probes; see docs/chentu-az-live-test-2026-09-15.md. */
export function chentuAzImageDescriptor(
  id: string,
  group?: string,
): ModelDescriptor | undefined {
  if (
    !isChentuAzImageModel(id) ||
    (group && !["image2官key", "image2官key生图"].includes(group))
  )
    return undefined;
  return {
    id,
    name: id,
    operations: ["image.generate", "image.edit"],
    inputKinds: ["text", "image"],
    outputKinds: ["image"],
    parameters: [
      {
        key: "size",
        label: "输出尺寸（1K 实测）",
        control: "select",
        valueType: "string",
        default: "1024x1024",
        options: CHENTU_AZ_IMAGE_SIZES.map((value, index) => ({
          label: `1K · ${["1:1", "3:2", "2:3", "16:9", "9:16", "21:9", "9:21", "4:3", "3:4"][index]} · ${value.replace("x", " × ")}`,
          value,
        })),
        description: "当前官 key 分组仅接受 1K 档；2K 和 4K 已实测被拒绝。",
      },
      {
        key: "quality",
        label: "质量（渠道限定）",
        control: "select",
        valueType: "string",
        default: "low",
        options: [{ label: "low（1K 渠道已验证）", value: "low" }],
        description:
          "此渠道将 medium/high 用于选择 2K/4K，AZ 型号会被拒绝；不能套用 Adobe 的 max 质量。",
      },
    ],
    limits: {
      maxInputImages: 1,
      supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    },
    metadata: {
      supplier: "chentu",
      protocol: "openai-images",
      canvasRunnable: true,
      fixedOutputCount: 1,
      supportsImageEdit: true,
      azVerifiedAt: "2026-09-15",
      verificationSource: "docs/chentu-az-live-test-2026-09-15.md",
      ratioVerificationSource: "docs/chentu-az-ratio-test-2026-09-15.md",
    },
  };
}
