import type { StructuredModelPricing } from "@super-canvas/providers";
import type { SupplierGroupDetails } from "@super-canvas/providers/supplier-group-details";

/** Parse only explicit billing units. No recharge exchange rates or implied currency. */
export function pricingFromSupplierEvidence(
  label: string | undefined,
  details: SupplierGroupDetails | undefined,
  checkedAt: string,
  sourceUrl?: string,
): StructuredModelPricing | undefined {
  if (label) {
    const fixed =
      /(?:([¥￥$])\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(元|USD|CNY|RMB|美元))\s*[/／]\s*(张|次|请求)/iu.exec(
        label,
      );
    if (fixed && !/起|最低|量大|优惠|折|条件|充值|·/u.test(label)) {
      return {
        kind: fixed[5] === "张" ? "per-image" : "per-request",
        currency:
          fixed[1] === "$" || /USD|美元/iu.test(fixed[4] ?? "") ? "USD" : "CNY",
        unitAmount: Number(fixed[2] ?? fixed[3]),
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
