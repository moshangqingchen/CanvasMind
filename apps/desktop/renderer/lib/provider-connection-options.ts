import type { ProviderConnectionView } from "./client-api";
import { cliSettings } from "./cli-connections";
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
  if (connection.provider === "cli") return `cli-${cliSettings(connection).siteId || connection.id}`;
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

export function providerSupplierLabel(
  key: string,
  connections: readonly ProviderConnectionView[] = [],
): string {
  const matching = connections.filter(
    (connection) => providerConnectionSupplierKey(connection) === key,
  );
  if (key.startsWith("cli-")) return matching.map(connection => cliSettings(connection).siteName).find(Boolean) || "个人 AI 网站";
  // The collection API resolves this from the current supplier record, so a
  // rename also reaches existing canvas nodes without changing their identity.
  for (const connection of matching) {
    const name = connection.config.supplierName;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  if (key.startsWith("custom-")) {
    // Older clients/saved connections predate supplierName. Their generated
    // connection name still contains the human-readable supplier prefix.
    const named = matching.find((connection) => connection.name.includes(" · "));
    return named?.name.split(" · ")[0]?.trim() || "自定义供应商";
  }
  return supplierLabelFor(key);
}

export function providerConnectionSupplierLabel(
  connection: ProviderConnectionView,
): string {
  return providerSupplierLabel(providerConnectionSupplierKey(connection), [connection]);
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
  if (connection.provider === "cli") return cliSettings(connection).accountLabel?.trim() || "本机登录账号";
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
  if (connection.config.supplierArchived === true) return "disabled";
  if (connection.config.usage === "agent") return "agent";
  if (connection.config.usage === "disabled") return "disabled";
  return "canvas";
}
