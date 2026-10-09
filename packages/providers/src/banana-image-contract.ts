import type { ModelDescriptor } from "./contracts.js";
import { pdogImageOrigin, PDOG_GEMINI_DOCUMENTATION } from "./pdog-image-contract.js";
type Connection = { provider: string; config: Readonly<Record<string, unknown>> };
export type BananaRoute = { kind: "native" | "chuangxiang" | "secure-async"; auth: "bearer" | "google"; docs: string; maxInputs: number; model: string; sizes: string[]; ratios: string[]; asyncTextGeneration?: boolean; unavailableReason?: string; maxInputBytes?: number; inputLimitSource?: "adapter"; weaiGroup?: "adobe" | "aistudio"; defaultSize?: string; thinking?: { values: string[]; default: string } };
export const GEMINI_NANO_BANANA_21_MODEL = "gemini-nano-banana-2.1";
const RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const EXTENDED_RATIOS = [...RATIOS, "1:8", "8:1", "1:4", "4:1"];
const SECURE_NANO_21_GROUPS = new Set(["banana-全系列", "banana-pro统一价格"]);
const WEAI_HOSTS = new Set(["us-la.we-token.cc", "asian-acc.we-token.cc", "sub2api.we-token.cc"]);
const WEAI_BASE_MODELS = new Set(["gemini-3-pro-image", "gemini-3.1-flash-image"]);
const WEAI_LEGACY_UNAVAILABLE = "此模型虽在分组列表中，但供应商香蕉接口仅声明支持 gemini-3-pro-image 和 gemini-3.1-flash-image；请选已支持的型号";
const imageModel = (id: string) => id === GEMINI_NANO_BANANA_21_MODEL || /^(?:gemini-[\w.-]*image[\w.-]*|(?:N )?nano-banana[\w.-]*)$/iu.test(id);

