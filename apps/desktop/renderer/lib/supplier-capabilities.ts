import type {
  ImageCapabilityEvidence,
  ImageResolutionTier,
  SupplierRecord,
  SupplierVerificationCase,
  VerificationCharge,
} from "@super-canvas/db";
import type {
  ModelDescriptor,
} from "@super-canvas/providers";
import { modelPriceAmount } from "@super-canvas/providers/media-billing";
import { IMAGE_SIZE_RATIOS, imageSizeForTier, imageSizeOptions } from "@super-canvas/providers/image-size-presets";
import { parseSupplierGroupDetails } from "@super-canvas/providers/supplier-group-details";
import { withHighestQualityDefault } from "./model-quality";
import { imageQualityPresetsForHighest } from "@super-canvas/providers/image-quality-presets";

export const RESOLUTIONS: ImageResolutionTier[] = ["1K", "2K", "4K"];
export const EVIDENCE_LABELS = {
  declared: "说明支持",
  verified: "实测支持",
  inferred: "由 4K 推断",
  approximate: "近似档位",
  assumed: "默认假设",
  unsupported: "不支持",
  conflict: "需要核对",
} as const;
type Connection = {
  id: string;
  provider: string;
  config: Readonly<Record<string, unknown>>;
};
export interface EffectiveImageCapabilities {
  model: ModelDescriptor;
  evidence: ImageCapabilityEvidence[];
  tiers: Array<{
    tier: ImageResolutionTier;
    status: ImageCapabilityEvidence["status"];
    width?: number;
    height?: number;
  }>;
  probeTiers: ImageResolutionTier[];
  quality?: string;
  /**
   * Quality values advertised by the model adapter, in ascending order where
   * possible.  The verification worker stores these on a queued case so it
   * can continue with the next lower value after a no-charge failure without
   * having to perform another paid model-list request.
   */
  qualityOptions?: string[];
  qualityKey?: string;
  sizeKey?: string;
  sizeIsTier: boolean;
  ratioKey?: string;
  ratio: string;
  needsQualityProbe: boolean;
  reason?: string;
}

