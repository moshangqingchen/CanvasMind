import type { ProviderConnectionView } from "./client-api";
import {
  providerSupplierLabel as supplierLabelFor,
  providerSupplierWebsite as supplierWebsiteFor,
} from "@super-canvas/providers/suppliers";
import {
  isCangyuanImagePreset,
  normalizeCangyuanImageGroup,
} from "./provider-presets";
import {
  isMikotoPreset,
  MIKOTO_MODEL_GROUP,
  MIKOTO_PRESET_ID,
  MIKOTO_SUPPLIER_KEY,
  normalizeMikotoGroupId,
} from "./mikoto-presets";
import { supplierKeyForConnection } from "./supplier-identity";

export function providerConnectionSupplierKey(
  connection: ProviderConnectionView,
): string {
  return supplierKeyForConnection(connection);
}

export function isWeAiConnectionConfig(connection: {
  provider: string;
  config: Readonly<Record<string, unknown>>;
}): boolean {
  const supplierKey =
    typeof connection.config.supplierKey === "string"
      ? connection.config.supplierKey.trim()
      : "";
  return (
    connection.provider === "weai" &&
    supplierKey !== MIKOTO_SUPPLIER_KEY &&
    connection.config.preset !== MIKOTO_PRESET_ID
  );
}

export function providerSupplierLabel(key: string): string {
  return supplierLabelFor(key);
}

export function providerSupplierWebsite(key: string): string | undefined {
  return supplierWebsiteFor(key);
}

export function providerConnectionSupplierWebsite(
  connection: ProviderConnectionView,
): string | undefined {
  const configured = connection.config.supplierWebsiteUrl;
  if (typeof configured === "string" && configured.startsWith("https://"))
    return configured;
  return providerSupplierWebsite(providerConnectionSupplierKey(connection));
}

export function providerConnectionGroup(
  connection: ProviderConnectionView,
): string {
  const group = connection.config.modelGroup;
  if (isCangyuanImagePreset(connection.config.preset)) {
    const normalized = normalizeCangyuanImageGroup(group);
    if (normalized) return normalized;
  }
  if (isMikotoPreset(connection.config.preset)) {
    if (group === MIKOTO_MODEL_GROUP) return MIKOTO_MODEL_GROUP;
    return normalizeMikotoGroupId(group) ??
      (typeof group === "string" && group.trim()
        ? group.trim()
        : "默认群组");
  }
  return typeof group === "string" && group.trim() ? group.trim() : "默认群组";
}

export function providerGroupLabel(group: string, ratio?: number): string {
  return typeof ratio === "number" && Number.isFinite(ratio)
    ? `${group}（x${ratio}）`
    : group;
}

export type ProviderConnectionUsage = "canvas" | "agent" | "disabled";

export function providerConnectionUsage(
  connection: ProviderConnectionView,
): ProviderConnectionUsage {
  if (connection.config.usage === "agent") return "agent";
  if (connection.config.usage === "disabled") return "disabled";
  return "canvas";
}
