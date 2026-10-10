import { scanProviderModelCatalog, type ModelDescriptor } from "@super-canvas/providers";
import { assertCompleteModelInventoryPayload } from "./model-inventory-failure";

export function monsterNativeImageCatalogUrl(config: Readonly<Record<string, unknown>>): string | undefined {
  try {
    const url = new URL(String(config.baseUrl ?? ""));
    if (url.origin !== "https://api.eaheng.com" || url.username || url.password || url.search || url.hash ||
        !/^(?:\/v1)?\/?$/u.test(url.pathname)) return;
    if (config.accountKeyGroupId != null ? String(config.accountKeyGroupId) !== "11" :
        (config.accountKeyGroup ?? config.modelGroup) !== "C1-Gemini（香蕉生图）") return;
    return `${url.origin}/v1beta/models`;
  } catch { return; }
}

export function mikotoNativeImageCatalogUrl(config: Readonly<Record<string, unknown>>): string | undefined {
  try {
    const url = new URL(String(config.baseUrl ?? ""));
    if (url.origin !== "https://api.mikoto.vip" || url.username || url.password || url.search || url.hash ||
        !/^(?:\/v1)?\/?$/u.test(url.pathname)) return;
    if (config.accountKeyGroupId != null ? String(config.accountKeyGroupId) !== "28" :
        (config.accountKeyGroup ?? config.modelGroup) !== "gemini生图") return;
    return `${url.origin}/v1beta/models`;
  } catch { return; }
}

/** Native models/ names are transport wrappers, not the full request IDs. */
export function mergeMonsterNativeImageCatalog<T extends { models: ModelDescriptor[]; groups: Array<{ id: string; label: string; modelIds: readonly string[] }>; checkedAt: string }>(
  primary: T, payload: unknown, defaultModel: string, baseUrl: string,
): T {
  assertCompleteModelInventoryPayload(payload);
  const records = payload && typeof payload === "object" && "models" in payload && Array.isArray(payload.models) ? payload.models : [];
  const native = records.flatMap(record => {
    if (!record || typeof record !== "object" || typeof record.name !== "string") return [];
    const id = record.name.replace(/^models\//u, "");
    if (!Array.isArray(record.supportedGenerationMethods) || !record.supportedGenerationMethods.includes("generateContent")) return [];
    return [{ ...record, id, name: id, nativeName: record.name }];
  });
  const scan = scanProviderModelCatalog({ data: native }, { defaultModel, baseUrl });
  const origin = new URL(baseUrl).origin;
  const models = new Map(primary.models.map(model => [model.id, model]));
  for (const model of scan.models) models.set(model.id, { ...models.get(model.id), ...model,
    metadata: { ...models.get(model.id)?.metadata, ...model.metadata,
      ...(origin === "https://api.eaheng.com" ? { monsterNativeModelName: `models/${model.id}`,
        monsterNativeCatalogSource: `${origin}/v1beta/models`, monsterNativeCatalogCheckedAt: scan.checkedAt } : {}),
      nativeImageModelName: `models/${model.id}`, nativeImageCatalogSource: `${origin}/v1beta/models`, nativeImageCatalogCheckedAt: scan.checkedAt,
      endpointTypes: ["gemini"], operationsSource: "native-key-directory" } });
  const groups = primary.groups.map(group => ({ ...group, modelIds: [...new Set([...group.modelIds, ...scan.models.map(model => model.id)])] }));
  return { ...primary, models: [...models.values()], groups, checkedAt: scan.checkedAt };
}
