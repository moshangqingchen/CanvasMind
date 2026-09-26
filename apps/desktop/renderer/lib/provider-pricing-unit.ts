export type ProviderPriceUnit = "second" | "request";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedUnit(value: unknown): ProviderPriceUnit | undefined {
  if (typeof value !== "string") return undefined;
  const unit = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, "_");
  if (["per_second", "second", "seconds"].includes(unit)) return "second";
  if (
    [
      "per_call",
      "per_request",
      "call",
      "request",
      "generation",
      "image",
    ].includes(unit)
  )
    return "request";
  return undefined;
}

/**
 * Reads the structured billing fields used by the supported pricing APIs,
 * then falls back to human-readable tags/descriptions for older catalogs.
 * The nested video unit is the most specific signal and must win over the
 * generic new-api `quota_type` field (fixed prices can still be per-second).
 */
export function providerPriceUnit(record: {
  billing_mode?: unknown;
  request_unit?: unknown;
  video_api?: unknown;
  tags?: unknown;
  description?: unknown;
}): ProviderPriceUnit | undefined {
  const videoApi = isRecord(record.video_api) ? record.video_api : undefined;
  const videoPricing =
    videoApi && isRecord(videoApi.pricing) ? videoApi.pricing : undefined;
  const explicit =
    normalizedUnit(videoPricing?.unit) ??
    normalizedUnit(record.billing_mode) ??
    normalizedUnit(record.request_unit);
  if (explicit) return explicit;

  const tagText = Array.isArray(record.tags)
    ? record.tags.filter((tag) => typeof tag === "string").join(" ")
    : typeof record.tags === "string"
      ? record.tags
      : "";
  const description =
    typeof record.description === "string" ? record.description : "";
  const hint = `${tagText} ${description}`;
  if (/按秒|每秒|per[\s_-]*second/iu.test(hint)) return "second";
  if (/按次|每次|per[\s_-]*(?:call|request)/iu.test(hint)) return "request";
  return undefined;
}
