import type {
  ModelDescriptor,
  ModelParameterDescriptor,
} from "@super-canvas/providers";
import { supplierKeyForConnection } from "./supplier-identity";
import { matchesSupplierTemplate } from "./supplier-template-source";
import { imageSizeOptions, type ImageSizeTier } from "@super-canvas/providers";

const operations = ["image.generate", "image.edit"] as const;
const qualities = ["auto", "low", "medium", "high", "xhigh", "max"] as const;
const qualityLabels = ["自动", "低", "中", "高", "超高", "最高"];

/** Exact supplier/group/model evidence; never infer 2.5 capabilities from its name.
 * See docs/image25-provider-verification.md for docs, probes and limitations.
 */
export function applyVerifiedImage25Capabilities(
  connection: { provider: string; config: Readonly<Record<string, unknown>> },
  model: ModelDescriptor,
): ModelDescriptor {
  if (
    !matchesSupplierTemplate(connection) ||
    connection.config.usage === "agent"
  )
    return model;
  const supplier = supplierKeyForConnection(connection);
  const group = String(connection.config.modelGroup ?? "");
  const full =
    (supplier === "mikoto" &&
      ["生图（原生4k", "生图（原生4k）"].includes(group) &&
      model.id === "gpt-image-2.5-flare") ||
    (supplier === "frimodel" &&
      group === "gpt_image_adobe" &&
      /^gpt-image-2\.5-(flare|sunburst)-adobe$/u.test(model.id));
  const twoK =
    supplier === "cyberafei" &&
    group === "image-2稳定生图" &&
    model.id === "gpt-image-2.5";
  const chentuAdobe =
    supplier === "chentu" &&
    group === "低价Adobe生图" &&
    /^gpt-image-2\.5-(flare|sunburst)$/u.test(model.id);
  const advancedQuality = full || chentuAdobe;
  const cangyuanTier =
    supplier === "cangyuan" &&
    ["IMAGE", "IMAGE-备用分组", "全模型-无claude/gpt"].includes(group)
      ? (/^gpt-image-2\.5-flare-(1k|2k|4k)$/iu
          .exec(model.id)?.[1]
          ?.toUpperCase() as ImageSizeTier | undefined)
      : undefined;
  if (!full && !twoK && !cangyuanTier && !chentuAdobe) return model;
  // An actual key denial must remain unavailable even for a verified model.
  if (
    model.metadata?.canvasRunnable === false &&
    /403|权限|未开通|拒绝|下架|停用/u.test(
      String(model.metadata.canvasUnavailableReason ?? ""),
    )
  )
    return model;
  if (cangyuanTier) {
    // Saved authenticated inventories can outlive the marketplace descriptor.
    // Refresh only an already-declared dimension control for this fixed SKU.
    return {
      ...model,
      parameters: model.parameters?.map((parameter) =>
        parameter.key === "size" && parameter.control === "dimensions"
          ? {
              ...parameter,
              default: "auto",
              options: imageSizeOptions([cangyuanTier]),
            }
          : parameter,
      ),
    };
  }
  const sizes = imageSizeOptions(
    chentuAdobe ? ["1K", "4K"] : full ? ["1K", "2K", "4K"] : ["1K", "2K"],
    advancedQuality ? 3840 : 2048,
  );
  const size: ModelParameterDescriptor = {
    key: "size",
    label: "输出分辨率",
    control: "dimensions",
    valueType: "string",
    default: "auto",
    min: 16,
    max: advancedQuality ? 3840 : 2048,
    step: 16,
    options: sizes,
    operations,
    description: chentuAdobe
      ? "9 月 10 日晚复测：1K 与 3840×2160 实际像素成功；请求 2048×2048 返回 1920×1920，暂不提供精确 2K 档。"
      : full
        ? "按所选档位适配比例与尺寸；自动比例优先提示词，其次参考图。宽高按 16 像素对齐。"
        : "已实测 1K、2K；该渠道请求 4K 未返回目标像素，暂不提供 4K 预设。",
  };
  const quality: ModelParameterDescriptor = {
    key: "quality",
    label: "质量",
    control: "select",
    valueType: "string",
    default: "high",
    options: qualities
      .map((value, index) => ({
        label: `${qualityLabels[index]}（${value}）`,
        value,
      }))
      .filter(
        (option) =>
          model.id !== "gpt-image-2.5-sunburst-adobe" ||
          option.value !== "xhigh",
      ),
    operations,
    description:
      model.id === "gpt-image-2.5-sunburst-adobe"
        ? "已确认的质量档位；xhigh 本次实测超时，暂不新增。auto 由上游选择。"
        : "六档参数已实测；auto 由上游自动选择质量。",
  };
  const parameters = (model.parameters ?? []).filter(
    (p) => p.key !== "size" && (!advancedQuality || p.key !== "quality"),
  );
  const metadata = {
    ...model.metadata,
    canvasRunnable: true,
    supportsImageEdit: true,
    image25VerifiedAt: "2026-09-10",
    image25VerificationSource: "docs/image25-provider-verification.md",
    ...(chentuAdobe
      ? {
          image25VerificationSource:
            "docs/chentu-image25-recheck-2026-09-10.md",
        }
      : {}),
  };
  delete (metadata as Record<string, unknown>).canvasUnavailableReason;
  delete (metadata as Record<string, unknown>).parameterControlsUnavailable;
  return {
    ...model,
    parameters: [size, ...(advancedQuality ? [quality] : []), ...parameters],
    operations,
    inputKinds: ["text", "image"],
    outputKinds: ["image"],
    metadata,
  };
}
