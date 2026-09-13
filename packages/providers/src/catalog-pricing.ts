type Row = Record<string, unknown>;
const record = (v: unknown): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
const amount = (v: unknown): number | undefined => {
  if (typeof v !== "number" && (typeof v !== "string" || !v.trim()))
    return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const text = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 256) : undefined;
const display = (n: number) => String(Number(n.toPrecision(10)));

/** Preserve explicit labels; decode numeric prices only with their declared billing mode.
 * New API's documented units: ModelPrice is USD; token input is ModelRatio * $2/1M.
 * https://doc.newapi.pro/api/fei-public-info/
 */
export function catalogPriceLabel(
  value: unknown,
  options: { newApi?: boolean; multiplier?: number; currency?: string } = {},
): string | undefined {
  const row = record(value),
    pricing = record(row.pricing ?? row.billing);
  const explicit =
    text(
      row.price_label ?? row.priceLabel ?? pricing.label ?? pricing.priceLabel,
    ) ??
    (typeof row.price === "string" && amount(row.price) === undefined
      ? text(row.price)
      : undefined);
  if (explicit) return explicit;
  const multiplier = options.multiplier ?? 1;
  if (!Number.isFinite(multiplier) || multiplier < 0) return undefined;
  const currency =
    text(pricing.currency ?? row.currency ?? options.currency) ??
    (options.newApi ? "USD" : undefined);
  const symbol =
    currency === "CNY" || currency === "RMB"
      ? "¥"
      : currency === "USD"
        ? "$"
        : currency
          ? `${currency} `
          : "";
  const suffix = currency ? "" : "（币种未注明）";
  const money = (v: number) => `${symbol}${display(v * multiplier)}`;
  if (options.newApi && Number(row.quota_type) === 0) {
    const input = amount(row.model_ratio),
      completion = amount(row.completion_ratio);
    if (input !== undefined)
      return `输入 ${money(input * 2)}/1M${completion === undefined ? "" : ` · 输出 ${money(input * 2 * completion)}/1M`}${suffix}`;
  }
  const input = amount(
    pricing.inputPerMillion ??
      pricing.input_per_million ??
      row.input_price_per_million,
  );
  const output = amount(
    pricing.outputPerMillion ??
      pricing.output_per_million ??
      row.output_price_per_million,
  );
  if (input !== undefined || output !== undefined)
    return (
      [
        input === undefined ? "" : `输入 ${money(input)}/1M`,
        output === undefined ? "" : `输出 ${money(output)}/1M`,
      ]
        .filter(Boolean)
        .join(" · ") + suffix
    );
  const raw = amount(
    pricing.unitAmount ?? pricing.unit_price ?? row.model_price ?? row.price,
  );
  const unit = text(
    row.request_unit ?? pricing.unit ?? pricing.kind ?? row.billing_mode,
  )?.toLowerCase();
  const label =
    unit &&
    (
      {
        image: "张",
        "per-image": "张",
        second: "秒",
        "per-second": "秒",
        request: "请求",
        per_request: "请求",
        "per-request": "请求",
      } as Record<string, string>
    )[unit];
  if (
    raw !== undefined &&
    (label || (options.newApi && Number(row.quota_type) === 1))
  )
    return `${money(raw)}/${label ?? "请求"}${suffix}`;
  const tiers = Array.isArray(pricing.tiers) ? pricing.tiers : [];
  const tierLabels = tiers.flatMap((v) => {
    const tier = record(v),
      price = amount(tier.price);
    const name = text(tier.label ?? tier.id);
    return price !== undefined && name ? [`${name} ${money(price)}`] : [];
  });
  return tierLabels.length ? tierLabels.join(" · ") + suffix : undefined;
}
