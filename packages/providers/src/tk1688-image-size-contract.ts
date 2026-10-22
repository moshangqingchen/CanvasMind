import type { ModelDescriptor, ModelParameterDescriptor } from "./contracts.js";

const tiers = ["1K", "2K", "4K"] as const;
type Tier = typeof tiers[number];

/** Merchant wording can switch origin mid-sentence: 原生1k 2k 超分4k.
 * Keep the declaration separate from requested or measured output pixels. */
function resolutionOrigins(description: string) {
  const origins = new Map<Tier, Set<"native" | "upscaled">>();
  for (const segment of description.split(/[，,。;；\n]|(?=(?<!非)(?<!不支持)(?<!禁止)(?<!not\s)(?:不支持|禁止|非|not\s+)?(?:原生|超分|放大|\bnative\b|\bupscal(?:e|ed|ing)\b))/iu)) {
    const clause = segment.trim();
    const origin = /^(?:原生|native\b)/iu.test(clause) ? "native"
      : /^(?:超分|放大|upscal(?:e|ed|ing)\b)/iu.test(clause) ? "upscaled" : undefined;
    if (!origin || /不支持|禁止|非原生|not\s+native/iu.test(clause)) continue;
    for (const match of clause.matchAll(/(?<![\d.])([124](?:\s*[/、,，]?\s*[124]){0,2})\s*k\b/giu))
      for (const digit of match[1]!.match(/[124]/gu) ?? []) {
        const tier = `${digit}K` as Tier;
        origins.set(tier, new Set([...(origins.get(tier) ?? []), origin]));
      }
  }
  return {
    nativeResolutions: tiers.filter(tier => origins.get(tier)?.size === 1 && origins.get(tier)?.has("native")),
    upscaledResolutions: tiers.filter(tier => origins.get(tier)?.size === 1 && origins.get(tier)?.has("upscaled")),
  };
}

