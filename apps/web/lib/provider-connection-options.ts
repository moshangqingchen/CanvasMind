import type { ProviderConnectionView } from "./client-api";
import { isCangyuanImagePreset } from "./provider-presets";

const supplierLabels: Record<string, string> = {
  cangyuan: "沧元算力",
  openai: "OpenAI",
  rest: "通用 REST",
  runway: "Runway",
  fake: "Fake（离线演示）",
};

export function providerConnectionSupplierKey(
  connection: ProviderConnectionView,
): string {
  return isCangyuanImagePreset(connection.config.preset)
    ? "cangyuan"
    : connection.provider;
}

export function providerSupplierLabel(key: string): string {
  return supplierLabels[key] ?? key;
}

export function providerConnectionGroup(
  connection: ProviderConnectionView,
): string {
  const group = connection.config.modelGroup;
  return typeof group === "string" && group.trim() ? group.trim() : "默认群组";
}

export function providerGroupLabel(group: string, ratio?: number): string {
  return typeof ratio === "number" && Number.isFinite(ratio)
    ? `${group}（x${ratio}）`
    : group;
}

export type ProviderConnectionUsage = "canvas" | "agent";

export function providerConnectionUsage(
  connection: ProviderConnectionView,
): ProviderConnectionUsage {
  return connection.config.usage === "agent" ? "agent" : "canvas";
}