export function classifyActualResolution(
  width: number,
  height: number,
  expectedWidth: number,
  expectedHeight: number,
  requestedTier?: ImageResolutionTier,
): "verified" | "approximate" | "unsupported" {
  if (
    ![width, height, expectedWidth, expectedHeight].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    return "unsupported";
  if (Math.abs(width / height / (expectedWidth / expectedHeight) - 1) > 0.02)
    return "unsupported";
  if (width >= expectedWidth && height >= expectedHeight) return "verified";
  const tier = requestedTier ?? (Math.max(expectedWidth, expectedHeight) >= 3072 ? "4K"
    : Math.max(expectedWidth, expectedHeight) >= 1536 ? "2K" : "1K");
  // User's approximate-size policy: 1.5K long edge counts as 2K, 3K as 4K.
  // Keep the original pixel dimensions and never relax the ratio check.
  if (tier === "2K" || tier === "4K")
    return Math.max(width, height) >= (tier === "2K" ? 1536 : 3072) ? "approximate" : "unsupported";
  return width >= expectedWidth * 0.9 && height >= expectedHeight * 0.9 ? "approximate" : "unsupported";
}

/** Reinterpret existing pixel evidence without modifying or resubmitting it. */
export function currentResolutionEvidence(test: SupplierVerificationCase): SupplierVerificationCase {
  if (test.status !== "unsupported" || test.rejectedParameter !== "resolution") return test;
  const status = classifyActualResolution(test.actualWidth ?? 0, test.actualHeight ?? 0,
    test.expectedWidth, test.expectedHeight, test.resolution);
  return status === "unsupported" ? test : { ...test, status: "succeeded", rejectedParameter: undefined,
    approximate: status === "approximate", reason: `按当前近似档位规则计为 ${test.resolution}；实际 ${test.actualWidth}×${test.actualHeight}` };
}

/** Lower presets are inferred from the same request scope, never fabricated tests. */
export function inferred2KFrom4K(original: SupplierVerificationCase): ImageCapabilityEvidence | undefined {
  const test = currentResolutionEvidence(original);
  if (test.resolution !== "4K" || test.status !== "succeeded" || /(?:^|[-_])[124]k$/iu.test(test.modelId)) return undefined;
  return {
    id: `${test.connectionId}:${test.modelId}:2K`,
    supplierId: test.supplierId, sourceId: test.sourceId, connectionId: test.connectionId,
    group: test.group, modelId: test.modelId, operation: "image.generate", kind: "inference",
    checkedAt: test.updatedAt, fingerprint: test.fingerprint, status: "inferred", resolution: "2K",
    excerpt: `同一分组、Key、型号的 4K 已通过（实际 ${test.actualWidth}×${test.actualHeight}，请求 ${test.requestId}），据此开放 2K；未另行生成 2K 测试图。`,
  };
}

export function effectiveImageCapabilities(input: {
  supplier: SupplierRecord;
  connection: Connection;
  model: ModelDescriptor;
  fingerprint: string;
  tests?: readonly SupplierVerificationCase[];
  priorEvidence?: readonly ImageCapabilityEvidence[];
  documentation?: string;
}): EffectiveImageCapabilities {
  const { supplier, connection, model, fingerprint } = input;
  const group = String(connection.config.accountKeyGroup ?? connection.config.modelGroup ?? "默认群组");
  const tests = (input.tests ?? []).filter(test =>
    test.connectionId === connection.id && test.modelId === model.id &&
    test.fingerprint === fingerprint && !["cancelled", "superseded"].includes(test.status)).map(currentResolutionEvidence);
  const successfulParameters = tests.find(test => test.status === "succeeded")?.parameters;
  const catalogGroup = supplier.catalog.groups.find(
    (item) => item.id === group,
  );
  const groupDetails = catalogGroup?.details?.stale
    ? undefined
    : catalogGroup?.details;
  const groupText = `${group}。${groupDetails?.description ?? ""}`;
  const parsed = parseSupplierGroupDetails(
    { name: group, description: [groupDetails?.description, model.metadata?.supplierChannelDescription].filter(Boolean).join("。") },
    "model-plaza",
  );
  const supported = new Set([
    ...(parsed?.supportedResolutions ?? []),
    ...(groupDetails?.supportedResolutions ?? []),
    ...(Array.isArray(model.metadata?.imageSupportedResolutions) ? model.metadata.imageSupportedResolutions.map(String) : []),
  ]);
  const denied = new Set([
    ...(parsed?.unsupportedResolutions ?? []),
    ...(groupDetails?.unsupportedResolutions ?? []),
    ...(Array.isArray(model.metadata?.imageUnsupportedResolutions) ? model.metadata.imageUnsupportedResolutions.map(String) : []),
  ]);
  const requestTiers = new Set(Array.isArray(model.metadata?.imageRequestResolutions) ? model.metadata.imageRequestResolutions.map(String) : []);
  const approximateTiers = new Set(Array.isArray(model.metadata?.imageApproximateResolutions) ? model.metadata.imageApproximateResolutions.map(String) : []);
  const namedTiers = RESOLUTIONS.filter(tier => new RegExp(`${tier[0]}\\s*k`, "iu").test(group));
  for (const tier of namedTiers) supported.add(tier);
  const exclusive =
    parsed?.exclusiveResolutions ||
    groupDetails?.exclusiveResolutions ||
    (namedTiers.length === 1 && namedTiers[0] === "1K");
  if (
    supported.has("4K") &&
    !denied.has("2K") &&
    !/(?:仅|只|only).*4\s*k/iu.test(groupText)
  )
    supported.add("2K");
  if (exclusive)
    for (const tier of RESOLUTIONS) if (!supported.has(tier)) denied.add(tier);
  const parameters = [...(model.parameters ?? [])];
  const nativeResolutionKey = typeof model.metadata?.imageNativeResolutionParameter === "string"
    ? model.metadata.imageNativeResolutionParameter : undefined;
  const providerDecidedResolution = model.metadata?.imageResolutionMode === "provider-decided";
  const resolutionQuality = parameters.find(p => /^(quality|image_quality|output_quality)$/u.test(p.key)
    && p.options?.length && p.options.every(option => /^[124]k$/iu.test(String(option.value))));
  const testedSizeKey = [nativeResolutionKey, "size", "resolution", "image_size", "imageSize"].find((key): key is string => key !== undefined &&
    typeof successfulParameters?.[key] === "string");
  const rawSize = parameters.find(p => nativeResolutionKey && p.key === nativeResolutionKey) ?? parameters.find((p) =>
    ["size", "resolution", "image_size", "imageSize"].includes(p.key),
  ) ?? resolutionQuality ?? (testedSizeKey ? {
    key: testedSizeKey, label: "分辨率", control: "select" as const,
    options: tests.filter(test => test.status === "succeeded").map(test => ({
      label: test.resolution, value: String(test.parameters[testedSizeKey]),
    })),
  } : undefined);
  const rawQuality = parameters.find((p) =>
    /^(quality|image_quality|output_quality)$/u.test(p.key) && p !== resolutionQuality,
  );
  const nativeQualityOptions = model.metadata?.imageNativeQualityOptions === true;
  const testedRatioKey = ["aspect_ratio", "aspectRatio", "ratio"].find(key => typeof successfulParameters?.[key] === "string");
  const rawRatio = parameters.find((p) =>
    /^(aspect_ratio|aspectRatio|ratio)$/u.test(p.key),
  ) ?? (testedRatioKey ? { key: testedRatioKey, label: "比例", control: "select" as const,
    default: "auto", options: [{ label: "自动（提示词优先，其次参考图）", value: "auto" }] } : undefined);
  const isOpenAiImage =
    /gpt-image|dall-e/iu.test(model.id) &&
    ["openai", "weai", "rest"].includes(connection.provider);
  const fixedTier = /(?:^|[-_])([124]k)$/iu
    .exec(model.id)?.[1]
    ?.toUpperCase() as ImageResolutionTier | undefined;
  const sizeIsTier = Boolean(
    rawSize?.options?.some((option) => /^[124]k$/iu.test(String(option.value))),
  );
  const sizeKey = providerDecidedResolution ? undefined : rawSize?.key ?? (isOpenAiImage ? "size" : undefined);
  const groupControlsQuality = /^https:\/\/token\.secure-skill\.com(?:\/|$)/iu.test(supplier.apiUrl) && model.id === "gpt-image-2";
  const fixedQualityDescription = /仅支持.*质量|只能.*质量|模型固定|固定.*质量/iu.test(rawQuality?.description ?? "");
  // B4 publishes high/max as separate priced model IDs. Its generic group
  // quality list must not replace the quality encoded by these exact SKUs.
  const monsterFixedQuality = /^https:\/\/api\.eaheng\.com(?:\/|$)/iu.test(supplier.apiUrl) &&
    group === "B4-GPT生图原生渠道V3（高质量）"
      ? /^gpt-image-2\.5-(?:flare|sunburst)-(high|max)$/u.exec(model.id)?.[1]
      : undefined;
  const fixedQualityValue = typeof model.metadata?.fixedQuality === "string" && model.metadata.fixedQuality.trim()
    ? model.metadata.fixedQuality.trim()
    : monsterFixedQuality ?? (fixedQualityDescription && rawQuality?.options?.length === 1
      ? String(rawQuality.options[0]!.value) : undefined);
  const fixedQuality = Boolean(fixedQualityValue) || groupControlsQuality || model.metadata?.qualitySupport === "provider-decided" ||
    (model.id === "gpt-image-2" && /^https:\/\/api\.mikoto\.vip(?:\/|$)/iu.test(supplier.apiUrl) &&
      ["生图（2k4k 高质量）", "生图（2k4k 中质量）"].includes(group)) ||
    fixedQualityDescription;
  const implicitQuality = isOpenAiImage && !/dall-e-2/iu.test(model.id) && !groupControlsQuality && !resolutionQuality &&
    model.metadata?.qualitySupport !== "provider-decided";
  const qualityKey =
    rawQuality?.key ?? (implicitQuality ? "quality" : undefined);
  const options = fixedQualityValue
    ? [rawQuality?.options?.find(option => option.value === fixedQualityValue) ?? { value: fixedQualityValue, label: fixedQualityValue }]
    : rawQuality?.options?.length
    ? rawQuality.options
    : implicitQuality
      ? [{ value: /dall-e-3/iu.test(model.id) ? "hd" : /^gpt-image-2\.5(?:-|$)/u.test(model.id) ? "max" : "high", label: "最高" }]
      : [];
  let quality = options.length
    ? String(
        withHighestQualityDefault({
          key: "quality",
          label: "质量",
          control: "select",
          options,
        }).default ?? options.at(-1)!.value,
      )
    : undefined;
  const doc = [input.documentation ?? model.description ?? "", rawSize?.description ?? ""].filter(Boolean).join("。 ");
  const documentUrl = typeof model.metadata?.documentationUrl === "string"
    ? model.metadata.documentationUrl
    : typeof model.metadata?.docsUrl === "string" ? model.metadata.docsUrl : supplier.siteUrl || supplier.apiUrl;
  const qualityText = [groupText, model.metadata?.supplierChannelDescription, doc].filter(Boolean).join("。");
  const declaredQualities = new Set<string>(), deniedQualities = new Set<string>();
  for (const clause of qualityText.split(/[。;；\n]/u)) {
    const values = [...clause.matchAll(/\b(max|xhigh|ultra|high|medium|low|hd|standard)\b/giu)].map(match => match[1]!.toLowerCase());
    if (/不支持|不接受|unsupported|not supported/iu.test(clause)) values.forEach(value => deniedQualities.add(value));
    else if (/支持|质量|品质|quality|support/iu.test(clause)) values.forEach(value => declaredQualities.add(value));
    // Mikoto describes Image 2 and both Image 2.5 models in one group. Its
    // model-specific five-level declaration also repairs old high-only caches.
    const image25Variant = /^gpt-image-2\.5(?:-(flare|sunburst))?$/u.exec(model.id);
    const declaredVariant = /\b(?:gpt[- ]?)?image[- ]?2\.5(?:[- ]+(flare|sunburst|sub))?\b/iu.exec(clause);
    if (!fixedQuality && image25Variant && declaredVariant &&
      (!declaredVariant[1] || (declaredVariant[1].toLowerCase() === "sub" ? "sunburst" : declaredVariant[1].toLowerCase()) === image25Variant[1]) &&
      /支持\s*(?:五|5)\s*档(?:质量|品质)/u.test(clause) && !/不支持|不接受/u.test(clause)) {
      for (const value of ["low", "medium", "high", "xhigh", "max"]) declaredQualities.add(value);
    }
  }
  if (fixedQualityValue)
    for (const value of declaredQualities) if (value !== fixedQualityValue) declaredQualities.delete(value);
  for (const value of deniedQualities) declaredQualities.delete(value);
  const qualityMention = fixedQualityValue ?? (declaredQualities.size ? String(withHighestQualityDefault({ key: "quality", label: "质量", control: "select",
    options: [...declaredQualities].map(value => ({ value, label: value })) }).default) : undefined) ??
    // A group's generic Chinese label is not a quality ceiling for Image 2.5.
    // Exact fixed-quality Image 2 channels retain their existing behavior.
    (!fixedQuality && /^gpt-image-2\.5(?:-|$)/u.test(model.id) ? undefined : /高质量/u.test(qualityText)
      ? "high"
      : /中质量/u.test(qualityText)
        ? "medium"
        : /低质量/u.test(qualityText)
          ? "low"
          : undefined);
  if (qualityMention) quality = qualityMention;
  // Existing exact-channel documentation and paid evidence retain their provenance.
  const legacyEvidence = Object.entries(model.metadata ?? {}).find(
    ([key, value]) =>
      /(?:VerificationSource|VerifiedAt|CapabilitiesSource|CapabilitySource)$/iu.test(
        key,
      ) && typeof value === "string",
  );
  const sizeDeclared = Boolean(
    legacyEvidence,
  );
  if (sizeDeclared)
    for (const option of rawSize?.options ?? []) {
      const tier = /\b([124])K\b/iu.exec(option.label)?.[0]?.toUpperCase();
      if (tier && !denied.has(tier) && !requestTiers.has(tier)) supported.add(tier);
    }
  const docParsed = parseSupplierGroupDetails(
    { description: doc },
    "model-plaza",
  );
  for (const tier of docParsed?.supportedResolutions ?? [])
    if (!exclusive && !denied.has(tier)) supported.add(tier);
  for (const tier of docParsed?.unsupportedResolutions ?? [])
    if (!supported.has(tier)) denied.add(tier);
  if (docParsed?.exclusiveResolutions) for (const tier of RESOLUTIONS)
    if (!docParsed.supportedResolutions?.includes(tier)) denied.add(tier);
  const prior = (input.priorEvidence ?? []).filter(
    (item) =>
      item.fingerprint === fingerprint &&
      item.connectionId === connection.id &&
      item.modelId === model.id &&
      item.kind === "documentation",
  );
  for (const entry of prior) {
    if (
      entry.resolution &&
      !supported.has(entry.resolution) &&
      !denied.has(entry.resolution) &&
      !exclusive &&
      entry.status === "declared"
    )
      supported.add(entry.resolution);
  }
  const ratioOptions =
    rawRatio?.options
      ?.map((o) => String(o.value))
      .filter((v) => /^\d+:\d+$/u.test(v)) ?? [];
  const sizeRatios = [
    ...new Set(
      rawSize?.options?.flatMap((o) => o.label.match(/\b\d+:\d+\b/u) ?? []) ??
        [],
    ),
  ];
  const ratios = ratioOptions.length ? ratioOptions : sizeRatios;
  const ratio = ratios.includes("16:9")
    ? "16:9"
    : (ratios[0] ?? (isOpenAiImage ? "16:9" : "1:1"));
  const evidence: ImageCapabilityEvidence[] = [];
  const tiers: EffectiveImageCapabilities["tiers"] = [];
  const inferred2K = tests.map(inferred2KFrom4K).find(Boolean);
  const adapterTiers = new Set((rawSize?.options ?? []).flatMap(option => {
    const tier = /\b([124]K)\b/iu.exec(`${option.value} ${option.label}`)?.[1]?.toUpperCase();
    return tier ? [tier] : [];
  }));
  // Unknown capability is not a 1K ceiling. Expose the same highest candidate
  // that onboarding will test, without claiming documentation or paid success.
  const pendingRequests = tests.filter(test =>
    ["queued", "submitting", "running", "archiving", "inconclusive", "needs_attention"].includes(test.status) ||
    (test.status === "unsupported" && test.rejectedParameter === "quality"));
  const pendingTiers = new Set(pendingRequests.map(test => test.resolution));
  const defaultProbeTier = sizeKey && !tests.length
    ? [...RESOLUTIONS].reverse().find(tier => !denied.has(tier) &&
      (!fixedTier || fixedTier === tier) && (!sizeIsTier || adapterTiers.has(tier)) &&
      !supported.has(tier))
    : undefined;
  for (const tier of RESOLUTIONS) {
    if (providerDecidedResolution) continue;
    const pending = [...pendingRequests].reverse().find(test => test.resolution === tier);
    const successful = tests.find(
      (test) => test.resolution === tier && test.status === "succeeded",
    );
    const rejected = tests.find(
      (test) =>
        test.resolution === tier &&
        (test.status === "unsupported" || test.rejectedParameter === "resolution") &&
        test.rejectedParameter !== "quality",
    );
    // A decoded response proves the request was accepted. For channels with
    // explicit request presets, an undersized result must not disable retries.
    const returnedBelowTier = Boolean(rejected
      && (rejected.actualWidth ?? 0) > 0 && (rejected.actualHeight ?? 0) > 0);
    const explicitlyDenied =
      denied.has(tier) || Boolean(fixedTier && fixedTier !== tier);
    const conflict = denied.has(tier) && supported.has(tier);
    const inferred = tier === "2K" && !successful && !rejected ? inferred2K : undefined;
    const provisional = tests.find(test => (test.provisional || test.resolutionMismatch) && test.resolution === tier);
    const status = fixedTier && fixedTier !== tier
      ? "unsupported"
      : successful
        ? successful.approximate ? "approximate" : "verified"
        : inferred
          ? "inferred"
        : conflict
          ? "conflict"
          : explicitlyDenied || (rejected && !returnedBelowTier)
            ? "unsupported"
            : approximateTiers.has(tier)
              ? "approximate"
            : supported.has(tier) || fixedTier === tier
              ? "declared"
              : (tier === "1K" && (!sizeIsTier || adapterTiers.has(tier))) || adapterTiers.has(tier) || requestTiers.has(tier) || pendingTiers.has(tier) || defaultProbeTier === tier || provisional || returnedBelowTier ? "assumed" : undefined;
    if (!status) continue;
    const fromDocumentation = Boolean(docParsed?.supportedResolutions?.includes(tier)
      && !parsed?.supportedResolutions?.includes(tier) && !groupDetails?.supportedResolutions?.includes(tier));
    evidence.push({
      id: `${connection.id}:${model.id}:${tier}`,
      supplierId: supplier.id,
      sourceId: supplier.state?.sourceId ?? "legacy",
      connectionId: connection.id,
      group,
      modelId: model.id,
      operation: "image.generate",
      kind:
        inferred ? "inference" : successful || rejected || pending
          ? "test"
          : fromDocumentation
            ? "documentation"
            : "group",
      sourceUrl: fromDocumentation
        ? documentUrl : supplier.siteUrl || supplier.apiUrl,
      checkedAt:
        successful?.updatedAt ?? inferred?.checkedAt ?? pending?.updatedAt ?? supplier.scannedAt ?? supplier.updatedAt,
      excerpt: successful
        ? `请求 ${successful.expectedWidth}×${successful.expectedHeight}，实际 ${successful.actualWidth}×${successful.actualHeight}；仅核验 ${successful.ratio}`
        : inferred ? inferred.excerpt
        : returnedBelowTier && rejected
          ? `请求 ${rejected.expectedWidth}×${rejected.expectedHeight}，实际 ${rejected.actualWidth}×${rejected.actualHeight}；当次未达到请求档位，仍可请求`
        : provisional ? (provisional.resolutionMismatch ? "请求已接受，但图片未达到请求尺寸或比例；保留请求档位与实际像素" : "供应商暂无可用账号，暂按最高请求档位开放，尚未实测通过")
        : requestTiers.has(tier)
          ? String(model.metadata?.imageCapabilityNote ?? "可请求档位，实际输出以返回尺寸为准").slice(0, 2000)
        : pending && ["inconclusive", "needs_attention"].includes(pending.status)
          ? `${tier} 待核验：请求 ${pending.requestId}，${pending.reason ?? "原请求结果待核对"}；保留原请求档位，尚未实测通过`
        : pendingTiers.has(tier) || defaultProbeTier === tier
          ? `${tier} 待核验：未见此档位的明确限制，按最高候选档位测试；尚未实测通过`
          : (fromDocumentation ? doc : groupText).slice(0, 2000),
      fingerprint,
      status,
      resolution: tier,
      actualWidth: successful?.actualWidth ?? provisional?.actualWidth,
      actualHeight: successful?.actualHeight ?? provisional?.actualHeight,
    });
    if (status !== "unsupported" && status !== "conflict")
      tiers.push({
        tier,
        status,
        width: successful?.actualWidth,
        height: successful?.actualHeight,
      });
  }
  const priorQuality = prior.find(
    (item) => item.quality && item.status === "declared",
  );
  if (!qualityMention && priorQuality?.quality) quality = priorQuality.quality;
  const legalQualities = [...tests].reverse().find(test => test.legalQualities?.length)?.legalQualities;
  const successfulQuality = [...tests].reverse().find(
    (test) => test.status === "succeeded" && test.quality && (!fixedQualityValue || test.quality === fixedQualityValue),
  );
  const testedQualities = [
    ...tests.filter(test => test.status === "succeeded" && test.quality).map(test => test.quality!),
    ...(Array.isArray(model.metadata?.imageTestedQualities) ? model.metadata.imageTestedQualities.map(String) : []),
  ];
  // Highest legal/default requests open the model's quality presets. Evidence
  // below still distinguishes a declaration/default from a successful request.
  const rejectedQualities = new Set([...deniedQualities, ...tests.filter(test => test.status === "unsupported" && test.rejectedParameter === "quality").map(test => test.quality)]);
  const qualityPresets = fixedQuality || nativeQualityOptions ? undefined : imageQualityPresetsForHighest(model.id, [
    ...testedQualities, ...(quality ? [quality] : []),
  ].filter(value => !rejectedQualities.has(value) && (!legalQualities || legalQualities.includes(value))));
  const declaredOptions = declaredQualities.size > 1 ? [...declaredQualities].map(value => ({ label: value, value })) : options;
  const qualityOptions = (fixedQualityValue || nativeQualityOptions ? options : qualityPresets ?? (legalQualities ? legalQualities.map(value => options.find(option => option.value === value) ?? { label: value, value }) : declaredOptions))
    .filter(option => !rejectedQualities.has(String(option.value)) && (!legalQualities || legalQualities.includes(String(option.value))));
  const needsQualityProbe = Boolean(
    qualityKey &&
    quality &&
    !qualityMention &&
    !legacyEvidence &&
    !successfulQuality &&
    !priorQuality,
  );
  if (successfulQuality) quality = successfulQuality.quality;
  if (qualityPresets) quality = qualityOptions.length ? String(qualityOptions.at(-1)!.value) : undefined;
  if (nativeQualityOptions) quality = qualityOptions.length
    ? String(withHighestQualityDefault({ key: "quality", label: "质量", control: "select", options: qualityOptions }).default) : undefined;
  if (quality && (rejectedQualities.has(quality) || (legalQualities && !legalQualities.includes(quality)))) {
    const remaining = qualityOptions;
    quality = remaining.length ? String(withHighestQualityDefault({ key: "quality", label: "质量", control: "select", options: remaining }).default) : undefined;
  }
  if (quality && qualityKey)
    evidence.push({
      id: `${connection.id}:${model.id}:quality`,
      supplierId: supplier.id,
      sourceId: supplier.state?.sourceId ?? "legacy",
      connectionId: connection.id,
      group,
      modelId: model.id,
      operation: "image.generate",
      kind: successfulQuality
        ? "test"
        : qualityMention && qualityText === doc
          ? "documentation"
          : "adapter",
      sourceUrl: qualityMention && qualityText === doc ? documentUrl : supplier.siteUrl || supplier.apiUrl,
      checkedAt:
        successfulQuality?.updatedAt ??
        supplier.scannedAt ??
        supplier.updatedAt,
      excerpt: successfulQuality
        ? `${successfulQuality.quality} 档请求已接受，画质差异未验证`
        : qualityMention
          ? qualityText.slice(0, 2000)
          : "适配器合法质量值，供应商支持情况待核验",
      fingerprint,
      status: successfulQuality
        ? "verified"
        : needsQualityProbe
          ? "assumed"
          : "declared",
      quality: successfulQuality?.quality ?? quality,
    });
  let reason: string | undefined;
  if (!model.operations.includes("image.generate"))
    reason = "当前型号仅支持编辑或非图片生成，自动测试不适用";
  else if (model.metadata?.canvasRunnable === false)
    reason = String(model.metadata.canvasUnavailableReason ?? "执行协议未配置");
  else if (providerDecidedResolution)
    reason = "供应商未定义可核验的 K 分辨率档位，保留原生画幅参数";
  else if (!sizeKey && !fixedTier)
    reason = "缺少可映射的分辨率参数，需要配置执行协议";
  else if (fixedQualityValue && !quality)
    reason = `固定质量 ${fixedQualityValue} 已被当前渠道明确拒绝，不能改用其他质量提交此型号`;
  const probeTiers: ImageResolutionTier[] = reason || tests.some(test => test.status !== "unsupported" || test.rejectedParameter === "quality")
    ? []
    : [...RESOLUTIONS].reverse().filter(
        (tier) =>
          (tier !== "1K" || !tiers.some(t => t.tier !== "1K")) &&
          !tiers.some((t) => t.tier === tier && t.status !== "assumed") &&
          !denied.has(tier) &&
          (!sizeIsTier || adapterTiers.has(tier)) &&
          !(fixedTier && fixedTier !== tier) &&
          !tests.some((test) => test.resolution === tier),
      );
  if (
    !probeTiers.length &&
    needsQualityProbe &&
    !reason &&
    tests.every(test => test.status === "unsupported" && test.rejectedParameter === "resolution") &&
    !tests.some((test) => test.quality === quality || test.provisional || test.status === "succeeded")
  ) {
    const choice = [...tiers].reverse().find(t => t.status !== "inferred");
    if (choice) probeTiers.push(choice.tier);
  }
  probeTiers.splice(1);
  const updated = parameters.filter(
    (p) => p.key !== sizeKey && p.key !== qualityKey && (!providerDecidedResolution || p !== rawSize),
  );
  if (sizeKey && tiers.length) {
    const sizeOptions = tiers.flatMap((item) => {
      const declaredOptions =
        rawSize?.options?.filter((o) =>
          new RegExp(`\\b${item.tier}\\b`, "iu").test(o.label),
        ) ?? [];
      const prefix = item.status === "approximate" ? "近似 " : "";
      if (sizeIsTier) {
        const declared = rawSize?.options?.find(option => String(option.value).toUpperCase() === item.tier);
        return [{ label: `${prefix}${item.tier}`, value: declared?.value ?? item.tier }];
      }
      const completeRatios = IMAGE_SIZE_RATIOS.every(ratio => declaredOptions.some(option => option.label.match(/\d+:\d+/u)?.[0] === ratio));
      if (completeRatios && declaredOptions.length && (item.status === "declared" || requestTiers.has(item.tier)))
        return declaredOptions;
      const verifiedCase = tests.find(
        (test) => test.resolution === item.tier && test.status === "succeeded",
      );
      const request =
        verifiedCase &&
        sizeKey &&
        typeof verifiedCase.parameters[sizeKey] === "string"
          ? String(verifiedCase.parameters[sizeKey])
          : imageSizeForTier(item.tier, ratio);
      if (!sizeIsTier) {
        // Every exposed tier offers every ratio, including declared/default
        // tiers. Preserve documented/tested pixels without fabricating evidence.
        const presets = imageSizeOptions([item.tier], rawSize?.max ?? 3840).slice(1);
        return presets.map((preset) => {
          const presetRatio = preset.label.match(/\d+:\d+/u)?.[0];
          const declared = declaredOptions.find(option => option.label.match(/\d+:\d+/u)?.[0] === presetRatio);
          const value = presetRatio === verifiedCase?.ratio ? request : declared?.value ?? preset.value;
          return {
            label: `${prefix}${item.tier} · ${presetRatio} · ${String(value).replace("x", " × ")}${item.status === "assumed" && (pendingTiers.has(item.tier) || defaultProbeTier === item.tier) ? "（待核验）" : ""}`,
            value,
          };
        });
      }
      return [
        {
          label: `${prefix}${item.tier} · ${ratio} · ${item.width ? `${item.width} × ${item.height}` : request.replace("x", " × ")}（${EVIDENCE_LABELS[item.status]}）`,
          value: sizeIsTier ? item.tier : request,
        },
      ];
    });
    const autoOption = rawSize?.options?.find(option => option.value === "auto");
    if (!sizeIsTier)
      sizeOptions.unshift(autoOption ?? { label: "自动（提示词优先，其次参考图）", value: "auto" });
    else if (nativeResolutionKey)
      sizeOptions.unshift(...(rawSize?.options ?? []).filter(option => !/^[124]k$/iu.test(String(option.value))));
    updated.unshift({
      ...rawSize,
      key: sizeKey,
      label: "分辨率",
      control: sizeIsTier ? "select" : "dimensions",
      valueType: "string",
      default: rawSize?.default ?? sizeOptions[0]?.value,
      options: sizeOptions,
      description: "可选档位开放全部比例预设和自动；自动比例优先提示词，其次参考图。实际图片尺寸与实测范围见核验记录。",
    });
  }
  if (rawRatio && tiers.length && (sizeIsTier || rawRatio.options?.some(option => /^\d+:\d+$/u.test(String(option.value))))) {
    const index = updated.findIndex(parameter => parameter.key === rawRatio.key);
    const expanded = {
      ...rawRatio,
      options: [
        rawRatio.options?.find(option => option.value === "auto") ?? { label: "自动（提示词优先，其次参考图）", value: "auto" },
        ...IMAGE_SIZE_RATIOS.map(value => rawRatio.options?.find(option => option.value === value) ?? { label: value, value }),
        ...(rawRatio.options ?? []).filter(option => option.value !== "auto" && !IMAGE_SIZE_RATIOS.some(ratio => ratio === option.value)),
      ],
    };
    if (index >= 0) updated[index] = expanded;
    else updated.push(expanded);
  }
  if (qualityKey && quality)
    updated.push({
      ...rawQuality,
      key: qualityKey,
      label: "质量",
      control: "select",
      default: quality,
      options: nativeQualityOptions ? qualityOptions : qualityMention && !qualityPresets && declaredQualities.size <= 1 &&
        !rejectedQualities.has(qualityMention) && (!legalQualities || legalQualities.includes(qualityMention))
        ? [
            {
              label:
                qualityMention === "high"
                  ? "高"
                  : qualityMention === "medium"
                    ? "中"
                    : qualityMention,
              value: qualityMention,
            },
          ]
        : (!qualityPresets && declaredQualities.size > 1 ? [...declaredQualities].map(value => ({ value, label: value })) : qualityOptions).filter(
            (option) =>
              (!legalQualities || legalQualities.includes(String(option.value))) && !tests.some(
                (test) =>
                  test.status === "unsupported" &&
                  test.rejectedParameter === "quality" &&
                  test.quality === option.value,
              ),
          ),
      description: qualityPresets ? "按最高合法档位开放同型号全部质量选项；其余选项未逐档实测。" : needsQualityProbe
        ? "最高合法请求值，等待供应商核验"
        : "按说明或实测选择最高可用质量",
    });
  return {
    model: {
      ...model,
      parameters: updated,
      metadata: {
        ...model.metadata,
        ...(fixedQualityValue ? { fixedQuality: fixedQualityValue } : {}),
        imageCapabilityEvidence: evidence,
        imageCapabilityPolicy: 2,
        qualitySupport: qualityKey
          ? needsQualityProbe
            ? "assumed"
            : "declared"
          : "provider-decided",
      },
    },
    evidence,
    tiers,
    probeTiers,
    quality,
    qualityOptions: (!fixedQualityValue && !rawQuality?.options?.length && implicitQuality
      ? (/dall-e-3/iu.test(model.id) ? ["standard", "hd"] : /^gpt-image-2\.5(?:-|$)/u.test(model.id) ? ["low", "medium", "high", "xhigh", "max"] : ["low", "medium", "high"])
      : qualityOptions.map(option => String(option.value))).filter(value => !rejectedQualities.has(value)),
    qualityKey,
    sizeKey,
    sizeIsTier,
    ratioKey: rawRatio?.key,
    ratio,
    needsQualityProbe,
    reason,
  };
}

export function verificationParameters(
  capabilities: EffectiveImageCapabilities,
  tier: ImageResolutionTier,
) {
  const descriptor = capabilities.model.parameters?.find(parameter => parameter.key === capabilities.sizeKey);
  const option = descriptor?.options?.find(option => capabilities.sizeIsTier
    ? String(option.value).toUpperCase() === tier
    : new RegExp(`\\b${tier}\\b`, "iu").test(option.label) && option.label.match(/\d+:\d+/u)?.[0] === capabilities.ratio);
  const selectedSize = option?.value ?? (capabilities.sizeIsTier ? tier : imageSizeForTier(tier, capabilities.ratio, descriptor?.max));
  const size = /^\d+x\d+$/u.test(String(selectedSize)) ? String(selectedSize) : imageSizeForTier(tier, capabilities.ratio);
  const [width, height] = size.split("x").map(Number);
  const parameters: Record<string, string | number | boolean> = { n: 1 };
  if (capabilities.sizeKey)
    parameters[capabilities.sizeKey] = selectedSize;
  if (capabilities.ratioKey)
    parameters[capabilities.ratioKey] = capabilities.ratio;
  if (capabilities.qualityKey && capabilities.quality)
    parameters[capabilities.qualityKey] = capabilities.quality;
  for (const parameter of capabilities.model.parameters ?? [])
    if (parameters[parameter.key] === undefined && parameter.required && parameter.default !== undefined &&
      ["string", "number", "boolean"].includes(typeof parameter.default) &&
      (parameter.visibleWhen ?? []).every(condition => condition.values.includes(parameters[condition.parameter]!)))
      parameters[parameter.key] = parameter.default;
  return { parameters, width: width!, height: height! };
}

export function declaredImageCharge(
  model: ModelDescriptor,
  tier: ImageResolutionTier,
  quality?: string,
  parameters: Readonly<Record<string, unknown>> = {},
): VerificationCharge | undefined {
  const pricing = model.pricing;
  if (
    !pricing ||
    !["per-image", "per-request", "tiered"].includes(pricing.kind) ||
    pricing.confidence !== "exact"
  )
    return undefined;
  const amount = modelPriceAmount(pricing, { ...parameters, resolution: tier, quality });
  return amount === undefined
    ? undefined
    : {
        amount,
        currency: pricing.currency,
        unit: pricing.kind === "per-request" || pricing.billingUnit === "request" ? "request" : "image",
        sourceUrl: pricing.sourceUrl,
        checkedAt: pricing.checkedAt,
      };
}

export function reconcileVerificationCharge(
  expected: VerificationCharge | undefined,
  actual: VerificationCharge | undefined,
  requestId: string,
  taskId?: string,
): "unknown" | "matched" | "mismatch" {
  if (
    !expected ||
    !actual ||
    !(
      actual.requestId === requestId ||
      Boolean(taskId && actual.taskId === taskId)
    ) ||
    actual.currency !== expected.currency ||
    actual.unit !== expected.unit
  )
    return "unknown";
  const precision =
    expected.precision ??
    Math.min(
      8,
      Math.max(2, String(expected.amount).split(".")[1]?.length ?? 0),
    );
  return Math.abs(expected.amount - actual.amount) <=
    0.5 * 10 ** -precision + Number.EPSILON
    ? "matched"
    : "mismatch";
}

/** Only explicit exclusions/conflicts block existing nodes. Unknown controls remain editable. */
export function imageCapabilityRequestError(
  model: ModelDescriptor,
  parameters: Record<string, unknown>,
): string | null {
  const entries = model.metadata?.imageCapabilityEvidence as
    ImageCapabilityEvidence[] | undefined;
  if (!Array.isArray(entries)) return null;
  const raw =
    parameters.resolution ??
    parameters.size ??
    parameters.image_size ??
    parameters.imageSize;
  let tier =
    typeof raw === "string" && /^[124]k$/iu.test(raw)
      ? raw.toUpperCase()
      : undefined;
  const pixels = typeof raw === "string" ? /^(\d+)[x×](\d+)$/u.exec(raw) : null;
  if (pixels) {
    const area = Number(pixels[1]) * Number(pixels[2]);
    tier = area > 5_000_000 ? "4K" : area > 1_600_000 ? "2K" : "1K";
  }
  const blocked = entries.find(
    (item) =>
      item.resolution === tier &&
      ["unsupported", "conflict"].includes(item.status),
  );
  return blocked
    ? `${tier} 在当前分组${blocked.status === "conflict" ? "的说明存在冲突，需要核对" : "不受支持"}，请重新选择分辨率。已有节点参数仍保留。`
    : null;
}