/** Supplier documentation is scoped by origin and model; GPT never enters this path. */
export function bananaImageRoute(connection: Connection, model: string): BananaRoute | undefined {
  if ((!["openai", "weai"].includes(connection.provider) && !(connection.provider === "rest" && model === GEMINI_NANO_BANANA_21_MODEL)) || !imageModel(model) || connection.config.usage === "agent" ||
      connection.config.usage === "disabled" || connection.config.supplierArchived === true) return;
  let url: URL;
  try { url = new URL(String(connection.config.baseUrl ?? "")); } catch { return; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash ||
      !/^\/(?:v1(?:beta)?\/?)?$/u.test(url.pathname)) return;
  const group = String(connection.config.accountKeyGroup ?? connection.config.modelGroup);
  if (connection.provider === "weai" && (!WEAI_HOSTS.has(url.hostname) || !["adobe香蕉", "aistudio香蕉"].includes(group))) return;
  // Chentu converts all-native live groups into a REST preset. The same exact
  // contract must survive that conversion and the later documentation refresh.
  if (connection.provider === "rest" && url.hostname !== "tu.988236.xyz") return;
  const native = (docs: string, auth: BananaRoute["auth"] = "bearer", maxInputs = 14): BananaRoute => ({
    kind: "native", auth, docs, maxInputs, model,
    ratios: /^gemini-3\.1-flash-image/iu.test(model) ? EXTENDED_RATIOS : RATIOS,
    sizes: /^gemini-2\.5-flash-image/iu.test(model) ? ["1K"] : ["1K", "2K", "4K"],
  });
  // The exact alias is present in the live inventory, but neither supplier has
  // published tier-by-tier output evidence for it. Use the documented native
  // protocol and omit imageSize by default; explicit tiers remain model-dependent.
  if (model === GEMINI_NANO_BANANA_21_MODEL && ["tu.988236.xyz", "api.frimodel.com"].includes(url.hostname))
    return { ...native(url.hostname === "tu.988236.xyz"
      ? "https://tu.988236.xyz/docs/#gemini-image" : "https://ai-doc.apifox.cn/9285585m0", "google"),
      sizes: ["1K", "2K", "4K", "auto"], inputLimitSource: "adapter" };
  if (url.hostname === "genimage.pro" && model.startsWith("gemini-"))
    return native("https://docs.newapi.ai/zh/docs/api/ai-model/images/gemini/geminirelayv1beta-383837589");
  if (url.hostname === "api.frimodel.com" && model.startsWith("gemini-"))
    return native("https://ai-doc.apifox.cn/9285585m0", "google");
  if (pdogImageOrigin(String(connection.config.baseUrl)) && model.startsWith("gemini-"))
    return { ...native(PDOG_GEMINI_DOCUMENTATION, "google"), ratios: [...RATIOS, "9:21"], inputLimitSource: "adapter",
      ...(!["gemini-3-pro-image", "gemini-3.1-flash-image-preview"].includes(model)
        ? { unavailableReason: "PDog 香蕉文档仅声明 gemini-3-pro-image 和 gemini-3.1-flash-image-preview；请使用当前分组确认的型号" } : {}) };
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
  const route = bananaImageRoute(connection, model.id);
  const repairLegacyAlias = route?.weaiGroup && !route.unavailableReason &&
    model.metadata?.canvasUnavailableReason === WEAI_LEGACY_UNAVAILABLE;
  if (!route || !model.operations.some(op => op.startsWith("image.")) && !repairLegacyAlias ||
    model.metadata?.canvasRunnable === false && !repairLegacyAlias) return model;
  if (route.unavailableReason) return { ...model, operations: [], capabilities: [], metadata: { ...model.metadata,
    canvasRunnable: false, canvasUnavailableReason: route.unavailableReason, documentationUrl: route.docs } };
  const limits = { ...model.limits, maxOutputImages: 1, supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"] };
  if (route.inputLimitSource === "adapter") delete limits.maxInputImages;
  else limits.maxInputImages = route.maxInputs;
  const metadata = { ...model.metadata };
  if (repairLegacyAlias) {
    metadata.canvasRunnable = true;
    delete metadata.canvasUnavailableReason;
    if (metadata.autoInterfaceStatus === "incomplete") delete metadata.autoInterfaceStatus;
  }
  return { ...model, operations: ["image.generate", "image.edit"], capabilities: ["image.generate", "image.edit"], inputKinds: ["text", "image", "image[]"], outputKinds: ["image"], parameters: [
    { key: "aspect_ratio", label: "画面比例", control: "select", valueType: "string", default: "auto", options: [
      { value: "auto", label: "自动（提示词优先，其次参考图）" }, ...route.ratios.map(value => ({ value, label: value })),
    ] },
    { key: "image_size", label: "分辨率", control: "select", valueType: "string", default: route.defaultSize ?? route.sizes.at(-1)!, options: route.sizes.map(value => ({ value, label: value === "auto" ? "模型默认（不指定档位）" : value })),
      ...(model.id === GEMINI_NANO_BANANA_21_MODEL && !route.weaiGroup ? { description: "新型号已在当前目录发现，使用官方原生协议；默认不指定档位。1K/2K/4K 为官方标准参数，是否支持以此型号实际返回为准，尚未逐档付费实测。" } : {}) },
    ...(route.thinking ? [{ key: "thinking_level", label: "思考档位", control: "select" as const, valueType: "string" as const,
      default: route.thinking.default, options: route.thinking.values.map(value => ({ value, label: value })) }] : []),
    { key: "n", label: "生成张数", control: "number", valueType: "integer", default: 1, min: 1, max: 1 },
  ], limits,
  ...(model.id === GEMINI_NANO_BANANA_21_MODEL ? { description: "当前目录中的 Gemini Nano Banana 2.1；通过官方 generateContent 协议生图和参考图编辑。新别名尚未付费实测，分辨率与参考数量以供应商模型能力及实际返回为准。" } : {}),
  metadata: { ...metadata, protocol: route.kind === "native" ? "gemini-generate-content" : "chuangxiang-banana-images",
    ...(model.id === GEMINI_NANO_BANANA_21_MODEL ? { supportsImageEdit: true, fixedOutputCount: 1,
      referenceEditEndpoint: "/v1beta/models/{model}:generateContent", supportVerification: "official-native-contract-and-live-inventory",
      resolutionVerification: route.weaiGroup ? "official-model-group-contract-not-generation-tested" : "model-dependent-not-generation-tested" } : {}),
    ...(route.inputLimitSource ? { bananaInputLimitSource: route.inputLimitSource } : {}),
    documentationUrl: route.docs, bananaProtocolVersion: 1, parameterControlsUnavailable: false }, };
}

/** Translate old canvas controls before the generic GPT sizing path can discard the tier. */
export function normalizeBananaParameters(route: BananaRoute, input: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
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