/** A native output example does not make that pixel size the only legal size. */
export function tk1688DescriptionFacts(description: string) {
  const supported = new Set<Tier>();
  for (const match of description.matchAll(/(?:^|[^\d])([124](?:\s*[/、,，]?\s*[124]){0,2})\s*k\b/giu))
    for (const digit of match[1]!.match(/[124]/gu) ?? []) supported.add(`${digit}K` as Tier);
  const denied = [...description.matchAll(/(?:不支持|禁止|不含|不允许|不能|无)\s*((?:[124]\s*k?\s*[/、,，]\s*)*[124]\s*k)\b/giu)]
    .flatMap(match => match[1]!.match(/[124]/gu) ?? []);
  const unsupportedResolutions = tiers.filter(tier => denied.includes(tier[0]!));
  for (const tier of unsupportedResolutions) supported.delete(tier);
  const dimensions = [...description.matchAll(/\b(\d{3,5})\s*[x×*]\s*(\d{3,5})\b/giu)];
  const referenceSize = dimensions[0] ? `${Number(dimensions[0][1])}x${Number(dimensions[0][2])}` : undefined;
  const fixed = /(?<!不|非)(?:固定|(?:仅|只)(?:支持|接受|允许|输出)|仅限|限定为|只能(?:使用|输出|为))\s*(?:(?:尺寸|像素|分辨率|宽高|输出|为|是|[:：=])\s*)*(\d{3,5})\s*[x×*]\s*(\d{3,5})\b/iu.exec(description);
  const fixedSize = fixed && new Set(dimensions.map(match => `${Number(match[1])}x${Number(match[2])}`)).size === 1
    ? `${Number(fixed[1])}x${Number(fixed[2])}` : undefined;
  const exclusiveResolutions = /(?<!不|非)(?:仅(?:支持|限)?|只(?:支持|有|能)|限定|限|固定)\s*([124](?:\s*(?:k\s*)?[/、,，]\s*[124]){0,2})\s*k\b/iu.test(description);
  const omitN = /(?:不支持|禁止|不接受|不传)\s*(?:参数\s*)?[`"']?n\b|(?:does not support|unsupported)\s+[`"']?n\b/iu.test(description);
  const exclusiveQuality = /(?<!不|非)(?:仅|只)(?:支持|接受|允许|开放)\s*(?:(?:quality|质量)(?:档位)?\s*[:：=]?\s*)?((?:auto|low|medium|high|xhigh|max)(?:\s*(?:[,，、/|]|或|和|与)\s*(?:auto|low|medium|high|xhigh|max))*)(?![a-z])/iu.exec(description);
  const qualityMatch = exclusiveQuality ?? /(?:quality|质量)\s*(?:支持|档位|可选|为|[:：=])?\s*([a-z]+(?:(?:\s*[,，、/|]\s*)[a-z]+)+)/iu.exec(description);
  const quality = qualityMatch ? [...new Set(qualityMatch[1]!.toLowerCase().split(/\s*(?:[,，、/|]|或|和|与)\s*/u)
    .filter(value => ["auto", "low", "medium", "high", "xhigh", "max"].includes(value)))] : [];
  const origins = resolutionOrigins(description);
  return { resolutions: tiers.filter(tier => supported.has(tier)), unsupportedResolutions, exclusiveResolutions, referenceSize, fixedSize, omitN, quality,
    exclusiveQuality: Boolean(exclusiveQuality),
    nativeResolutions: origins.nativeResolutions.filter(tier => !unsupportedResolutions.includes(tier)),
    upscaledResolutions: origins.upscaledResolutions.filter(tier => !unsupportedResolutions.includes(tier)) };
}

function openSizeParameter(): ModelParameterDescriptor {
  return { key: "size", label: "输出尺寸", control: "dimensions", valueType: "string", default: "auto", options: [
    { value: "auto", label: "自动" }, { value: "1024x1024", label: "默认 · 1:1 · 1024 × 1024（官方工作台示例）" },
    { value: "1536x1024", label: "默认 · 3:2 · 1536 × 1024（官方工作台示例）" },
    { value: "1024x1536", label: "默认 · 2:3 · 1024 × 1536（官方工作台示例）" },
  ], description: "官方 size 使用 WIDTHxHEIGHT；工作台像素和商家原生输出说明作为参考，明确的固定尺寸限制单独保留。未公布自定义像素范围和步长。" };
}

type ImageModel = Pick<ModelDescriptor, "operations" | "parameters" | "metadata" | "description">;

/** Repair only catalog-derived size restrictions, leaving manual/paid evidence intact. */
export function normalizeTk1688ImageSizeContract<T extends Partial<ImageModel>>(model: T): T {
  if (model.metadata?.tk1688Catalog !== true || !model.operations?.some(operation => operation.startsWith("image.")) ||
      model.metadata?.source === "manual" || model.metadata?.source === "paid-test" || model.metadata?.protocolEvidence === "paid-test") return model;
  const metadata = { ...model.metadata };
  const description = typeof metadata.supplierChannelDescription === "string" ? metadata.supplierChannelDescription : model.description;
  const descriptions = description ? (metadata.tk1688Routing === "smart" ? description.split("\n") : [description]) : [];
  const allFacts = descriptions.map(tk1688DescriptionFacts);
  const facts = metadata.tk1688Routing !== "smart" ? allFacts[0] : undefined;
  if (facts) {
    if (facts.referenceSize) metadata.tk1688ReferenceSize = facts.referenceSize;
    if (facts.fixedSize) metadata.tk1688FixedSize = facts.fixedSize;
    else delete metadata.tk1688FixedSize;
    metadata.tk1688ResolutionOptionsExclusive = facts.exclusiveResolutions;
    metadata.tk1688UnsupportedResolutions = facts.unsupportedResolutions;
    metadata.exclusiveResolutions = facts.exclusiveResolutions;
    metadata.tk1688NativeResolutions = facts.nativeResolutions;
    metadata.tk1688UpscaledResolutions = facts.upscaledResolutions;
    if (facts.unsupportedResolutions.length) metadata.imageUnsupportedResolutions = [...new Set([
      ...(Array.isArray(metadata.imageUnsupportedResolutions) ? metadata.imageUnsupportedResolutions : []), ...facts.unsupportedResolutions,
    ])];
  }
  if (metadata.tk1688Routing === "smart" && allFacts.length) {
    // A merchant's limit is not an explicit limit on the bare smart model.
    // Preserve the common declared tiers as source data, not a closed enum.
    delete metadata.exclusiveResolutions;
    delete metadata.imageUnsupportedResolutions;
    delete metadata.tk1688ResolutionOptionsExclusive;
    delete metadata.tk1688UnsupportedResolutions;
    delete metadata.tk1688NativeResolutions;
    delete metadata.tk1688UpscaledResolutions;
    if (typeof metadata.tk1688FixedSize === "string" && allFacts.some(fact =>
      fact.referenceSize === metadata.tk1688FixedSize && !fact.fixedSize)) delete metadata.tk1688FixedSize;
  }
  for (const key of ["imageOutputDimensions", "imageFixedResolution", "imageResolutionProfiles", "imageSizeCapabilitiesSource", "imagePixelBudget", "imageSizeStep", "imageSizeMax"])
    delete metadata[key];
  const fixedSize = typeof metadata.tk1688FixedSize === "string" ? metadata.tk1688FixedSize : undefined;
  metadata.imageSizeOptionsCompleteEnum = Boolean(fixedSize);
  const size: ModelParameterDescriptor = fixedSize ? {
    key: "size", label: "精确尺寸", control: "select", valueType: "string", default: fixedSize,
    options: [{ value: fixedSize, label: `固定 ${fixedSize.replace("x", " × ")}` }], description: "当前商家明确限定的固定像素尺寸。",
  } : openSizeParameter();
  let parameters = [...(model.parameters ?? []).filter(parameter => parameter.key !== "size"), size];
  if (facts?.exclusiveQuality && facts.quality.length) {
    // A merchant's explicit closed quality enum survives saved-catalog repair
    // and the application-wide highest-quality presets. Never apply it to the
    // bare smart route, whose description combines several different SKUs.
    const quality: ModelParameterDescriptor = { key: "quality", label: "质量", control: "select", valueType: "string",
      default: facts.quality[0]!, options: facts.quality.map(value => ({ value, label: value })),
      description: `当前商家仅支持 ${facts.quality.join("、")} 质量；旧选择保留，请明确修改后提交。` };
    parameters = [...parameters.filter(parameter => parameter.key !== "quality"), quality];
    Object.assign(metadata, { tk1688QualityDeclared: true, tk1688QualitySource: "merchant-description",
      imageQualityOptionsCompleteEnum: true, imageQualityCompleteEnumSource: "tk1688-exclusive-merchant-description",
      imageApplicationQualityDefault: quality.default });
  } else if (metadata.imageQualityCompleteEnumSource === "tk1688-exclusive-merchant-description") {
    delete metadata.imageQualityOptionsCompleteEnum;
    delete metadata.imageQualityCompleteEnumSource;
    const values = facts?.quality.length ? facts.quality : ["auto", "high", "medium", "low"];
    parameters = [...parameters.filter(parameter => parameter.key !== "quality"), {
      key: "quality", label: "质量", control: "select", valueType: "string", default: values[0]!,
      options: values.map(value => ({ value, label: value })), description: facts?.quality.length
        ? "当前商家明确声明的质量档位。" : "词元生图工作台通用控件；商家未单独声明质量档位。",
    }];
    metadata.tk1688QualityDeclared = Boolean(facts?.quality.length);
    metadata.tk1688QualitySource = facts?.quality.length ? "merchant-description" : "official-image-station-common";
    delete metadata.imageApplicationQualityDefault;
  }
  if (!fixedSize) {
    const availableTiers = tiers.filter(tier =>
      !(Array.isArray(metadata.imageUnsupportedResolutions) && metadata.imageUnsupportedResolutions.includes(tier)) &&
      !(metadata.exclusiveResolutions === true && Array.isArray(metadata.tk1688SupportedResolutions) && !metadata.tk1688SupportedResolutions.includes(tier)));
    if (availableTiers.length < tiers.length) {
      // Workbench examples are not this exact merchant's default pixels.
      // Keep them in reference metadata, outside a restricted tier's menu.
      parameters = parameters.map(parameter => parameter.key === "size"
        ? { ...parameter, options: (parameter.options ?? []).filter(option => option.value === "auto") } : parameter);
      if (metadata.imageUserSizePresets) metadata.imageUserSizeSourceOptions = parameters.find(parameter => parameter.key === "size")?.options ?? [];
    }
    const prior = parameters.find(parameter => parameter.key === "resolution");
    const resolution: ModelParameterDescriptor = { ...prior, key: "resolution", label: "分辨率", control: "select", valueType: "string",
      default: prior?.default ?? "auto", options: [{ value: "auto", label: "自动" }, ...availableTiers.map(value => ({ value, label: value }))],
      description: "按用户要求补齐未明确禁止的分辨率档位；供应商原文档位单独保留。" };
    parameters = [...parameters.filter(parameter => parameter.key !== "resolution"), resolution];
    metadata.tk1688ResolutionPresetSource = "user-request";
  }
  Object.assign(metadata, { tk1688ImageSizeContract: 2, imageNativeParameterContract: true,
    imageResolutionTierParameter: "resolution", imageNativeResolutionParameter: "resolution",
    imageSupportedResolutions: metadata.tk1688SupportedResolutions ?? [],
    imageOutputReferenceDimensions: [
      { resolution: "auto", aspectRatio: "1:1", width: 1024, height: 1024 },
      { resolution: "auto", aspectRatio: "3:2", width: 1536, height: 1024 },
      { resolution: "auto", aspectRatio: "2:3", width: 1024, height: 1536 },
    ],
  });
  return { ...model, parameters, metadata };
}
