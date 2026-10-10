import type { ModelDescriptor } from "./contracts.js";
import { pdogImageOrigin, PDOG_GEMINI_DOCUMENTATION, PDOG_GEMINI_LEGACY_UNAVAILABLE } from "./pdog-image-contract.js";
import { modelSupportsGenerationMedia } from "./model-media.js";
type Connection = { provider: string; config: Readonly<Record<string, unknown>> };
export type BananaRoute = { kind: "native" | "chuangxiang" | "secure-async"; auth: "bearer" | "google"; docs: string; maxInputs: number; model: string; sizes: string[]; ratios: string[]; asyncTextGeneration?: boolean; unavailableReason?: string; maxInputBytes?: number; inputLimitSource?: "adapter"; weaiGroup?: "adobe" | "aistudio"; pdog?: true; chentu?: true; synora?: true; tk1688?: true; monster?: true; mikoto?: true; defaultSize?: string; thinking?: { values: string[]; default: string } };
export const GEMINI_NANO_BANANA_21_MODEL = "gemini-nano-banana-2.1";
export const CHENTU_GEMINI_PENDING_PROTOCOL_REASON = "尚无已验证的画布生成协议";
const CHENTU_MISSING_PROTOCOL_REASONS = new Set([CHENTU_GEMINI_PENDING_PROTOCOL_REASON,
  "当前分组没有匹配的调用协议，请选择对应的图片或视频分组", "尚未验证该模型的画布调用协议"]);
const RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const EXTENDED_RATIOS = [...RATIOS, "1:8", "8:1", "1:4", "4:1"];
const SECURE_NANO_21_GROUPS = new Set(["banana-全系列", "banana-pro统一价格"]);
const WEAI_HOSTS = new Set(["us-la.we-token.cc", "asian-acc.we-token.cc", "sub2api.we-token.cc"]);
const WEAI_BASE_MODELS = new Set(["gemini-3-pro-image", "gemini-3.1-flash-image"]);
const WEAI_LEGACY_UNAVAILABLE = "此模型虽在分组列表中，但供应商香蕉接口仅声明支持 gemini-3-pro-image 和 gemini-3.1-flash-image；请选已支持的型号";
const PDOG_DOCUMENTED_MODELS = new Set(["gemini-3-pro-image", "gemini-3.1-flash-image-preview"]);
const CHENTU_PREVIOUSLY_SUPPORTED_MODELS = new Set([GEMINI_NANO_BANANA_21_MODEL]);
const chentuNativeModel = (model: string) => model === GEMINI_NANO_BANANA_21_MODEL || /^gemini-[\d.]+-(?:pro|flash)-image(?:-preview)?$/u.test(model);
const imageModel = (id: string) => id === GEMINI_NANO_BANANA_21_MODEL || /^(?:gemini-[\w.-]*image[\w.-]*|(?:N )?nano-banana[\w.-]*)$/iu.test(id);

/** The current Key inventory grants exact IDs; a public example is not an exclusive whitelist. */
function inventoryModelUnavailable(config: Connection["config"], model: string, supplier: string, documented: ReadonlySet<string>): string | undefined {
  if (["empty", "unauthorized"].includes(String(config.modelScanStatus))) return `当前 ${supplier} Key 未返回可用模型，请重新核对分组权限`;
  if (Array.isArray(config.unavailableModels) && config.unavailableModels.some(value =>
    value === model || !!value && typeof value === "object" && value.id === model))
    return `当前 ${supplier} 分组已记录此完整型号不可用，请重新核对 Key 权限`;
  if (Array.isArray(config.scannedModelIds)) {
    if (!config.scannedModelIds.includes(model)) return `当前 ${supplier} Key 的模型目录未返回此完整型号`;
  } else if (!documented.has(model)) return `请先读取当前 ${supplier} Key 的模型目录，确认此完整型号的分组权限`;
}

