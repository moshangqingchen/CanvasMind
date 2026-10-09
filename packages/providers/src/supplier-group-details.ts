/** Display evidence from the supplier's group record, never executable configuration. */
export interface SupplierGroupDetails {
  source: "model-plaza" | "key-groups";
  description?: string;
  referencePrice?: string;
  supportedResolutions?: string[];
  unsupportedResolutions?: string[];
  nativeResolutions?: string[];
  upscaledResolutions?: string[];
  exclusiveResolutions?: boolean;
  imagePrices?: Array<{ resolution: string; amount: number }>;
  rateMultiplier?: number;
  imageRateMultiplier?: number;
  concurrencyLimit?: number;
  rpmLimit?: number;
  stale?: boolean;
}
const tiers = ["1K", "2K", "4K"];
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const referencePricePattern = /(?:[¥￥$]?\s*\d+(?:\.\d+)?\s*(?:元|分|毛|刀)?\s*(?:[/／]|一|每|1)\s*(?:张|次|请求|秒|s(?:ec(?:ond)?s?)?)(?![a-zA-Z])|(?:\d+|一|每)\s*张\s*[¥￥$]?\s*\d|量大\s*\d+(?:\.\d+)?\s*(?:分|毛|元))/iu;
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** A base model ID must never match a different model with an added suffix. */
export function supplierTextMentionsModel(text: string, modelId: string): boolean {
  return Boolean(modelId) && new RegExp(`(?<![\\w.-])${escapePattern(modelId)}(?![\\w.-])`, "iu").test(text);
}

function expandResolutionList(text: string): string {
  // Shared-unit lists are common in supplier descriptions. Do not interpret
  // decimal sizes such as 1.24K or a larger number such as 1124K as this list.
  return text.replace(/(?<![\d.])(?:124|1\s*[/／、,.，·]\s*2\s*[/／、,.，·]\s*4)\s*K(?![\w.])/giu, "1K/2K/4K");
}

/** Output pixel dimensions and the supplier's native/upscaled declaration are separate facts. */
function resolutionOrigins(text: string): Map<string, "native" | "upscaled"> {
  const origins = new Map<string, "native" | "upscaled">();
  const conflicts = new Set<string>();
  for (const clause of expandResolutionList(text).split(/[，,。;；\n]/u)) {
    if (/不支持|不提供|非原生|not\s+native/iu.test(clause)) continue;
    const native = /原生|\bnative\b/iu.test(clause);
    const upscaled = /超分|放大|\bupscal(?:e|ed|ing)\b/iu.test(clause);
    if (native === upscaled) continue;
    for (const match of clause.toUpperCase().matchAll(/(?<![\d.])([124])\s*K/gu)) {
      const tier = `${match[1]}K`, origin = native ? "native" : "upscaled";
      if (conflicts.has(tier)) continue;
      if (origins.has(tier) && origins.get(tier) !== origin) { origins.delete(tier); conflicts.add(tier); }
      else origins.set(tier, origin);
    }
  }
  return origins;
}

