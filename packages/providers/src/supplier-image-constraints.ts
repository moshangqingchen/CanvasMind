import type { ModelDescriptor, ModelParameterDescriptor, ModelParameterOption, NormalizedRequest, ValidationIssue } from "./contracts.js";
import type { ImageEditingConnection } from "./image-editing-capabilities.js";
import { imageSizeOptions, imageSizePresetMatchesRatio, userImageSizeOptions } from "./image-size-presets.js";
import { userImageQualityValues } from "./user-image-quality-presets.js";
import { isMikotoGptImage, MIKOTO_GPT_IMAGE_SIZES, MIKOTO_GPT_RATIOS, MIKOTO_IMAGE_DOCS } from "./mikoto-image-contract.js";
import { verifiedTransparentImageEvidence } from "./transparent-image-evidence.js";

const image25 = new Set(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
// Exact Flare/group5 requests from 2026-09-13; these are neither fixed output
// pixels nor a complete supplier size enum. Sunburst has no such evidence.
const mikotoFlareOneKHistory: readonly ModelParameterOption[] = [
  ["1024x1024", "1:1"], ["1360x768", "16:9"], ["768x1360", "9:16"],
  ["1184x880", "4:3"], ["880x1184", "3:4"], ["1248x832", "3:2"], ["832x1248", "2:3"],
  ["1136x912", "5:4"], ["912x1136", "4:5"], ["1552x672", "21:9"], ["672x1552", "9:21"],
].map(([size, target]) => ({ value: size!, label: `1K · ${size!.replace("x", ":")} · ${size!.replace("x", " × ")}（历史请求，约 ${target}）` }));
const oneKExamples: readonly ModelParameterOption[] = [
  { label: "1K · 1:1 · 1024 × 1024", value: "1024x1024" },
  { label: "1K · 3:2 · 1536 × 1024", value: "1536x1024" },
  { label: "1K · 2:3 · 1024 × 1536", value: "1024x1536" },
];
const fri1KSizes: readonly ModelParameterOption[] = [
  { label: "自动（当前分组仅 1K）", value: "auto" },
  ...oneKExamples,
  { label: "1K · 3:4 · 768 × 1024", value: "768x1024" },
  { label: "1K · 4:3 · 1024 × 768", value: "1024x768" },
  { label: "1K · 4:5 · 768 × 960", value: "768x960" },
  { label: "1K · 5:4 · 960 × 768", value: "960x768" },
  { label: "1K · 9:16 · 1088 × 1920", value: "1088x1920" },
  { label: "1K · 16:9 · 1920 × 1088", value: "1920x1088" },
  { label: "1K · 21:9 · 1920 × 816", value: "1920x816" },
  { label: "1K · 9:21 · 816 × 1920", value: "816x1920" },
];
// Reject recognized higher-tier application choices, without inventing a
// maximum edge/pixel budget for Fri's otherwise open positive-integer W/H.
const higherTierPresetSizes = new Set([...imageSizeOptions(["2K", "4K"]), ...userImageSizeOptions(["2K", "4K"])]
  .filter(option => option.value !== "auto").map(option => option.value));

function hostname(connection: ImageEditingConnection): string | undefined {
  if (connection.provider !== "openai" && !(connection.provider === "rest" &&
      (isMikotoGptImage(connection, "gpt-image-2") || /^https:\/\/api\.3365api\.cn(?:\/v1)?\/?$/u.test(String(connection.config.baseUrl ?? ""))))) return;
  try {
    const url = new URL(String(connection.config.baseUrl ?? ""));
    if (url.protocol === "https:" && !url.port && !url.username && !url.password && !url.search && !url.hash &&
        /^(?:\/v1)?\/?$/u.test(url.pathname)) return url.hostname;
  } catch { /* A malformed URL is validated by the adapter. */ }
}
function group(connection: ImageEditingConnection): string {
  return String(connection.config.accountKeyGroup ?? connection.config.modelGroup ?? "");
}
/** The accepted input presets and actual low output pixels are independent facts. */
function mikotoAcceptedHighestInput(connection: ImageEditingConnection, model: string): boolean {
  const evidence = verifiedTransparentImageEvidence(connection, model, {}, "image.edit");
  return evidence?.hostname === "api.mikoto.vip" && evidence.supplierGroupId === "5" &&
    evidence.request.size === "3840x2160";
}
function afeiStableImage25(connection: ImageEditingConnection, model: string): boolean {
  return hostname(connection) === "api.3365api.cn" && group(connection) === "image-2稳定生图" && model === "gpt-image-2.5";
}
function withoutSizeBounds(parameter: ModelParameterDescriptor): ModelParameterDescriptor {
  const result = { ...parameter };
  delete result.min;
  delete result.max;
  return result;
}
function restrictedSizes(connection: ImageEditingConnection, model: string): readonly ModelParameterOption[] | undefined {
  const host = hostname(connection);
  // Secure Skill's current GPT2.5 native tier/ratio contract is applied by
  // secure-skill-image-contract; the retired three-size 1K rule no longer applies.
  if (["platform.frimodel.com", "api.frimodel.com"].includes(host ?? "") &&
      ["codex_image", "gpt_image_web"].includes(group(connection)) &&
      ["gpt-image-2-w", "gpt-image-2.5"].includes(model)) return fri1KSizes;
}

/** Nominal ratios of this exact group's rounded examples, for comparison only. */
export function supplierImageSizeNominalRatio(connection: ImageEditingConnection, model: string, size: unknown): string | undefined {
  const label = restrictedSizes(connection, model)?.find(option => option.value === size)?.label;
  return label ? /^1K · ([\d:]+) ·/u.exec(label)?.[1] : undefined;
}

/** Published examples belong to this supplier and complete ID only. */
export function isMikotoDocumentedImageSize(connection: ImageEditingConnection, model: string, size: string): boolean {
  return isMikotoGptImage(connection, model) &&
    (size === "auto" || /^[1-9]\d*(?:x|:)[1-9]\d*$/u.test(size));
}

/** Compare the application's ratio preference with user W/H; not a supplier size rule. */
export function mikotoImageRatioIssues(parameters: Readonly<Record<string, unknown>> = {}): ValidationIssue[] {
  const selected = ["aspect_ratio", "aspectRatio", "ratio"].flatMap(key => {
    const value = parameters[key];
    return value === undefined || value === null || value === "" || value === "auto" ? [] : [{ key, value }];
  });
  if (!selected.length) return [];
  const ratios = selected.map(({ key, value }) => {
    const parts = typeof value === "string" ? /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/u.exec(value) : null;
    return { key, value, ratio: parts ? Number(parts[1]) / Number(parts[2]) : Number.NaN };
  });
  const invalid = ratios.find(item => !Number.isFinite(item.ratio) || item.ratio <= 0);
  if (invalid) return [{ path: `parameters.${invalid.key}`, code: "invalid_aspect_ratio", message: "画面比例偏好请输入正数 WIDTH:HEIGHT 或 auto；原比例和 W/H 保留，请修改。" }];
  if (ratios.some(item => Math.abs(item.ratio / ratios[0]!.ratio - 1) > 1e-10))
    return [{ path: "parameters.aspect_ratio", code: "parameter_alias_conflict", message: "已保存的 aspect_ratio / aspectRatio / ratio 比例偏好冲突；原值保留，请明确一个比例。" }];
  const parts = typeof parameters.size === "string" ? /^(\d+)x(\d+)$/iu.exec(parameters.size.trim()) : null;
  if (!parts || ![parts[1], parts[2]].every(v => Number.isSafeInteger(Number(v)) && Number(v) > 0))
    return [{ path: "parameters.size", code: "aspect_ratio_requires_explicit_size", message: "比例偏好需要通过明确 W/H 的 size 表达；没有档位到像素映射，请填写 W/H，原档位和比例保留。" }];
  if (!imageSizePresetMatchesRatio(parameters.size, ratios[0]!.value) && Math.abs((Number(parts[1]) / Number(parts[2])) / ratios[0]!.ratio - 1) > 0.005)
    return [{ path: "parameters.aspect_ratio", code: "aspect_ratio_size_conflict", message: `size=${String(parameters.size)} 与比例偏好 ${String(ratios[0]!.value)} 不一致；请修改 W/H 或将比例设为 auto。原值保留，请求不猜测或改写像素。` }];
  return [];
}

/** Apply on both live and cached descriptors so the canvas follows the same contract. */
export function applySupplierImageConstraints(connection: ImageEditingConnection, model: ModelDescriptor): ModelDescriptor {
  if (afeiStableImage25(connection, model.id)) {
    const parameters = (model.parameters ?? []).filter(p => p.key !== "quality");
    parameters.push({ key: "quality", label: "质量", control: "select", valueType: "string", default: "high",
      options: ["low", "medium", "high"].map(value => ({ label: value, value })), operations: ["image.generate", "image.edit"],
      description: "当前同分组裸 GPT Image 2.5 接口明确只接受 low、medium、high；max 已被拒绝，合法最高为 high。" });
    return { ...model, parameters, metadata: { ...model.metadata,
      imageQualityOptionsCompleteEnum: true, imageQualityCompleteEnumSource: "same-group-current-schema-and-2026-10-14-rejection",
      imageRejectedQualities: ["max"], imageApplicationQualityDefault: "high" } };
  }
  if (mikotoAcceptedHighestInput(connection, model.id)) {
    const quality = model.id === "gpt-image-2" ? "high" : "max";
    const parameters = (model.parameters ?? []).filter(p => !["quality", "size_tier", "size", "resolution", "image_size"].includes(p.key));
    parameters.push({ key: "size", label: "输出尺寸", control: "dimensions", valueType: "string", default: "auto", allowCustomValue: true, step: 1,
      options: userImageSizeOptions(), operations: ["image.generate", "image.edit"],
      description: "当前稳定分组5已接受 3840×2160 参考图请求，1K/2K/4K 为应用预设；原图实测为1672×941，不把输入档位当作输出像素保证。" });
    parameters.push({ key: "size_tier", label: "分辨率档位", control: "select", valueType: "string", default: "4K",
      options: ["1K", "2K", "4K"].map(value => ({ label: value, value })), operations: ["image.generate", "image.edit"] });
    parameters.push({ key: "quality", label: "质量", control: "select", valueType: "string", default: quality,
      options: userImageQualityValues(model.id).map(value => ({ label: value, value })), operations: ["image.generate", "image.edit"],
      description: `同分组完整型号参考请求已接受 ${quality}；其他选项为用户应用预设，未逐项收费验证。` });
    const metadata = { ...model.metadata };
    for (const key of ["imageFixedResolution", "imageSizeContract", "imageSizeOptionsCompleteEnum", "imageSizeCompleteEnumSource",
      "imageQualityOptionsCompleteEnum", "imageQualityCompleteEnumSource", "imageUserSizePresets", "imageUserSizeSourceOptions", "imageUserSizeSourceDescription"])
      delete metadata[key];
    return { ...model, parameters, metadata: { ...metadata, mikotoImageContract: true, imageNativeParameterContract: true,
      imageResolutionTiers: ["1K", "2K", "4K"], imageResolutionTierParameter: "size_tier", imageResolutionTierSource: "user-presets+same-group-accepted-4K-input",
      imageOpenSizePreferences: true, imageSizeSourceKind: "user-request", imageReferenceTransport: "multipart-original-file",
      imageObservedOutputDimensions: { width: 1672, height: 941, requestedWidth: 3840, requestedHeight: 2160, checkedAt: "2026-10-14" } } };
  }
  const host = hostname(connection);
  const sizes = restrictedSizes(connection, model.id);
  const qualityByKey = host === "token.secure-skill.com" && model.id === "gpt-image-2";
  const mikotoImageGroup = ["生图（1k）", "生图（2k4k 中质量）", "生图（2k4k 高质量）"].includes(group(connection));
  const mikoto = mikotoImageGroup && isMikotoGptImage(connection, model.id);
  const mikoto25 = mikotoImageGroup && image25.has(model.id) && isMikotoGptImage(connection, "gpt-image-2");
  const mikoto1K = host === "api.mikoto.vip" && group(connection) === "生图（1k）" &&
    (model.id === "gpt-image-2" || image25.has(model.id));
  const mikoto25OneK = mikoto25 && mikoto1K;
  if (!sizes && !qualityByKey && !mikoto && !mikoto1K && !mikoto25) return model;
  let parameters = (model.parameters ?? []).filter(parameter => !(qualityByKey && parameter.key === "quality") &&
    !(sizes && ["aspect_ratio", "resolution", "image_size"].includes(parameter.key)));
  if (sizes) {
    parameters = parameters.filter(parameter => parameter.key !== "size");
    parameters = [{ key: "size", label: "输出分辨率（当前分组仅 1K）", control: sizes === fri1KSizes ? "dimensions" : "select", valueType: "string",
      default: "auto", options: sizes,
      ...(sizes === fri1KSizes ? { allowCustomValue: true, step: 1 } : {}),
      operations: ["image.generate", "image.edit"],
      description: sizes === fri1KSizes
        ? "当前官方分组仅 1K；保留尺寸示例及自定义正整数 W/H，示例不是完整枚举，未公布宽高上限。"
        : "按照当前供应商分组的官方限制选择；旧画布的 2K/4K 或自定义尺寸需重新选择。" }, ...parameters];
  }
  if (mikoto) {
    const declaredQuality = group(connection) === "生图（2k4k 中质量）" ? "medium"
      : group(connection) === "生图（2k4k 高质量）" ? "high" : undefined;
    const group2K4K = ["生图（2k4k 中质量）", "生图（2k4k 高质量）"].includes(group(connection));
    parameters = parameters.filter(parameter => parameter.key !== "response_format").map(parameter => parameter.key === "size" ? {
      ...withoutSizeBounds(parameter), step: 1, allowCustomValue: true,
      options: group2K4K ? MIKOTO_GPT_IMAGE_SIZES.filter(option => option.value !== "1024x1024") : MIKOTO_GPT_IMAGE_SIZES,
      description: "官网常用尺寸示例；自定义正整数宽高及比例按原值发送，供应商未公布宽高范围或对齐要求。size 不使用 2K / 4K 档位字符串。",
    } : parameter.key === "aspect_ratio" ? {
      ...parameter, options: [{ label: "自动", value: "auto" }, ...MIKOTO_GPT_RATIOS.map(value => ({ label: value, value }))],
    } : parameter.key === "quality" && declaredQuality ? {
      ...parameter, default: declaredQuality, options: [{ label: declaredQuality === "medium" ? "中" : "高", value: declaredQuality }],
      description: "当前官方分组规定的质量档位；旧画布的其他质量值需重新选择。",
    } : parameter);
    parameters.push({ key: "response_format", label: "结果返回方式", control: "select", valueType: "string",
      options: [{ label: "图片链接", value: "url" }, { label: "Base64", value: "b64_json" }], operations: ["image.generate", "image.edit"] });
  }
  if (mikoto1K) {
    parameters = parameters.map(parameter => parameter.key === "size" ? { ...parameter,
      options: model.id === "gpt-image-2"
        ? MIKOTO_GPT_IMAGE_SIZES.filter(option => option.value === "auto" || option.value === "1024x1024")
        : [{ label: "自动", value: "auto" }, ...(parameter.options ?? []).filter(option =>
          option.value !== "auto" && /^1K/u.test(option.label))],
      description: model.id === "gpt-image-2"
        ? "当前官方分组为 1K；尺寸示例来自本站 GPT Image 2 指南。"
        : parameter.description ?? "当前官方分组为 1K；保留该完整型号已有的 1K 请求值与历史来源，不借用 GPT Image 2 像素表。",
    } : ["resolution", "image_size"].includes(parameter.key) ? { ...parameter,
      options: [{ label: "1K", value: "1K" }],
    } : parameter);
  }
  if (mikoto25OneK) {
    parameters = parameters.filter(parameter => parameter.key !== "size");
    parameters.push({ key: "size", label: "输出尺寸", control: "dimensions", valueType: "string", default: "auto", step: 1,
      allowCustomValue: true, options: [{ label: "自动", value: "auto" }, ...(model.id === "gpt-image-2.5-flare" ? mikotoFlareOneKHistory : [])],
      operations: ["image.generate", "image.edit"],
      description: model.id === "gpt-image-2.5-flare"
        ? "当前分组声明 1K；尺寸选项是本完整型号的历史请求值，实际输出可由渠道调整。自定义正整数 W/H 原值发送，未公布范围、步长或完整枚举。"
        : "当前分组声明 1K；本完整型号未公布逐比例像素表。自动尺寸或自定义正整数 W/H 按 size 原值发送，未公布范围、对齐或完整枚举。" });
    const quality = parameters.find(parameter => parameter.key === "quality");
    parameters = parameters.filter(parameter => parameter.key !== "quality");
    parameters.push({ ...quality, key: "quality", label: quality?.label ?? "画质", control: "select", valueType: "string", default: "high",
      options: [{ label: "自动", value: "auto" }, { label: "高", value: "high" }], operations: ["image.generate", "image.edit"],
      description: "当前完整型号 1K 合同的自动与高质量选项；保留旧画布的原质量值，其他值请重新选择。" });
  }
  if (mikoto25 && (mikoto25OneK || ["生图（2k4k 中质量）", "生图（2k4k 高质量）"].includes(group(connection)))) {
    // Keep this complete model's existing request values. Its group tier
    // declaration does not publish GPT2's pixel table or a generic matrix.
    parameters = parameters.map(parameter => !mikoto25OneK && parameter.key === "size" && parameter.options ? { ...parameter,
      options: parameter.options.filter(option => !/^1K\b/iu.test(option.label)),
    } : parameter);
    if (!parameters.some(parameter => parameter.key === "size")) parameters.push({
      key: "size", label: "尺寸参数（size · W × H）", control: "dimensions", valueType: "string", step: 1,
      allowCustomValue: true, operations: ["image.generate", "image.edit"],
      description: "按输入的正整数 W/H 作为 size 原值发送；当前分组声明 2K / 4K，未公布该完整型号逐档像素映射，请填写 W/H。",
    });
    parameters = parameters.filter(parameter => parameter.key !== "size_tier");
    parameters.push({ key: "size_tier", label: "分辨率档位", control: "select", valueType: "string",
      options: (mikoto25OneK ? ["1K"] : ["2K", "4K"]).map(value => ({ label: value, value })), operations: ["image.generate", "image.edit"],
      description: "官方分组声明的可选档位；这是画布保存的档位选择，请求尺寸使用独立 W/H，不向接口补发档位字符串。" });
    parameters = parameters.filter(parameter => !["aspect_ratio", "aspectRatio", "ratio"].includes(parameter.key));
    parameters.push({ key: "aspect_ratio", label: "画面比例偏好", control: "text", valueType: "string", allowCustomValue: true,
      operations: ["image.generate", "image.edit"],
      description: "应用比例偏好，填写 auto / WIDTH:HEIGHT；通过明确 W/H 的 size 表达，不向供应商补发独立比例字段。比例与 W/H 须一致，选择比例保留已有档位和像素。" });
    if (!mikoto25OneK) {
      parameters = parameters.filter(parameter => parameter.key !== "quality");
      parameters.push(group(connection) === "生图（2k4k 中质量）"
      ? { key: "quality", label: "质量（quality）", control: "select", valueType: "string", default: "medium",
        options: [{ label: "medium", value: "medium" }], operations: ["image.generate", "image.edit"],
        description: "官方分组明确 GPT Image 2 与 2.5 只能使用中质量。" }
      : { key: "quality", label: "质量（quality）", control: "text", valueType: "string", default: "max",
        operations: ["image.generate", "image.edit"], description: "官方分组声明五档质量，未公布具体接口值；按输入的字符串发送。max 为用户最高质量偏好的应用初选，不是官网公布的枚举或默认值。" });
    }
  }
  const metadata = { ...model.metadata };
  if (sizes === fri1KSizes) {
    // The exact group contract has just been rebuilt; stale application
    // source options must not append a previous group's 2K/4K presets again.
    delete metadata.imageUserSizePresets;
    delete metadata.imageUserSizeSourceOptions;
    delete metadata.imageUserSizeSourceDescription;
  }
  if (metadata.imageQualityCompleteEnumSource === "mikoto-key-group") {
    delete metadata.imageQualityOptionsCompleteEnum;
    delete metadata.imageQualityCompleteEnumSource;
  }
  if (mikoto && ["生图（2k4k 中质量）", "生图（2k4k 高质量）"].includes(group(connection))) {
    metadata.imageQualityOptionsCompleteEnum = true;
    metadata.imageQualityCompleteEnumSource = "mikoto-key-group";
  }
  if (mikoto25OneK) {
    delete metadata.imageSizePresetSource;
    delete metadata.imageAspectRatiosVerifiedAt;
    delete metadata.imageAspectRatiosVerificationSource;
  }
  return { ...model, ...(model.parameters === undefined && !parameters.length ? {} : { parameters }), metadata: { ...metadata,
    ...(qualityByKey ? { imageQualitySource: "key-group", imageQualityNote: "质量由 API Key 所属分组决定，请求不发送 quality。" } : {}),
    ...(sizes ? { imageSizeContract: "group-1k-only" } : {}),
    ...(sizes === fri1KSizes ? { imageFixedResolution: "1K", imageResolutionTierSource: "official-key-group", imageResolutionTiers: ["1K"],
      imageSizeOptionsCompleteEnum: false, imageSizeSourceKind: "supplier-examples", imageOpenSizePreferences: true } : {}),
    ...(mikoto ? { mikotoImageContract: true, imageNativeParameterContract: true,
      imageSizeSource: MIKOTO_IMAGE_DOCS, imageSizeSourceKind: "supplier-examples", imageEditingSource: MIKOTO_IMAGE_DOCS } : {}),
    ...(mikoto1K ? { imageResolutionTierSource: "official-key-group", imageResolutionTiers: ["1K"] } : {}),
    ...((mikoto || mikoto25) && !mikoto1K ? { imageResolutionTierSource: "official-key-group", imageResolutionTiers: ["2K", "4K"] } : {}),
    ...(mikoto25 ? { mikotoImageContract: true, imageQualitySource: "official-key-group", imageQualityEnumPublished: group(connection) === "生图（2k4k 中质量）",
      imageResolutionTierParameter: "size_tier", imageAspectRatioSource: "application-preference-mapped-to-explicit-size", imageAspectRatioComparisonTolerance: 0.005,
      ...(group(connection) === "生图（2k4k 高质量）" ? { imageQualityDefaultSource: "user-highest-quality-preference" } : {}),
    } : {}),
    ...(mikoto25OneK ? { imageSizeOptionsCompleteEnum: false,
      ...(model.id === "gpt-image-2.5-flare" ? { imageSizeSourceKind: "historical-request-samples",
        imageSizeSource: "docs/mikoto-1k-ratios-2026-09-13.md", imageAspectRatiosVerifiedAt: "2026-09-13",
        imageAspectRatiosVerificationSource: "docs/mikoto-1k-ratios-2026-09-13.md" }
        : { imageSizeSourceKind: "supplier-open-field", imageSizeSource: "https://api.mikoto.vip/image-api-guide.html" }),
    } : {}),
  } };
}

export function supplierImageParameterIssues(connection: ImageEditingConnection,
  request: NormalizedRequest & { model: string }): ValidationIssue[] {
  const binding = (connection.config.autoModelInterfaces as Record<string, { source?: string; model?: { metadata?: Record<string, unknown> } }> | undefined)?.[request.model];
  if (connection.config.manualProtocol === true || connection.config.customGroup === true ||
      binding?.source === "manual" || binding?.model?.metadata?.source === "manual") return [];
  if (afeiStableImage25(connection, request.model)) return request.parameters?.quality !== undefined &&
    !["low", "medium", "high"].includes(String(request.parameters.quality))
    ? [{ path: "parameters.quality", code: "invalid_quality", message: "当前同分组 GPT Image 2.5 仅接受 low、medium、high，最高为 high；原质量值保留，请修改。" }] : [];
  if (mikotoAcceptedHighestInput(connection, request.model)) {
    const issues = mikotoImageRatioIssues(request.parameters);
    if (request.parameters?.quality !== undefined && !userImageQualityValues(request.model).includes(String(request.parameters.quality)))
      issues.push({ path: "parameters.quality", code: "invalid_quality", message: "请选择当前完整型号的应用质量；已接受最高值与其他未逐项实测选项分开记录。" });
    return issues;
  }
  const sizes = restrictedSizes(connection, request.model);
  const issues: ValidationIssue[] = [];
  if (isMikotoGptImage(connection, request.model) &&
      ["生图（2k4k 中质量）", "生图（2k4k 高质量）"].includes(group(connection)) && request.parameters?.size === "1024x1024")
    issues.push({ path: "parameters.size", code: "invalid_group_image_size", message: "当前官方分组为 2K / 4K，1K 请使用对应分组" });
  if (isMikotoGptImage(connection, "gpt-image-2") &&
      (request.model === "gpt-image-2" || image25.has(request.model)) && group(connection) === "生图（2k4k 中质量）" &&
      request.parameters?.quality !== undefined && request.parameters.quality !== "medium")
    issues.push({ path: "parameters.quality", code: "invalid_quality", message: "当前官方分组 GPT Image 2 与 2.5 仅支持 medium 质量" });
  if (isMikotoGptImage(connection, "gpt-image-2") && image25.has(request.model) &&
      ["生图（2k4k 中质量）", "生图（2k4k 高质量）"].includes(group(connection))) {
    issues.push(...mikotoImageRatioIssues(request.parameters));
    if (request.parameters?.size_tier !== undefined && !["2K", "4K"].includes(String(request.parameters.size_tier)))
      issues.push({ path: "parameters.size_tier", code: "invalid_group_image_size", message: "当前官方分组声明 2K / 4K 档位，请重新选择" });
    if (request.parameters?.size_tier !== undefined && (typeof request.parameters.size !== "string" || !/^[1-9]\d*x[1-9]\d*$/iu.test(request.parameters.size)))
      issues.push({ path: "parameters.size", code: "missing_image_dimensions", message: "当前完整型号未公布档位到像素的映射，请填写正整数 W/H；档位与比例选择保留" });
  }
  if (hostname(connection) === "api.mikoto.vip" && group(connection) === "生图（1k）" &&
      (request.model === "gpt-image-2" || image25.has(request.model))) {
    const selected = request.model === "gpt-image-2" ? MIKOTO_GPT_IMAGE_SIZES.find(option => option.value === request.parameters?.size) : undefined;
    if (selected && /^(?:2K|4K)/u.test(selected.label))
      issues.push({ path: "parameters.size", code: "invalid_group_image_size", message: "当前官方分组仅支持 1K，请重新选择分辨率" });
    for (const key of ["resolution", "image_size"] as const) {
      const value = request.parameters?.[key];
      if (value !== undefined && value !== "auto" && String(value).toUpperCase() !== "1K")
        issues.push({ path: `parameters.${key}`, code: "invalid_group_image_size", message: "当前官方分组仅支持 1K" });
    }
    if (image25.has(request.model)) {
      issues.push(...mikotoImageRatioIssues(request.parameters));
      if (request.parameters?.size_tier !== undefined && request.parameters.size_tier !== "1K")
        issues.push({ path: "parameters.size_tier", code: "invalid_group_image_size", message: "当前官方分组声明 1K 档位，请重新选择；原值保留" });
      if (request.parameters?.quality !== undefined && !userImageQualityValues(request.model ?? "").includes(String(request.parameters.quality)))
        issues.push({ path: "parameters.quality", code: "invalid_quality", message: "请选择当前完整型号的质量选项" });
    }
  }
  if (!sizes) return issues;
  const size = request.parameters?.size;
  const friOpenDimensions = sizes === fri1KSizes;
  const dimensions = typeof size === "string" ? /^([1-9]\d*)x([1-9]\d*)$/iu.exec(size) : null;
  const validOpenDimensions = dimensions && dimensions.slice(1).every(value => Number.isSafeInteger(Number(value)));
  const higherTierSize = higherTierPresetSizes.has(typeof size === "string" ? size.toLowerCase() : "") && !sizes.some(option => option.value === size);
  if (size !== undefined && size !== "auto" && (friOpenDimensions ? !validOpenDimensions || higherTierSize : !sizes.some(option => option.value === size)))
    issues.push({ path: "parameters.size", code: "invalid_group_image_size",
      message: friOpenDimensions ? `当前 ${group(connection)} 分组仅支持 1K；请选择 1K 尺寸或正整数 W/H，已保存的 2K/4K 预设需重新选择`
        : `当前 ${group(connection)} 分组仅支持官方 1K 尺寸，请重新选择分辨率；当前生成尚未提交` });
  for (const key of ["image_size", "resolution", ...(friOpenDimensions ? ["size_tier"] : [])]) {
    const value = request.parameters?.[key];
    if (value !== undefined && value !== "auto" && String(value).toUpperCase() !== "1K")
      issues.push({ path: `parameters.${key}`, code: "invalid_group_image_size", message: "当前分组仅支持 1K" });
  }
  return issues;
}
