import type { ModelDescriptor, ModelParameterOption, NormalizedRequest, ValidationIssue } from "./contracts.js";
import type { ImageEditingConnection } from "./image-editing-capabilities.js";

const image25 = new Set(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
const secure25Sizes: readonly ModelParameterOption[] = [
  { label: "1K · 1:1 · 1024 × 1024", value: "1024x1024" },
  { label: "1K · 3:2 · 1536 × 1024", value: "1536x1024" },
  { label: "1K · 2:3 · 1024 × 1536", value: "1024x1536" },
];
const fri1KSizes: readonly ModelParameterOption[] = [
  { label: "自动（当前分组仅 1K）", value: "auto" },
  ...secure25Sizes,
  { label: "1K · 3:4 · 768 × 1024", value: "768x1024" },
  { label: "1K · 4:3 · 1024 × 768", value: "1024x768" },
  { label: "1K · 4:5 · 768 × 960", value: "768x960" },
  { label: "1K · 5:4 · 960 × 768", value: "960x768" },
  { label: "1K · 9:16 · 1088 × 1920", value: "1088x1920" },
  { label: "1K · 16:9 · 1920 × 1088", value: "1920x1088" },
  { label: "1K · 21:9 · 1920 × 816", value: "1920x816" },
  { label: "1K · 9:21 · 816 × 1920", value: "816x1920" },
];

function hostname(connection: ImageEditingConnection): string | undefined {
  if (connection.provider !== "openai") return;
  try {
    const url = new URL(String(connection.config.baseUrl ?? ""));
    if (url.protocol === "https:" && !url.port && !url.username && !url.password && !url.search && !url.hash &&
        /^(?:\/v1)?\/?$/u.test(url.pathname)) return url.hostname;
  } catch { /* A malformed URL is validated by the adapter. */ }
}
function group(connection: ImageEditingConnection): string {
  return String(connection.config.accountKeyGroup ?? connection.config.modelGroup ?? "");
}
function restrictedSizes(connection: ImageEditingConnection, model: string): readonly ModelParameterOption[] | undefined {
  const host = hostname(connection);
  // Group 49 explicitly publishes 1K/2K/4K. Do not generalize group 44's restriction.
  if (host === "token.secure-skill.com" && group(connection) === "gpt-image-2.5" && image25.has(model)) return secure25Sizes;
  if (["platform.frimodel.com", "api.frimodel.com"].includes(host ?? "") &&
      ["codex_image", "gpt_image_web"].includes(group(connection)) &&
      ["gpt-image-2-w", "gpt-image-2.5"].includes(model)) return fri1KSizes;
}

/** Published 21:9 exceptions belong to this supplier and complete ID only. */
export function isMikotoDocumentedImageSize(connection: ImageEditingConnection, model: string, size: string): boolean {
  return hostname(connection) === "api.mikoto.vip" && model === "gpt-image-2" &&
    ["3840x1646", "2560x1097"].includes(size);
}

/** Apply on both live and cached descriptors so the canvas follows the same contract. */
export function applySupplierImageConstraints(connection: ImageEditingConnection, model: ModelDescriptor): ModelDescriptor {
  const host = hostname(connection);
  const sizes = restrictedSizes(connection, model.id);
  const qualityByKey = host === "token.secure-skill.com" && model.id === "gpt-image-2";
  const mikoto = host === "api.mikoto.vip" && model.id === "gpt-image-2";
  if (!sizes && !qualityByKey && !mikoto) return model;
  let parameters = (model.parameters ?? []).filter(parameter => !(qualityByKey && parameter.key === "quality") &&
    !(sizes && ["aspect_ratio", "resolution", "image_size"].includes(parameter.key)));
  if (sizes) {
    parameters = parameters.filter(parameter => parameter.key !== "size");
    parameters = [{ key: "size", label: "输出分辨率（当前分组仅 1K）", control: "select", valueType: "string",
      default: sizes === secure25Sizes ? "1024x1024" : "auto", options: sizes,
      operations: ["image.generate", "image.edit"],
      description: "按照当前供应商分组的官方限制选择；旧画布的 2K/4K 或自定义尺寸需重新选择。" }, ...parameters];
  }
  if (mikoto) parameters = parameters.map(parameter => parameter.key !== "size" ? parameter : {
    ...parameter, step: 1,
    options: [...(parameter.options ?? []).filter(option => !["3840x1646", "2560x1097"].includes(String(option.value))),
      { label: "2K · 21:9 · 2560 × 1097（官方预设）", value: "2560x1097" },
      { label: "4K · 21:9 · 3840 × 1646（官方预设）", value: "3840x1646" }],
    description: "官方 21:9 预设允许 2560x1097 / 3840x1646；其他自定义尺寸仍须遵守 16 像素对齐。",
  });
  return { ...model, ...(model.parameters === undefined && !parameters.length ? {} : { parameters }), metadata: { ...model.metadata,
    ...(qualityByKey ? { imageQualitySource: "key-group", imageQualityNote: "质量由 API Key 所属分组决定，请求不发送 quality。" } : {}),
    ...(sizes ? { imageSizeContract: "group-1k-only" } : {}),
  } };
}

export function supplierImageParameterIssues(connection: ImageEditingConnection,
  request: NormalizedRequest & { model: string }): ValidationIssue[] {
  const sizes = restrictedSizes(connection, request.model);
  if (!sizes) return [];
  const issues: ValidationIssue[] = [];
  const size = request.parameters?.size;
  if (size !== undefined && size !== "auto" && !sizes.some(option => option.value === size))
    issues.push({ path: "parameters.size", code: "invalid_group_image_size",
      message: `当前 ${group(connection)} 分组仅支持官方 1K 尺寸，请重新选择分辨率；当前生成尚未提交` });
  for (const key of ["image_size", "resolution"] as const) {
    const value = request.parameters?.[key];
    if (value !== undefined && value !== "auto" && String(value).toUpperCase() !== "1K")
      issues.push({ path: `parameters.${key}`, code: "invalid_group_image_size", message: "当前分组仅支持 1K" });
  }
  return issues;
}