export function parseSupplierGroupDetails(row: Record<string, unknown>, source: SupplierGroupDetails["source"]): SupplierGroupDetails | undefined {
  const description = typeof (row.description ?? row.desc) === "string" ? String(row.description ?? row.desc).trim().slice(0, 8000) : "";
  const name = typeof row.name === "string" ? row.name : "";
  const supported = new Set<string>(), unsupported = new Set<string>();
  let exclusive = false;
  // Clause boundaries keep “仅支持1K2K，不支持4K” from granting 4K.
  for (const clause of expandResolutionList(`${name}。${description}`).split(/[，,。;；\n]/u)) {
    const found = [...clause.toUpperCase().matchAll(/(?<![\d.])([124])\s*K/gu)].map(match => `${match[1]}K`);
    if (!found.length) continue;
    // A bare list, including one following a per-image price, is a declaration.
    // A tier preceding a price (e.g. "4K 0.06/张") remains only price evidence.
    const list = /(?:^|\s)[124]\s*K(?:\s*[/／、]\s*[124]\s*K)*\s*$/iu.exec(clause);
    const prefix = list ? clause.slice(0, list.index).trim() : "";
    const plainList = Boolean(list && (!prefix || referencePricePattern.test(prefix)));
    if (/不支持|暂不|不提供|不可用|不含|不兼容|unsupported|not\s+support/iu.test(clause)) found.forEach(t => unsupported.add(t));
    else if (/支持|可用|原生|满血|仅|only|support/iu.test(clause) || clause === expandResolutionList(name) || plainList) {
      found.forEach(t => supported.add(t));
      if (/仅(?:支持|限)?|只支持|only/iu.test(clause)) exclusive = true;
    }
  }
  for (const tier of unsupported) supported.delete(tier);
  // Preserve conditions and wording, never infer currency or recharge conversions.
  const referencePrice = description.split(/[，,。;；\n]/u).filter(clause =>
    !/充值|实付|汇率|兑换/iu.test(clause) &&
    referencePricePattern.test(clause),
  ).map(s => s.trim()).join("；").slice(0, 256);
  const imagePrices = tiers.flatMap(resolution => {
    const amount = number(row[`image_price_${resolution.toLowerCase()}`]);
    return amount === undefined ? [] : [{ resolution, amount }];
  });
  const rateMultiplier = number(row.rate_multiplier ?? row.ratio);
  const imageRateMultiplier = row.image_rate_independent === true ? number(row.image_rate_multiplier) : undefined;
  const concurrency = /(?:最大并发|并发上限|并发限制)\s*[:：]?\s*(\d+)/u.exec(description);
  const concurrencyLimit = number(row.concurrency_limit ?? row.max_concurrency) ?? (concurrency ? Number(concurrency[1]) : undefined);
  const rpmLimit = number(row.rpm_limit);
  const origins = resolutionOrigins(name);
  for (const [tier, origin] of resolutionOrigins(description)) origins.set(tier, origin);
  const nativeResolutions = tiers.filter(tier => origins.get(tier) === "native" && !unsupported.has(tier));
  const upscaledResolutions = tiers.filter(tier => origins.get(tier) === "upscaled" && !unsupported.has(tier));
  const details: SupplierGroupDetails = {
    source, ...(description ? { description } : {}), ...(referencePrice ? { referencePrice } : {}),
    ...(supported.size ? { supportedResolutions: tiers.filter(t => supported.has(t)) } : {}),
    ...(unsupported.size ? { unsupportedResolutions: tiers.filter(t => unsupported.has(t)) } : {}),
    ...(nativeResolutions.length ? { nativeResolutions } : {}),
    ...(upscaledResolutions.length ? { upscaledResolutions } : {}),
    ...(exclusive && supported.size ? { exclusiveResolutions: true } : {}),
    ...(imagePrices.length ? { imagePrices } : {}),
    ...(rateMultiplier !== undefined ? { rateMultiplier } : {}),
    ...(imageRateMultiplier !== undefined ? { imageRateMultiplier } : {}),
    ...(concurrencyLimit !== undefined && concurrencyLimit > 0 ? { concurrencyLimit } : {}),
    ...(rpmLimit !== undefined && rpmLimit > 0 ? { rpmLimit } : {}),
  };
  return Object.keys(details).length > 1 ? details : undefined;
}

export function supplierGroupResolutionLabel(details?: SupplierGroupDetails): string {
  if (!details) return "";
  return [details.supportedResolutions?.length ? `${details.exclusiveResolutions ? "仅支持" : "说明支持"} ${details.supportedResolutions.join(" / ")}` : "",
    details.unsupportedResolutions?.length ? `不支持 ${details.unsupportedResolutions.join(" / ")}` : "",
    details.nativeResolutions?.length ? `说明原生 ${details.nativeResolutions.join(" / ")}` : "",
    details.upscaledResolutions?.length ? `说明超分 ${details.upscaledResolutions.join(" / ")}` : ""].filter(Boolean).join("；");
}

