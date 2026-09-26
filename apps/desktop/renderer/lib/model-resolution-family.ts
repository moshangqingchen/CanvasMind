import type { ModelDescriptor } from "@super-canvas/providers";

export type ModelResolutionTier = "1K" | "2K" | "4K";
const tiers: ModelResolutionTier[] = ["1K", "2K", "4K"];

function fixedTier(model: ModelDescriptor | null | undefined) {
  if (!model?.operations.some((o) => o.startsWith("image."))) return undefined;
  const match = /^(.+)-(1k|2k|4k)$/iu.exec(model.id);
  return match
    ? {
        family: match[1]!.toLowerCase(),
        tier: match[2]!.toUpperCase() as ModelResolutionTier,
      }
    : undefined;
}

/** The caller supplies only the selected connection's model inventory. */
export function modelResolutionFamily(
  models: readonly ModelDescriptor[],
  selected: ModelDescriptor | null | undefined,
) {
  const current = fixedTier(selected);
  if (!current) return [];
  const siblings = models.filter((m) => {
    if (
      m.metadata?.canvasRunnable === false ||
      fixedTier(m)?.family !== current.family
    )
      return false;
    return ["modelGroup", "supplier", "protocol"].every(
      (key) =>
        !selected?.metadata?.[key] ||
        !m.metadata?.[key] ||
        selected.metadata[key] === m.metadata[key],
    );
  });
  if (new Set(siblings.map((m) => fixedTier(m)!.tier)).size < 2) return [];
  return tiers.map((tier) => ({
    tier,
    model: siblings.find((m) => fixedTier(m)?.tier === tier),
  }));
}

export function modelResolutionPrice(model: ModelDescriptor): string {
  if (
    typeof model.metadata?.priceLabel === "string" &&
    model.metadata.priceLabel.trim()
  )
    return model.metadata.priceLabel.trim();
  const p = model.pricing;
  if (
    p &&
    "unitAmount" in p &&
    typeof p.unitAmount === "number" &&
    Number.isFinite(p.unitAmount)
  ) {
    const unit = (
      { "per-image": "张", "per-request": "次", "per-second": "秒" } as Record<
        string,
        string
      >
    )[p.kind];
    if (unit)
      return `${p.currency === "CNY" ? "¥" : p.currency === "USD" ? "$" : p.currency + " "}${Number(p.unitAmount.toPrecision(6))}/${unit}`;
  }
  return "价格以渠道为准";
}

function ratio(value: unknown): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*[:x]\s*(\d+(?:\.\d+)?)$/iu.exec(
    String(value ?? ""),
  );
  return m && Number(m[1]) > 0 && Number(m[2]) > 0
    ? Number(m[1]) / Number(m[2])
    : undefined;
}

/** Return only size/shape overrides; normal model switching supplies new defaults. */
export function parametersForResolutionModelChange(
  current: ModelDescriptor | null | undefined,
  next: ModelDescriptor | null | undefined,
  parameters: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const from = fixedTier(current),
    to = fixedTier(next);
  if (!from || !to || from.family !== to.family || !next) return undefined;
  const shapeKeys = ["aspect_ratio", "aspectRatio", "ratio"];
  const source =
    parameters.size ??
    shapeKeys.map((k) => parameters[k]).find((v) => v !== undefined);
  const shape = ratio(source);
  const size = next.parameters?.find((p) => p.key === "size");
  const aspect = next.parameters?.find((p) => shapeKeys.includes(p.key));
  const target = size ?? aspect;
  const options = target?.options ?? [];
  const auto = source === undefined || source === "auto";
  if (auto && options.some((o) => o.value === "auto")) {
    return {
      [target!.key]: "auto",
      ...(size?.control === "dimensions" ? { size_tier: to.tier } : {}),
    };
  }
  if (!shape) return {};
  const concrete = options.filter((o) => ratio(o.value) !== undefined);
  const closest = concrete.reduce<(typeof concrete)[number] | undefined>(
    (best, option) =>
      !best ||
      Math.abs(Math.log(ratio(option.value)! / shape)) <
        Math.abs(Math.log(ratio(best.value)! / shape))
        ? option
        : best,
    undefined,
  );
  return closest && target
    ? {
        [target.key]: closest.value,
        ...(size?.control === "dimensions" ? { size_tier: to.tier } : {}),
      }
    : {};
}
