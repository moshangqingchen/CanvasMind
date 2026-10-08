import type { ModelDescriptor, ModelParameterDescriptor, NormalizedRequest, StructuredModelPricing, StructuredPriceTier, ValidationIssue } from "./contracts.js";
import type { RestModelConnectorOverride, RestRequestMapping } from "./rest.js";
import { imageSizeForTier, imageSizeOptions, type ImageSizeTier } from "./image-size-presets.js";

const ids = new Set(["gpt-image-2-x", "gpt-image-2.5-x", "midjourney-v7", "seedream-5.0-pro-x", "gemini-nano-banana-2.1"]);
const operations = ["image.generate", "image.edit"] as const;
const gptRatios = ["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "21:9"];
const qualities = ["low", "medium", "high", "xhigh", "max"];
const kTiers = ["1k", "2k", "4k"];
const options = (values: readonly string[]) => values.map(value => ({ label: value, value }));
export const isCangyuanCurrentModel = (id: string | undefined): boolean => ids.has(id ?? "");
export function isCangyuanCurrentRequest(id: string | undefined, baseUrl?: string): boolean {
  if (!isCangyuanCurrentModel(id)) return false;
  try { return /(^|\.)cangyuansuanli\.cn$/u.test(new URL(baseUrl ?? "").hostname); } catch { return false; }
}

/** Exact public IDs reviewed in the supplier's dedicated JSON documents, 2026-10-01. */
export function cangyuanCurrentModel(model: ModelDescriptor): ModelDescriptor {
  if (!ids.has(model.id)) return model;
  if (model.id === "gemini-nano-banana-2.1") {
    const metadata = { ...model.metadata }, reason = String(metadata.canvasUnavailableReason ?? "");
    const denied = /401|403|权限|未开通|拒绝|下架|停用|未返回|unauthorized|forbidden|not.?returned|unavailable|disabled/iu.test(reason);
    const runnable = !denied && (metadata.canvasRunnable !== false || metadata.autoInterfaceStatus === "incomplete" || /协议|接口|尚未内置|protocol|adapter/iu.test(reason));
    if (runnable) { delete metadata.canvasUnavailableReason; delete metadata.pendingLiveScan; delete metadata.protocolSourceModel; if (metadata.autoInterfaceStatus === "incomplete") delete metadata.autoInterfaceStatus; }
    return { ...model, operations, inputKinds: ["text", "image", "image[]"], outputKinds: ["image", "image[]"],
    parameters: [
      { key: "aspect_ratio", label: "画面比例", control: "select", valueType: "string", default: "1:1", options: options(gptRatios), operations, description: "支持十种比例，省略为 1:1；不支持任意宽高或 9:21。" },
      { key: "quality", label: "输出分辨率", control: "select", valueType: "string", default: "4k", options: options(kTiers), operations, description: "清晰度用 quality，省略或 auto 按 1K 计费；参考像素与成品像素可能略有差异。" },
      { key: "n", label: "生成张数", control: "select", valueType: "integer", default: 1, options: [{ label: "1 张", value: 1 }], operations },
    ],
    limits: { ...model.limits, maxInputImages: 14, supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"] },
    metadata: { ...metadata, canvasRunnable: runnable, protocol: "rest", cangyuanCurrentContract: model.id, operationsSource: "declared", outputKindsSource: "declared", catalogCapability: "image",
      documentationUrl: "https://ai.cangyuansuanli.cn/docs-static/models/gemini-nano-banana-2.1.json", contractCheckedAt: "2026-10-07", remoteMediaUrlsOnly: true,
      imageSupportedResolutions: ["1K", "2K", "4K"], imageRequestResolutions: ["1K", "2K", "4K"], imageNativeResolutionParameter: "quality", imageNativeQualityOptions: true,
      maxInputImageBytes: 35 * 1024 * 1024, supportsMask: false },
  }; }
  const gpt = model.id.startsWith("gpt-image");
  const image25 = model.id === "gpt-image-2.5-x";
  const seedream = model.id === "seedream-5.0-pro-x";
  const parameters: ModelParameterDescriptor[] = [
    { key: "aspect_ratio", label: "画面比例", control: "select", valueType: "string", default: gpt ? "auto" : "16:9",
      options: [{ label: "自动", value: "auto" }, ...options([...gptRatios, "9:21"])],
      ...(!gpt && !seedream ? { description: "9:21 未列入 V7 官方比例，保留选项待核对；其余十种为官方声明。" } : {}), operations },
  ];
  if (image25) parameters.push({ key: "series", label: "产品线", control: "select", valueType: "string", required: true,
    default: "sunburst", options: options(["flare", "sunburst"]), operations });
  if (gpt) parameters.push(
    { key: "tier", label: "清晰度 / 计费档位", control: "select", valueType: "string", default: "4k",
      options: options(["web", ...kTiers]), description: "web 由渠道决定尺寸；1k / 2k / 4k 指定清晰度，精确宽高须在所选档位预算内。", operations },
    { key: "quality", label: "质量", control: "select", valueType: "string", default: "max", options: options(image25 ? ["auto", ...qualities] : qualities),
      visibleWhen: [{ parameter: "tier", values: kTiers }],
      description: image25 ? "仅 1k / 2k / 4k 生效；xhigh / max 按所选档标准价双倍计费。" : "仅 1k / 2k / 4k 生效，质量不改变价格。", operations },
  );
  if (gpt || seedream) parameters.push({ key: "size", label: "自定义宽高", control: "dimensions", valueType: "string",
    default: "auto", min: 1, ...(seedream ? { max: 2048, step: 16 } : {}),
    ...(seedream ? { options: imageSizeOptions(["1K", "2K"], 2048) } : {}),
    description: gpt ? "可选精确宽高；必须先选明确的 1k / 2k / 4k 计费档。" : "最高 2K；非原生比例由渠道就近收敛，成品像素以返回图片为准。", operations });
  if (model.id === "gpt-image-2-x") parameters.push({ key: "mask", label: "蒙版 HTTPS 地址", control: "text", valueType: "string",
    visibleWhen: [{ parameter: "tier", values: kTiers }], operations: ["image.edit"] });
  parameters.push({ key: "n", label: "生成张数", control: "number", valueType: "integer", default: 1, min: 1, max: 1, operations });
  const metadata = { ...model.metadata };
  delete metadata.canvasUnavailableReason;
  delete metadata.protocolSourceModel;
  delete metadata.pendingLiveScan;
  return { ...model, operations, parameters, inputKinds: ["text", "image", "image[]"], outputKinds: ["image", "image[]"],
    limits: { ...model.limits, maxInputImages: image25 ? 16 : gpt ? 9 : seedream ? 10 : 5, supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"] },
    metadata: { ...metadata, canvasRunnable: true, protocol: "rest", cangyuanCurrentContract: model.id,
      documentationUrl: `https://ai.cangyuansuanli.cn/docs-static/models/${model.id}.json`,
      imageSupportedResolutions: gpt ? ["1K", "2K", "4K"] : seedream ? ["1K", "2K"] : [],
      imageRequestResolutions: gpt ? ["1K", "2K", "4K"] : seedream ? ["1K", "2K"] : [],
      ...(gpt ? { imageNativeResolutionParameter: "tier", imageNativeQualityOptions: true } : { qualitySupport: "provider-decided" }),
      ...(seedream ? { imageUnsupportedResolutions: ["4K"] } : {}),
      ...(!gpt && !seedream ? { imageResolutionMode: "provider-decided", multipleOutputsPerRequest: true } : {}),
    } };
}

export function cangyuanCurrentTransport(id: string): RestModelConnectorOverride | undefined {
  if (!ids.has(id)) return undefined;
  const gpt = id.startsWith("gpt-image");
  const nano = id === "gemini-nano-banana-2.1";
  const mappings: RestRequestMapping[] = [
    { target: "/model", source: { kind: "request", path: "$.model" } },
    { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
    { target: "/size", source: { kind: "request", path: "$.parameters.aspect_ratio" }, omitIfUndefined: true, omitValues: ["auto"] },
    ...(!nano ? [{ target: "/size", source: { kind: "request" as const, path: "$.parameters.size" }, omitIfUndefined: true, omitValues: ["auto"] }] : []),
    ...(nano ? [{ target: "/quality", source: { kind: "request" as const, path: "$.parameters.quality" }, omitIfUndefined: true, omitValues: ["auto"] }] : []),
    ...(gpt ? [
      { target: "/tier", source: { kind: "request" as const, path: "$.parameters.tier" }, omitIfUndefined: true },
      { target: "/quality", source: { kind: "request" as const, path: "$.parameters.quality" }, omitIfUndefined: true,
        when: [{ path: "$.parameters.tier", values: kTiers }] },
    ] : []),
    ...(id === "gpt-image-2.5-x" ? [{ target: "/series", source: { kind: "request" as const, path: "$.parameters.series" } }] : []),
  ];
  const response = { taskIdPath: "$.id", taskIdFallbackPaths: ["$.task_id"], statusPath: "$.status", errorPath: "$.error.message", progressPath: "$.progress" };
  const submit = (edit: boolean) => ({ path: `/v1/images/${edit ? "edits" : "generations"}`, method: "POST" as const,
    bodyMode: "json" as const, template: { async: true, n: 1, response_format: "url" }, mappings: [...mappings,
      ...(edit ? [{ target: "/images", source: { kind: "assets" as const, assetKind: "image" as const }, omitIfEmpty: true }] : []),
      ...(edit && id === "gpt-image-2-x" ? [{ target: "/mask", source: { kind: "request" as const, path: "$.parameters.mask" }, omitIfUndefined: true, omitIfEmpty: true,
        when: [{ path: "$.parameters.tier", values: kTiers }] }] : [])], response });
  const poll = (edit: boolean) => ({ path: `/v1/images/${edit ? "edits" : "generations"}/{taskId}`, method: "GET" as const, bodyMode: "none" as const, response });
  return { submit: submit(false), poll: poll(false), pollIntervalMs: 5_000,
    output: { path: "$.data", kind: "image", urlPath: "url", base64Path: "b64_json", defaultMimeType: "image/png" },
    operationOverrides: { "image.edit": { submit: submit(true), poll: poll(true) } } };
}

/** Preflight exact-ID conditions before any upload or paid submission. */
export function cangyuanCurrentRequestIssues(request: NormalizedRequest, baseUrl?: string): ValidationIssue[] {
  if (!isCangyuanCurrentRequest(request.model, baseUrl)) return [];
  const p = request.parameters ?? {}, issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, code: "invalid_parameter", message });
  const gpt = request.model!.startsWith("gpt-image"), image25 = request.model === "gpt-image-2.5-x";
  const nano = request.model === "gemini-nano-banana-2.1";
  const tier = p.tier ?? "web";
  if (gpt && !["web", ...kTiers].includes(String(tier))) add("parameters.tier", "沧元清晰度档只能为 web、1k、2k、4k。");
  if (image25 && !["flare", "sunburst"].includes(String(p.series))) add("parameters.series", "gpt-image-2.5-x 必须选择 flare 或 sunburst 产品线。");
  if (gpt && tier === "web" && p.size !== undefined && p.size !== "auto" && /^\d+x\d+$/u.test(String(p.size)))
    add("parameters.tier", "精确宽高请求必须选择 1k / 2k / 4k 计费档；仅有 size 的旧参数不能作为 web 档提交。");
  if (gpt && p.tier === undefined && p.quality !== undefined) add("parameters.tier", "带质量参数的旧请求必须先选择明确的 1k / 2k / 4k 清晰度档。");
  if (gpt && tier === "web" && p.aspect_ratio === "9:21") add("parameters.tier", "9:21 通过精确像素请求，请选择 1k / 2k / 4k 档；web 未声明该比例。");
  if (request.model === "midjourney-v7" && p.aspect_ratio === "9:21") add("parameters.aspect_ratio", "Midjourney V7 官方尚未声明 9:21；此比例待核对，当前不会提交收费请求。");
  if (gpt && kTiers.includes(String(tier)) && p.quality !== undefined && !(image25 && p.quality === "auto") && !qualities.includes(String(p.quality)))
    add("parameters.quality", "该型号质量只能为 low、medium、high、xhigh、max。");
  if (p.n !== undefined && p.n !== 1) add("parameters.n", "该型号每次请求只能 n=1。");
  const references = request.assets?.filter(a => a.kind === "image" && a.role !== "mask") ?? [];
  const limit = nano ? 14 : image25 ? tier === "web" ? 9 : 16 : gpt ? 9 : request.model === "midjourney-v7" ? 5 : 10;
  if (references.length > limit) add("assets", `${request.model} 当前档位最多支持 ${limit} 张参考图。`);
  if (nano) {
    if (p.aspect_ratio !== undefined && !gptRatios.includes(String(p.aspect_ratio))) add("parameters.aspect_ratio", "Nano 2.1 只支持文档声明的十种比例，不支持 9:21 或 auto。");
    if (p.size !== undefined) add("parameters.size", "Nano 2.1 使用画面比例控件，不接受自定义宽高或另行 size 参数。");
    if (p.quality !== undefined && ![...kTiers, "auto"].includes(String(p.quality))) add("parameters.quality", "Nano 2.1 清晰度只能为 1k、2k、4k，或省略/auto。");
    for (const key of Object.keys(p)) if (!["aspect_ratio", "quality", "n", "size"].includes(key)) add(`parameters.${key}`, `Nano 2.1 专属 Images 合同不支持 ${key}。`);
    if (request.assets?.some(a => a.role === "mask")) add("assets", "Nano 2.1 不支持蒙版。");
    for (const asset of references) {
      if (asset.url !== undefined && !/^https:\/\//u.test(asset.url)) add("assets", "Nano 2.1 参考图必须为公网 HTTPS URL。");
      if (!["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType)) add("assets", "Nano 2.1 仅支持 PNG、JPEG、WebP 参考图。");
      if (asset.data && asset.data.byteLength > 35 * 1024 * 1024) add("assets", "Nano 2.1 每张参考图不得超过 35MB。");
    }
  }
  if (p.mask && (request.model !== "gpt-image-2-x" || tier === "web" || request.operation !== "image.edit")) add("parameters.mask", "仅 gpt-image-2-x 的 1k / 2k / 4k 编辑请求支持蒙版。");
  if (p.mask && !String(p.mask).startsWith("https://")) add("parameters.mask", "蒙版必须使用公网 HTTPS 地址。");
  if (request.model === "midjourney-v7" && request.prompt.length > 4000) add("prompt", "Midjourney V7 提示词最多 4000 字符。");
  if (request.model === "seedream-5.0-pro-x" && request.prompt.length > 8000) add("prompt", "Seedream 提示词最多 8000 字符。");
  if (request.model === "seedream-5.0-pro-x" && /^\d+x\d+$/u.test(String(p.size)) && String(p.size).split("x").some(v => Number(v) > 2048))
    add("parameters.size", "seedream-5.0-pro-x 最高 2K，请选择 1K / 2K 请求预设。");
  return issues;
}

/** The undocumented GPT 9:21 ratio uses documented WxH instead of a new ratio enum. */
export function withCangyuanCurrentRequestParameters(request: NormalizedRequest, baseUrl?: string): NormalizedRequest {
  if (!isCangyuanCurrentRequest(request.model, baseUrl)) return request;
  if (request.model === "seedream-5.0-pro-x") {
    const ratio = String(request.parameters?.aspect_ratio ?? "");
    const nearest: Record<string, string> = { "5:4": "4:3", "4:5": "3:4", "9:21": "9:16" };
    return nearest[ratio] ? { ...request, parameters: { ...request.parameters, aspect_ratio: nearest[ratio] } } : request;
  }
  if (!request.model?.startsWith("gpt-image") ||
    request.parameters?.aspect_ratio !== "9:21" || !kTiers.includes(String(request.parameters.tier)) ||
    (request.parameters.size !== undefined && request.parameters.size !== "auto")) return request;
  return { ...request, parameters: { ...request.parameters, size: imageSizeForTier(String(request.parameters.tier).toUpperCase() as ImageSizeTier, "9:21") } };
}

/** Parse only the two published exact billing shapes; never execute supplier expressions. */
export function cangyuanCurrentPricing(id: string, expression: unknown, multiplier: number, checkedAt: string): StructuredModelPricing | undefined {
  if (id === "gemini-nano-banana-2.1") {
    const expected = 'has(param("quality"), "4k") || has(param("quality"), "4K") ? tier("4k", n * 0.10) : has(param("quality"), "2k") || has(param("quality"), "2K") ? tier("2k", n * 0.08) : tier("1k", n * 0.06)';
    const canonical = (s: string) => s.replace(/\s/gu, "").replace(/n\*(\d+(?:\.\d+)?)/gu, (_, v: string) => `n*${Number(v)}`);
    if (typeof expression !== "string" || canonical(expression) !== canonical(expected) || !Number.isFinite(multiplier) || multiplier < 0) return undefined;
    return { kind: "tiered", currency: "CNY", billingUnit: "image", sourceUrl: "https://ai.cangyuansuanli.cn/api/pricing", checkedAt, confidence: "exact",
      tiers: ["4k", "2k"].map<StructuredPriceTier>((value, i) => ({ id: value, label: value, price: Number(((i === 0 ? 0.1 : 0.08) * multiplier).toPrecision(12)),
        conditions: [{ parameter: "quality", operator: "contains" as const, value }], conditionMode: "all" as const })).concat([{ id: "1k", label: "1k", price: Number((0.06 * multiplier).toPrecision(12)), otherwise: true } as StructuredPriceTier]) };
  }
  if (!id.endsWith("-x") || typeof expression !== "string" || expression.length > 4096) return undefined;
  const rates = new Map([...expression.matchAll(/tier\("([^"\\]+)",\s*n\s*\*\s*(\d+(?:\.\d+)?)\)/gu)].map(m => [m[1]!, Number(m[2])]));
  const clean = expression.replace(/\s/gu, "");
  const tier = (label: string) => `tier("${label}",n*${rates.get(label)})`;
  let expected: string;
  const tiers: StructuredPriceTier[] = [];
  const condition = (parameter: string, value: string) => ({ parameter, operator: "equals" as const, value });
  const push = (label: string, conditions?: StructuredPriceTier["conditions"]) => {
    const raw = rates.get(label); if (raw === undefined) return;
    tiers.push({ id: `${label}-${tiers.length}`, label, price: Number((raw * multiplier).toPrecision(12)),
      ...(conditions ? { conditions, conditionMode: "all" as const } : { otherwise: true }) });
  };
  if (id === "gpt-image-2-x") {
    expected = ["4k", "2k", "1k"].map(k => `param("tier")=="${k}"?${tier(k)}:`).join("") + tier("web");
    for (const k of ["4k", "2k", "1k"]) push(k, [condition("tier", k)]);
    push("web");
  } else if (id === "gpt-image-2.5-x") {
    const branch = (series: string) => ["4k", "2k", "1k"].map(k => `param("tier")=="${k}"?((param("quality")=="xhigh"||param("quality")=="max")?${tier(`${series} ${k} xhigh`)}:${tier(`${series} ${k}`)}):`).join("") + tier(`${series} web`);
    expected = `param("series")=="flare"?(${branch("flare")}):(${branch("sunburst")})`;
    for (const series of ["flare", "sunburst"]) {
      for (const k of ["4k", "2k", "1k"]) {
        for (const quality of ["xhigh", "max"]) push(`${series} ${k} xhigh`, [condition("series", series), condition("tier", k), condition("quality", quality)]);
        push(`${series} ${k}`, [condition("series", series), condition("tier", k)]);
      }
      push(`${series} web`, [condition("series", series)]);
    }
  } else return undefined;
  // Numeric literals such as 0.40 and 0.4 are equivalent. Preserve all syntax around them.
  const canonical = (s: string) => s.replace(/\s/gu, "").replace(/n\*(\d+(?:\.\d+)?)/gu, (_, v: string) => `n*${Number(v)}`);
  if (canonical(clean) !== canonical(expected) || !Number.isFinite(multiplier) || multiplier < 0) return undefined;
  return { kind: "tiered", currency: "CNY", billingUnit: "image", tiers, checkedAt,
    sourceUrl: "https://ai.cangyuansuanli.cn/api/pricing", confidence: "exact" };
}