/** Scope textual image prices before using a group's shared resolution amounts. */
export function supplierGroupModelPriceDetails(details: SupplierGroupDetails | undefined, modelId: string, knownModelIds: readonly string[] = []): SupplierGroupDetails | undefined {
  if (!details?.description) return details;
  const canonicalImageId = (value: string) => /^(?:gpt[- ]?)?image[- ]?2(?:\.0|\.5)?(?:[- ]|$)/iu.test(value)
    ? value.toLowerCase().replace(/^gpt[- ]?/u, "").replace(/^image[- ]?/u, "gpt-image-")
      .replace(/2\.0(?=$|[- ])/u, "2").replace(/ +/gu, "-").replace(/-sub(?=$|-)/u, "-sunburst")
    : value.toLowerCase();
  const selected = canonicalImageId(modelId);
  const exactIds = [...new Set([modelId, ...knownModelIds])].filter(id => id.trim()).sort((a, b) => b.length - a.length);
  const exactPattern = new RegExp(`(?<![\\w.-])(?:${exactIds.map(escapePattern).join("|")})(?![\\w.-])`, "giu");
  const labels: string[] = [];
  let scoped = false;
  const clauses: string[] = [];
  for (const part of details.description.split(/[，,。;；\n]/u)) {
    const previous = clauses.at(-1);
    // Some sites put an exact ID after the amount: “香蕉2：0.07/张, ID：gemini-...”.
    // Keep this explicit association before separating model-specific prices.
    if (previous && /^(?:模型\s*)?ID\s*[:：]/iu.test(part.trim()) && referencePricePattern.test(previous)
      && exactIds.some(id => supplierTextMentionsModel(part, id))
      && !exactIds.some(id => supplierTextMentionsModel(previous, id))) clauses[clauses.length - 1] = `${previous}，${part.trim()}`;
    else clauses.push(part);
  }
  for (const clause of clauses) {
    if (/充值|实付|汇率|兑换/iu.test(clause) || !referencePricePattern.test(clause)) continue;
    const candidates = [...clause.matchAll(exactPattern),
      ...clause.matchAll(/\b(?:gpt[- ]?)?image[- ]?2(?:\.5|\.0)?(?:-[a-z0-9]+(?:-[a-z0-9]+)*| +[a-z][a-z0-9]*(?:-[a-z0-9]+)*)?(?![\w.-])/giu)]
      .sort((a, b) => a.index - b.index || b[0].length - a[0].length);
    const mentions = candidates.filter((mention, index) => !candidates.slice(0, index).some(previous =>
      previous.index <= mention.index && previous.index + previous[0].length > mention.index));
    if (!mentions.length) { labels.push(clause.trim()); continue; }
    scoped = true;
    // Separate same-line model quotes only when each segment has its own price.
    // A shared quote keeps the full wording and every named model in scope.
    const segments = mentions.map((mention, index) => clause.slice(mention.index, mentions[index + 1]?.index).trim());
    if (segments.every(segment => referencePricePattern.test(segment))) {
      mentions.forEach((mention, index) => {
        if (canonicalImageId(mention[0]) === selected) labels.push(segments[index]!);
      });
    } else if (mentions.some(mention => canonicalImageId(mention[0]) === selected)) labels.push(clause.trim().replace(/，\s*(?:模型\s*)?ID\s*[:：].*$/iu, ""));
  }
  if (!scoped) return details;
  // Shared image_price_* fields cannot distinguish the models priced above.
  // Keep unspecified currency/quality conditions in the supplier's wording.
  const result = { ...details };
  delete result.referencePrice;
  delete result.imagePrices;
  const referencePrice = labels.join("；").slice(0, 1000);
  if (referencePrice) result.referencePrice = referencePrice;
  return result;
}

/** Mixed groups can publish an image quote and a separate video quote. Keep
 * their original units and wording; a generic image rate never prices video. */
export function supplierGroupMediaPriceDetails(details: SupplierGroupDetails | undefined, kind: "image" | "video", modelId: string): SupplierGroupDetails | undefined {
  if (!details) return undefined;
  const labels = (details.referencePrice ?? "").split("；").filter(label => {
    const seconds = /(?:[/／]|每)\s*(?:秒|s(?:ec(?:ond)?s?)?)(?![a-zA-Z])/iu.test(label);
    const video = /视频|\bvideo\b/iu.test(label);
    return kind === "image" ? !seconds && !video : video || supplierTextMentionsModel(label, modelId);
  });
  if (labels.join("；") === (details.referencePrice ?? "") && (kind === "image" || !details.imagePrices)) return details;
  const result = { ...details };
  delete result.referencePrice;
  if (kind === "video") delete result.imagePrices;
  if (labels.length) result.referencePrice = labels.join("；");
  return result;
}

export function supplierGroupPriceLabel(details?: SupplierGroupDetails): string {
  if (!details) return "";
  if (details.referencePrice) return `${details.referencePrice}（分组说明参考）`;
  const prices = details.imagePrices?.filter(p => !details.unsupportedResolutions?.includes(p.resolution) &&
    (!details.exclusiveResolutions || details.supportedResolutions?.includes(p.resolution)));
  return prices?.length ? `${prices.map(p => `${p.resolution} ${p.amount}`).join(" · ")}（分组后台额度/张）` : "";
}
