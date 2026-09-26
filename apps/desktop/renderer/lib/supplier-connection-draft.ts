import { matchesSupplierTemplate } from "./supplier-template-source";
import type { SupplierCatalogGroup } from "./client-suppliers";
import type { ProviderConnectionUsage } from "./provider-connection-options";
import {
  cangyuanImageConnectionConfig,
  isCangyuanImageGroup,
} from "./provider-presets";
import { CYBERAFEI_PRESET_ID } from "./cyberafei-catalog";
import { chentuConnectionConfig, isChentuImageGroup } from "./chentu-presets";
import {
  friModelConnectionConfig,
  isFriModelImageGroup,
} from "./frimodel-presets";
import { miaowuConnectionConfig } from "./miaowu-presets";
import {
  isMikotoGroupId,
  mikotoConnectionConfig,
  mikotoGroup,
} from "./mikoto-presets";
import { weAiCatalogGroup } from "./weai-catalog";

/** Keep the adapters already supported by each built-in group when connecting it in the new UI. */
export function supplierConnectionDraft(
  supplierKey: string,
  group: SupplierCatalogGroup,
  usage: ProviderConnectionUsage,
  apiUrl: string,
): { provider: string; config: Record<string, unknown> } {
  const base: Record<string, unknown> = {
    supplierKey,
    usage,
    customGroup: true,
    modelGroup: group.id,
    baseUrl: apiUrl,
  };
  if (usage !== "canvas" || group.source === "manual" || !matchesSupplierTemplate({ provider: "openai", config: base }))
    return { provider: usage === "agent" ? "rest" : "openai", config: base };
  let preset: { provider: string; config: Record<string, unknown> } | undefined;
  if (supplierKey === "cangyuan" && isCangyuanImageGroup(group.id))
    preset = {
      provider: "rest",
      config: cangyuanImageConnectionConfig(group.id),
    };
  if (supplierKey === "cyberafei")
    preset = {
      provider: "rest",
      config: {
        preset: CYBERAFEI_PRESET_ID,
        modelGroup: group.id,
        defaultModel:
          group.models.find(
            (model) =>
              model.capability === "image" || model.capability === "video",
          )?.id ?? "",
      },
    };
  if (supplierKey === "chentu" && isChentuImageGroup(group.id))
    preset = { provider: "openai", config: chentuConnectionConfig(group.id) };
  if (supplierKey === "frimodel" && isFriModelImageGroup(group.id))
    preset = { provider: "openai", config: friModelConnectionConfig(group.id) };
  if (supplierKey === "miaowu")
    preset = { provider: "rest", config: miaowuConnectionConfig(group.id) };
  if (supplierKey === "mikoto" && isMikotoGroupId(group.id))
    preset = {
      provider: mikotoGroup(group.id)!.provider,
      config: mikotoConnectionConfig(group.id),
    };
  if (supplierKey === "weai") {
    const known = weAiCatalogGroup(group.id);
    if (known?.canvasSupported)
      preset = {
        provider: "weai",
        config: {
          modelGroup: group.id,
          protocol: known.protocol,
          defaultModel: known.defaultModel,
        },
      };
  }
  return preset
    ? {
        provider: preset.provider,
        config: {
          ...preset.config,
          supplierKey,
          usage,
          baseUrl: apiUrl,
          customGroup: false,
        },
      }
    : { provider: "openai", config: base };
}
