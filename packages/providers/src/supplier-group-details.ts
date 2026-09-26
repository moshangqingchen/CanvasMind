/** Display evidence from the supplier's group record, never executable configuration. */
export interface SupplierGroupDetails {
  source: "model-plaza" | "key-groups";
  description?: string;
  referencePrice?: string;
  supportedResolutions?: string[];
  unsupportedResolutions?: string[];
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
const referencePricePattern = /(?:[¥￥$]?\s*\d+(?:\.\d+)?\s*(?:元|分|毛|刀)?\s*(?:[/／]|一|每|1)\s*(?:张|次)|(?:\d+|一|每)\s*张\s*[¥￥$]?\s*\d|量大\s*\d+(?:\.\d+)?\s*(?:分|毛|元))/u;

function expandResolutionList(text: string): string {
  // Shared-unit lists are common in supplier descriptions. Do not interpret
  // decimal sizes such as 1.24K or a larger number such as 1124K as this list.
  return text.replace(/(?<![\d.])(?:124|1\s*[/／、,.，·]\s*2\s*[/／、,.，·]\s*4)\s*K(?![\w.])/giu, "1K/2K/4K");
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
  const details: SupplierGroupDetails = {
    source, ...(description ? { description } : {}), ...(referencePrice ? { referencePrice } : {}),
    ...(supported.size ? { supportedResolutions: tiers.filter(t => supported.has(t)) } : {}),
    ...(unsupported.size ? { unsupportedResolutions: tiers.filter(t => unsupported.has(t)) } : {}),
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
    details.unsupportedResolutions?.length ? `不支持 ${details.unsupportedResolutions.join(" / ")}` : ""].filter(Boolean).join("；");
}

export function supplierGroupPriceLabel(details?: SupplierGroupDetails): string {
  if (!details) return "";
  if (details.referencePrice) return `${details.referencePrice}（分组说明参考）`;
  const prices = details.imagePrices?.filter(p => !details.unsupportedResolutions?.includes(p.resolution) &&
    (!details.exclusiveResolutions || details.supportedResolutions?.includes(p.resolution)));
  return prices?.length ? `${prices.map(p => `${p.resolution} ${p.amount}`).join(" · ")}（分组后台额度/张）` : "";
}