/** Supplier documentation is scoped by origin and model; GPT never enters this path. */
export function bananaImageRoute(connection: Connection, model: string): BananaRoute | undefined {
  if ((!["openai", "weai", "rest"].includes(connection.provider)) || !imageModel(model) || connection.config.usage === "agent" ||
      connection.config.usage === "disabled" || connection.config.supplierArchived === true) return;
  let url: URL;
  try { url = new URL(String(connection.config.baseUrl ?? "")); } catch { return; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash ||
      !/^\/(?:v1(?:beta)?\/?)?$/u.test(url.pathname)) return;
  const group = String(connection.config.accountKeyGroup ?? connection.config.modelGroup);
  if (connection.provider === "weai" && (!WEAI_HOSTS.has(url.hostname) || !["adobe香蕉", "aistudio香蕉"].includes(group))) return;
  // Chentu converts all-native live groups into a REST preset. The same exact
  // contract must survive that conversion and the later documentation refresh.
  if (connection.provider === "rest" && url.hostname !== "synoralink.com" && !(url.hostname === "api.tk1688.com" && model === GEMINI_NANO_BANANA_21_MODEL) && (url.hostname !== "tu.988236.xyz" || !chentuNativeModel(model))) return;
  const native = (docs: string, auth: BananaRoute["auth"] = "bearer", maxInputs = 14): BananaRoute => ({
    kind: "native", auth, docs, maxInputs, model,
    ratios: /^gemini-3\.1-flash-image/iu.test(model) ? EXTENDED_RATIOS : RATIOS,
    sizes: /^gemini-2\.5-flash-image/iu.test(model) ? ["1K"] : ["1K", "2K", "4K"],
  });
  if (url.hostname === "api.mikoto.vip" && model === "nano-banana-2.1" &&
      (connection.config.accountKeyGroupId != null ? String(connection.config.accountKeyGroupId) === "28" : group === "gemini生图")) {
    const unavailableReason = inventoryModelUnavailable(connection.config, model, "Mikoto Gemini", new Set());
    return { kind: "native", auth: "google", docs: "https://api.mikoto.vip/gemini-image-guide.html", maxInputs: 14, inputLimitSource: "adapter",
      model, sizes: ["1K", "2K", "4K"], ratios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"], defaultSize: "4K", mikoto: true,
      ...(unavailableReason ? { unavailableReason } : {}) };
  }
  if (url.hostname === "api.eaheng.com" && (connection.config.accountKeyGroupId != null
      ? String(connection.config.accountKeyGroupId) === "11" : group === "C1-Gemini（香蕉生图）") &&
      ["gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview", GEMINI_NANO_BANANA_21_MODEL, "nano-banana-2.1"].includes(model)) {
    const unavailableReason = inventoryModelUnavailable(connection.config, model, "怪兽 C1", new Set());
    return { kind: "native", auth: "google", docs: "https://api.eaheng.com/v1beta/models", maxInputs: 14, inputLimitSource: "adapter",
      model, sizes: ["auto"], ratios: [], defaultSize: "auto", monster: true, ...(unavailableReason ? { unavailableReason } : {}) };
  }
  if (url.hostname === "api.tk1688.com" && group === "vip" && model === GEMINI_NANO_BANANA_21_MODEL) {
    const unavailableReason = inventoryModelUnavailable(connection.config, model, "词元 vip", new Set());
    return { kind: "native", auth: "google", docs: "https://tk1688.com/docs", maxInputs: 14, inputLimitSource: "adapter",
      model, sizes: ["auto"], ratios: [], defaultSize: "auto", tk1688: true, ...(unavailableReason ? { unavailableReason } : {}) };
  }
  if (url.hostname === "synoralink.com" && ["香蕉2专线", "香蕉pro专线", "香蕉官转"].includes(group)) {
    const ids: Record<string, ReadonlySet<string>> = {
      "香蕉2专线": new Set(["gemini-3.1-flash-image", "gemini-3.1-flash-image-preview", GEMINI_NANO_BANANA_21_MODEL]),
      "香蕉pro专线": new Set(["gemini-3-pro-image", "gemini-3-pro-image-preview"]),
      "香蕉官转": new Set(["gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"]),
    };
    const documented = ids[group]!;
    const unavailableReason = !documented.has(model) ? "当前 Synora 官方分组目录未声明此完整图片型号" : inventoryModelUnavailable(connection.config, model, "Synora", documented);
    return { kind: "native", auth: "bearer", docs: "https://synoralink.com/docs", maxInputs: 14, inputLimitSource: "adapter",
      model, sizes: ["auto"], ratios: [], defaultSize: "auto", synora: true, ...(unavailableReason ? { unavailableReason } : {}) };
  }
  // The exact alias is present in the live inventory, but neither supplier has
  // published tier-by-tier output evidence for it. Use the documented native
  // protocol and omit imageSize by default; explicit tiers remain model-dependent.
  if (url.hostname === "tu.988236.xyz" && chentuNativeModel(model)) {
    const unavailableReason = inventoryModelUnavailable(connection.config, model, "辰途", CHENTU_PREVIOUSLY_SUPPORTED_MODELS);
    return { ...native("https://tu.988236.xyz/docs/api-media.zh-CN.md", "google"), chentu: true, inputLimitSource: "adapter",
      ...(model === GEMINI_NANO_BANANA_21_MODEL ? { sizes: ["1K", "2K", "4K", "auto"] } : {}),
      ...(unavailableReason ? { unavailableReason } : {}) };
  }
  if (model === GEMINI_NANO_BANANA_21_MODEL && url.hostname === "api.frimodel.com")
    return { ...native("https://ai-doc.apifox.cn/9285585m0", "google"),
      sizes: ["1K", "2K", "4K", "auto"], inputLimitSource: "adapter" };
  if (url.hostname === "genimage.pro" && model.startsWith("gemini-"))
    return native("https://docs.newapi.ai/zh/docs/api/ai-model/images/gemini/geminirelayv1beta-383837589");
  if (url.hostname === "api.frimodel.com" && model.startsWith("gemini-"))
    return native("https://ai-doc.apifox.cn/9285585m0", "google");
  if (pdogImageOrigin(String(connection.config.baseUrl)) && model.startsWith("gemini-")) {
    const unavailableReason = inventoryModelUnavailable(connection.config, model, "PDog", PDOG_DOCUMENTED_MODELS);
    return { ...native(PDOG_GEMINI_DOCUMENTATION, "google"), pdog: true,
      ratios: [...RATIOS, "9:21"], inputLimitSource: "adapter",
      // New inventory aliases use the documented protocol without assuming their resolution tiers.
      ...(!PDOG_DOCUMENTED_MODELS.has(model) ? { sizes: ["1K", "2K", "4K", "auto"], defaultSize: "auto" } : {}),
      ...(unavailableReason ? { unavailableReason } : {}) };
  }
  if (url.hostname === "token.secure-skill.com")
    return { ...native("https://token.secure-skill.com/docs", "google", 16),
      // The deployed official DocsView-B-l46QTb.js explicitly adds these four
      // ratios for the exact 2.1 ID. Preserve every other saved group/model route.
      ratios: model === GEMINI_NANO_BANANA_21_MODEL &&
        SECURE_NANO_21_GROUPS.has(String(connection.config.accountKeyGroup ?? connection.config.modelGroup))
        ? EXTENDED_RATIOS : RATIOS,
      asyncTextGeneration: ["nano-banana-pro", "nano-banana-2", "nano-banana-2-lite", "gemini-3-pro-image-preview", "gemini-3.0-pro-image", "gemini-3.1-flash-image"].includes(model),
      sizes: /lite/iu.test(model) ? ["1K"] : ["1K", "2K", "4K"] };
  if (WEAI_HOSTS.has(url.hostname) && ["adobe香蕉", "aistudio香蕉"].includes(group)) {
    const aistudio = group === "aistudio香蕉";
    const alias = model.replace(/-preview$/u, "");
    const canonical = !aistudio && alias === "gemini-3.0-pro-image" ? "gemini-3-pro-image" : alias;
    const supported = WEAI_BASE_MODELS.has(canonical) || aistudio && model === GEMINI_NANO_BANANA_21_MODEL;
    const thinking = aistudio && supported ? canonical === "gemini-3-pro-image"
      ? { values: ["high"], default: "high" }
      : canonical === "gemini-3.1-flash-image" ? { values: ["minimal", "high"], default: "minimal" }
      : { values: ["minimal", "medium", "high"], default: "medium" } : undefined;
    return { ...native("https://docs.we-ai.cc/guides/gemini-banana-image.html"), model: canonical,
      sizes: ["1K", "2K", "4K"], defaultSize: aistudio ? "1K" : "2K", weaiGroup: aistudio ? "aistudio" : "adobe",
      ratios: !aistudio || model === GEMINI_NANO_BANANA_21_MODEL ? EXTENDED_RATIOS : RATIOS,
      ...(thinking ? { thinking } : {}),
      ...(!supported ? { unavailableReason: "当前 We-AI 分组未声明此完整型号的香蕉图片合同；请使用当前分组支持的型号" } : {}) };
  }
  if ((url.hostname === "we-token.cc" || url.hostname.endsWith(".we-token.cc")) &&
      ["adobe香蕉", "gemini香蕉"].includes(String(connection.config.modelGroup)) && model.startsWith("gemini-"))
    return { ...native("https://docs.we-ai.cc/guides/gemini-banana-image.html"), model: model.replace(/-preview$/u, ""), sizes: ["512", "1K", "2K", "4K"], ratios: EXTENDED_RATIOS, maxInputBytes: 20 * 1024 * 1024,
      ...(!/^gemini-(?:3-pro|3\.1-flash)-image(?:-preview)?$/u.test(model)
        ? { unavailableReason: "此模型虽在分组列表中，但供应商香蕉接口仅声明支持 gemini-3-pro-image 和 gemini-3.1-flash-image；请选已支持的型号" } : {}) };
  if (url.hostname === "vapi.chuangxiangai.asia" && connection.config.modelGroup === "生图") {
    const fixed = /-(1k|2k|4k)$/iu.exec(model)?.[1]?.toUpperCase();
    return { kind: "chuangxiang", auth: "bearer", docs: "https://vapi.chuangxiangai.asia/docs/image", maxInputs: 9, model, sizes: fixed ? [fixed] : ["1K", "2K", "4K"], ratios: RATIOS };
  }
}

