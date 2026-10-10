import type { StructuredModelPricing } from "@super-canvas/providers";
import type { SupplierGroupDetails } from "@super-canvas/providers/supplier-group-details";

/** Complete request samples require equal controls, including absent controls.
 * Only defaults explicitly proven equivalent by that request's adapter may be
 * removed. A new catalog default must not silently broaden an old sample.
 */
export function measuredPriceScopeMatches(
  current: Readonly<Record<string, unknown>>,
  sampled: Readonly<Record<string, unknown>>,
  equivalentDefaults: Readonly<Record<string, unknown>> = {},
): boolean {
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
    return JSON.stringify(value) ?? "undefined";
  };
  const normalize = (values: Readonly<Record<string, unknown>>) => Object.fromEntries(Object.entries(values).filter(([key, value]) => {
    if (value === undefined || key === "prompt") return false;
    // UI-only linked-media facts: false means the same absent input as omission.
    if (["has_reference_image", "has_reference_video", "has_reference_audio"].includes(key) && value === false) return false;
    return !Object.hasOwn(equivalentDefaults, key) || stable(value) !== stable(equivalentDefaults[key]);
  }));
  return stable(normalize(current)) === stable(normalize(sampled));
}

/** Parse only explicit billing units. No recharge exchange rates or implied currency. */
export function pricingFromSupplierEvidence(
  label: string | undefined,
  details: SupplierGroupDetails | undefined,
  checkedAt: string,
  sourceUrl?: string,
): StructuredModelPricing | undefined {
  if (label) {
    const fixed =
      /(?:([¥￥$])\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(元|USD|CNY|RMB|美元))\s*[/／]\s*(张|次|请求|秒)/iu.exec(
        label,
      );
    const amount = fixed ? Number(fixed[2] ?? fixed[3]) : undefined;
    // Every fixed quote must be the entire label. Resolution, duration, quality
    // and material conditions must never become an unconditional flat rate.
    if (fixed && Number.isFinite(amount) && !/起|最低|量大|优惠|折|条件|充值|·/u.test(label) &&
      fixed[0].trim() === label.trim()) {
      return {
        kind: fixed[5] === "张" ? "per-image" : fixed[5] === "秒" ? "per-second" : "per-request",
        currency:
          fixed[1] === "$" || /USD|美元/iu.test(fixed[4] ?? "") ? "USD" : "CNY",
        unitAmount: amount,
        ...(fixed[5] === "秒" ? { billingUnit: "second" as const } : {}),
        checkedAt,
        sourceUrl,
        confidence: "exact",
      };
    }
  }
  if (details?.stale || !details?.imagePrices?.length) return undefined;
  return {
    kind: "tiered",
    currency: "credits",
    checkedAt,
    sourceUrl,
    confidence: "exact",
    tiers: details.imagePrices
      .filter(
        (price) =>
          !details.unsupportedResolutions?.includes(price.resolution) &&
          (!details.exclusiveResolutions ||
            details.supportedResolutions?.includes(price.resolution)),
      )
      .map((price) => ({
        id: price.resolution,
        label: `${price.resolution} · 后台额度/张`,
        dimension: "resolution",
        value: price.resolution,
        price: price.amount,
      })),
  };
}
