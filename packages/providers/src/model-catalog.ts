import type { ModelDescriptor, ProviderOperation } from "./contracts.js";

export interface ProviderCatalogGroup {
  id: string;
  label: string;
  modelIds: readonly string[];
}

export interface ProviderCatalogScan {
  models: ModelDescriptor[];
  groups: ProviderCatalogGroup[];
  checkedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 256): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result ? result.slice(0, max) : undefined;
}

function number(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value.replace(/[$￥¥,\s]/gu, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function operationsForModel(id: string, value: Record<string, unknown>): ProviderOperation[] {
  const declared = value.operations ?? value.capabilities;
  if (Array.isArray(declared)) {
    const operations = declared.filter(
      (item): item is ProviderOperation =>
        item === "image.generate" ||
        item === "image.edit" ||
        item === "video.generate" ||
        item === "video.image-to-video",
    );
    if (operations.length > 0) return operations;
  }
  const kind = `${id} ${text(value.type) ?? ""} ${text(value.kind) ?? ""}`;
  if (/video|kling|runway|seedance|sora|hailuo|luma|veo|视频/iu.test(kind))
    return ["video.generate", "video.image-to-video"];
  if (
    /image|vision|dall[-_ ]?e|flux|stable[-_ ]?diffusion|sdxl|imagen|seedream|画图|绘图/iu.test(
      kind,
    )
  )
    return ["image.generate", "image.edit"];
  return [];
}

function pricing(value: Record<string, unknown>): {
  priceLabel?: string;
  billingLabel?: string;
} {
  const nested = [value.pricing, value.price, value.billing].find(isRecord);
  const priceLabel =
    text(value.priceLabel) ??
    text(value.price_label) ??
    text(value.billingLabel) ??
    text(value.billing_label) ??
    text(typeof value.price === "string" ? value.price : undefined) ??
    (typeof value.price === "number" ? String(value.price) : undefined) ??
    (nested
      ? text(nested.label) ??
        text(nested.priceLabel) ??
        (() => {
          const input = number(nested.input ?? nested.input_price);
          const output = number(nested.output ?? nested.output_price);
          if (input === undefined && output === undefined) return undefined;
          return [
            input === undefined ? "" : `输入 ${input}/1M`,
            output === undefined ? "" : `输出 ${output}/1M`,
          ]
            .filter(Boolean)
            .join(" · ");
        })()
      : undefined);
  const billingLabel =
    text(value.billingLabel) ??
    text(value.billing_label) ??
    text(value.billingMode) ??
    text(value.billing_mode) ??
    (nested ? text(nested.unit) ?? text(nested.dimension) : undefined);
  return {
    ...(priceLabel ? { priceLabel: priceLabel.slice(0, 256) } : {}),
    ...(billingLabel ? { billingLabel: billingLabel.slice(0, 128) } : {}),
  };
}

function entriesFromPayload(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord) as Record<string, unknown>[];
  if (!isRecord(payload)) return [];
  const candidates = [payload.data, payload.models, payload.items, payload.result];
  return candidates.flatMap((candidate) => {
    if (Array.isArray(candidate))
      return candidate.filter(isRecord) as Record<string, unknown>[];
    if (isRecord(candidate))
      return Object.entries(candidate).flatMap(([id, value]) =>
        isRecord(value) ? [{ id, ...value }] : [],
      );
    return [];
  });
}

/**
 * Convert common OpenAI-compatible model responses into isolated descriptors.
 * The parser is deliberately conservative: unknown models remain visible,
 * but are never marked canvas-runnable unless their id/type implies an image
 * or video protocol. Price fields are copied into metadata for the settings
 * panel and model selector.
 */
export function scanProviderModelCatalog(
  payload: unknown,
  options: { defaultModel?: string; checkedAt?: string } = {},
): ProviderCatalogScan {
  const byId = new Map<string, ModelDescriptor>();
  const groupIds = new Map<string, string[]>();
  for (const entry of entriesFromPayload(payload)) {
    const rawId = text(entry.id ?? entry.model ?? entry.name);
    const id = rawId?.replace(/^models\//u, "");
    if (!id || byId.has(id)) continue;
    const name = text(entry.display_name ?? entry.name) ?? id;
    const operations = operationsForModel(id, entry);
    const prices = pricing(entry);
    const group = text(
      entry.group ??
        entry.model_group ??
        entry.modelGroup ??
        entry.category ??
        entry.channel,
    ) ?? "默认群组";
    const descriptor: ModelDescriptor = {
      id,
      name,
      description:
        text(entry.description) ??
        (operations.length > 0
          ? "由当前供应商 API 实时返回的模型。"
          : "由当前供应商 API 实时返回；画布协议尚未验证。"),
      operations,
      inputKinds: [
        "text",
        ...(operations.some((op) => op.startsWith("image.")) ? (["image"] as const) : []),
      ],
      outputKinds: [
        operations.some((op) => op.startsWith("video."))
          ? "video"
          : operations.some((op) => op.startsWith("image."))
            ? "image"
            : "text",
      ],
      isDefault: id === options.defaultModel,
      metadata: {
        canvasRunnable: operations.length > 0,
        ...(operations.length > 0
          ? {}
          : { canvasUnavailableReason: "尚未验证该模型的画布调用协议" }),
        ...(prices.priceLabel ? { priceLabel: prices.priceLabel } : {}),
        ...(prices.billingLabel ? { billingLabel: prices.billingLabel } : {}),
        catalogGroup: group,
      },
    };
    byId.set(id, descriptor);
    const ids = groupIds.get(group) ?? [];
    ids.push(id);
    groupIds.set(group, ids);
  }
  const models = [...byId.values()];
  const groups = [...groupIds.entries()].map(([id, modelIds]) => ({
    id,
    label: id,
    modelIds,
  }));
  return {
    models,
    groups,
    checkedAt: options.checkedAt ?? new Date().toISOString(),
  };
}