/** Preserve remembered rejections for this exact We-AI group and its documented aliases. */
export function weAiBananaModelUnavailable(connection: Connection, model: string): boolean {
  if (connection.provider !== "weai") return false;
  const route = bananaImageRoute(connection, model);
  if (!route?.weaiGroup) return false;
  const configured = connection.config.unavailableModels;
  if (!Array.isArray(configured)) return false;
  return configured.some(value => {
    const id = typeof value === "string" ? value.trim() : value && typeof value === "object" &&
      typeof value.id === "string" ? value.id.trim() : undefined;
    if (!id) return false;
    if (id === model) return true;
    const rejected = bananaImageRoute(connection, id);
    return !!rejected && !rejected.unavailableReason && !route.unavailableReason && rejected.model === route.model;
  });
}

export function applyBananaImageCapabilities(connection: Connection, model: ModelDescriptor): ModelDescriptor {
  if (!modelSupportsGenerationMedia(model, "image")) return model;
  const route = bananaImageRoute(connection, model.id);
  const automaticOnly = route?.synora || route?.tk1688 || route?.monster;
  const repairLegacyAlias = route?.weaiGroup && !route.unavailableReason &&
    model.metadata?.canvasUnavailableReason === WEAI_LEGACY_UNAVAILABLE;
  const repairPdogLegacy = route?.pdog && !route.unavailableReason &&
    Array.isArray(connection.config.scannedModelIds) && connection.config.scannedModelIds.includes(model.id) &&
    model.metadata?.canvasUnavailableReason === PDOG_GEMINI_LEGACY_UNAVAILABLE;
  const repairChentuLegacy = route?.chentu && !route.unavailableReason &&
    Array.isArray(connection.config.scannedModelIds) && connection.config.scannedModelIds.includes(model.id) &&
    CHENTU_MISSING_PROTOCOL_REASONS.has(String(model.metadata?.canvasUnavailableReason));
  const repairSynoraLegacy = automaticOnly && !route?.unavailableReason && /协议|protocol|未验证|没有匹配/iu.test(String(model.metadata?.canvasUnavailableReason));
  if (!route || !model.operations.some(op => op.startsWith("image.")) && !repairLegacyAlias && !repairPdogLegacy && !repairChentuLegacy && !repairSynoraLegacy ||
    model.metadata?.canvasRunnable === false && !repairLegacyAlias && !repairPdogLegacy && !repairChentuLegacy && !repairSynoraLegacy) return model;
  if (route.unavailableReason) return { ...model, operations: [], capabilities: [], metadata: { ...model.metadata,
    canvasRunnable: false, canvasUnavailableReason: route.unavailableReason, documentationUrl: route.docs } };
  const limits = { ...model.limits, maxOutputImages: 1, supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"] };
  if (route.inputLimitSource === "adapter") delete limits.maxInputImages;
  else limits.maxInputImages = route.maxInputs;
  const metadata = { ...model.metadata };
  if (automaticOnly || route.mikoto) for (const key of ["imageOutputDimensions", "imageOutputReferenceDimensions", "imageNativeQualityParameter", "imageNativeQualityOptions", "imageFixedResolution", "imageResolutionProfiles", "image1KVerifiedAt", "image2KVerifiedAt", "image4KVerifiedAt"])
    delete metadata[key];
  if (repairLegacyAlias || repairPdogLegacy || repairChentuLegacy || repairSynoraLegacy) {
    metadata.canvasRunnable = true;
    delete metadata.canvasUnavailableReason;
    if (metadata.autoInterfaceStatus === "incomplete") delete metadata.autoInterfaceStatus;
    if (repairPdogLegacy || repairChentuLegacy) delete metadata.pendingLiveScan;
  }
  return { ...model, operations: ["image.generate", "image.edit"], capabilities: ["image.generate", "image.edit"], inputKinds: ["text", "image", "image[]"], outputKinds: ["image"], parameters: [
    { key: "aspect_ratio", label: "画面比例", control: "select", valueType: "string", default: "auto", options: [
      { value: "auto", label: "自动（提示词优先，其次参考图）" }, ...route.ratios.map(value => ({ value, label: value })),
    ] },
    { key: "image_size", label: "分辨率", control: "select", valueType: "string", default: route.defaultSize ?? route.sizes.at(-1)!, options: route.sizes.map(value => ({ value, label: value === "auto" ? "模型默认（不指定档位）" : value })),
      ...(automaticOnly ? { description: `${route.synora ? "Synora" : route.monster ? "怪兽 C1" : "词元 vip"} 自家文档与当前分组 Key 已声明原生 Gemini 接口，但未公布此型号的 K 档、逐比例像素、quality 或 thinking；当前保留供应商自动尺寸，以原图为准。` } : {}),
      ...(route.mikoto ? { description: "Mikoto 原生接口提供 1K / 2K / 4K；官网明确档位不是固定像素尺寸，比例和实际输出以原图为准。" } : {}),
      ...(model.id === GEMINI_NANO_BANANA_21_MODEL && !route.weaiGroup && !automaticOnly ? { description: "新型号已在当前目录发现，使用官方原生协议；默认不指定档位。1K/2K/4K 为官方标准参数，是否支持以此型号实际返回为准，尚未逐档付费实测。" } : {}) },
    ...(route.thinking ? [{ key: "thinking_level", label: "思考档位", control: "select" as const, valueType: "string" as const,
      default: route.thinking.default, options: route.thinking.values.map(value => ({ value, label: value })) }] : []),
    { key: "n", label: "生成张数", control: "number", valueType: "integer", default: 1, min: 1, max: 1 },
  ], limits,
  ...(model.id === GEMINI_NANO_BANANA_21_MODEL ? { description: "当前目录中的 Gemini Nano Banana 2.1；通过官方 generateContent 协议生图和参考图编辑。新别名尚未付费实测，分辨率与参考数量以供应商模型能力及实际返回为准。" } : {}),
  metadata: { ...metadata, protocol: route.kind === "native" ? "gemini-generate-content" : "chuangxiang-banana-images",
    ...(automaticOnly ? { canvasRunnable: true, imageNativeParameterContract: true, imageNativeResolutionOptions: true, imageNativeResolutionParameter: "image_size",
      imageSupportedResolutions: [], imageRequestResolutions: [], imageResolutionMode: "provider-decided", imagePixelBudgetPublished: false,
      imageOutputEncodingDeclared: false, imageInputFormatsSource: "adapter", resolutionVerification: "supplier-model-specific-values-not-published",
      contractCheckedAt: route.monster ? "2026-10-10T01:40:08.574Z" : route.tk1688 ? "2026-10-10T00:39:05.942Z" : "2026-10-10T00:36:47.747Z",
      ...(route.synora ? { imageContractDocumentSha256: "7b7f1bd22df5a7d896d9385d0b5416a3b0f2531072b47c085c2925f8e740fb9f" } : {}), imageContractParameterCoverage: "automatic-only-exact-key-id" } : {}),
    ...(route.mikoto ? { imageNativeParameterContract: true, imageNativeResolutionOptions: true, imageNativeResolutionParameter: "image_size",
      imageSupportedResolutions: ["1K", "2K", "4K"], imageRequestResolutions: ["1K", "2K", "4K"], imageResolutionMode: "native-variable-pixels",
      qualitySupport: "provider-decided", imagePixelBudgetPublished: false, imageOutputEncodingDeclared: false,
      imageInputFormatsSource: "adapter", imageParameterContractNote: "Mikoto 提供分辨率档位和比例，实际输出像素可能浮动；没有独立质量参数，也不保证固定宽高。",
      imageContractDocumentSha256: "c53dbbcb15d48cb76d6bc6dd3c55cffe85ea5280180227527887777fe96eef60",
      contractCheckedAt: "2026-10-10T01:53:13.439Z", imageContractParameterCoverage: "native-key-directory-and-supplier-gemini-guide",
      supportsImageEdit: true, fixedOutputCount: 1, supportVerification: "official-native-contract-and-key-inventory", resolutionVerification: "native-variable-pixels-not-generation-tested" } : {}),
    ...(route.pdog || route.chentu || model.id === GEMINI_NANO_BANANA_21_MODEL ? { supportsImageEdit: true, fixedOutputCount: 1,
      referenceEditEndpoint: "/v1beta/models/{model}:generateContent", supportVerification: route.pdog || route.chentu
        ? "official-native-contract-and-key-inventory" : "official-native-contract-and-live-inventory",
      resolutionVerification: automaticOnly ? "supplier-model-specific-values-not-published" : route.weaiGroup ? "official-model-group-contract-not-generation-tested" : "model-dependent-not-generation-tested" } : {}),
    ...(route.inputLimitSource ? { bananaInputLimitSource: route.inputLimitSource } : {}),
    documentationUrl: route.docs, bananaProtocolVersion: 1, parameterControlsUnavailable: false }, };
}

/** Translate old canvas controls before the generic GPT sizing path can discard the tier. */
export function normalizeBananaParameters(route: BananaRoute, input: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  if (route.mikoto) return { ...input, aspect_ratio: input.aspect_ratio ?? input.aspectRatio ?? "auto",
    image_size: input.image_size ?? input.imageSize ?? input.resolution ?? input.size_tier ?? input.size ?? route.defaultSize, n: input.n ?? 1 };
  if (route.synora || route.tk1688 || route.monster) return { ...input, aspect_ratio: input.aspect_ratio ?? input.aspectRatio ?? "auto",
    image_size: input.image_size ?? input.imageSize ?? input.resolution ?? input.size_tier ?? input.size ?? "auto", n: input.n ?? 1 };
  if (route.weaiGroup) {
    // Only the documented We-AI group contract owns these aliases/defaults.
    // Pixel dimensions and auto are not tiers; do not derive a tier or nearest ratio.
    const selectedTier = input.resolution ?? input.image_size ?? input.imageSize ?? input.size_tier ?? input.size;
    const tier = typeof selectedTier === "string" && (/^\d+x\d+$/iu.test(selectedTier) || selectedTier.toLowerCase() === "auto")
      ? route.defaultSize : selectedTier ?? route.defaultSize;
    const ratio = input.aspect_ratio ?? input.aspectRatio ?? "auto";
    const thinkingInput = input.thinking_level ?? input.thinkingLevel;
    const thinking = typeof thinkingInput === "string" ? thinkingInput.toLowerCase() : undefined;
    return { aspect_ratio: ratio, image_size: typeof tier === "string" ? tier.toUpperCase() : tier, n: input.n ?? 1,
      ...(thinking && route.thinking?.values.includes(thinking) ? { thinking_level: thinking } : {}) };
  }
  const dimensions = typeof input.size === "string" ? /^(\d+)x(\d+)$/iu.exec(input.size) : null;
  const pixels = dimensions ? Number(dimensions[1]) * Number(dimensions[2]) : 0;
  const legacyTier = dimensions ? (pixels > 6_400_000 ? "4K" : pixels > 1_600_000 ? "2K" : "1K") : undefined;
  const tier = input.image_size ?? input.imageSize ?? input.size_tier ?? (/^(?:512|[124]k)$/iu.test(String(input.size)) ? input.size : undefined) ??
    (route.kind === "chuangxiang" && /^[124]k$/iu.test(String(input.quality)) ? input.quality : undefined) ?? legacyTier ?? route.sizes.at(-1);
  let ratio = input.aspect_ratio ?? input.aspectRatio ?? (typeof input.size === "string" && /^\d+:\d+$/u.test(input.size) ? input.size : undefined);
  if (!ratio && dimensions) {
    const value = Number(dimensions[1]) / Number(dimensions[2]);
    ratio = route.ratios.reduce((best, candidate) => {
      const distance = (r: string) => Math.abs(Math.log(value / (Number(r.split(":")[0]) / Number(r.split(":")[1]))));
      return distance(candidate) < distance(best) ? candidate : best;
    });
  }
  if (typeof ratio === "string" && /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/u.test(ratio)) {
    const value = Number(ratio.split(":")[0]) / Number(ratio.split(":")[1]);
    if (Number.isFinite(value) && value > 0) ratio = route.ratios.reduce((best, candidate) => {
      const distance = (r: string) => Math.abs(Math.log(value / (Number(r.split(":")[0]) / Number(r.split(":")[1]))));
      return distance(candidate) < distance(best) ? candidate : best;
    });
  }
  return { aspect_ratio: ratio ?? "auto", image_size: typeof tier === "string" ? tier.toLowerCase() === "auto" ? "auto" : tier.toUpperCase() : tier, n: input.n ?? 1 };
}

export function bananaRequiresPublicAssets(provider: string, config: Readonly<Record<string, unknown>> | undefined, model?: string): boolean {
  return !!model && !!config && bananaImageRoute({ provider, config }, model)?.kind === "chuangxiang";
}
