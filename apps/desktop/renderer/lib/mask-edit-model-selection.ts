import type { ModelDescriptor } from "@super-canvas/providers";
import type { ImageEditingCapabilities } from "@super-canvas/providers/image-editing-capabilities";
import type { ProviderConnectionView } from "./client-api";
import { modelImageCapabilities } from "./model-image-capabilities";
import { parameterDescriptorsFor, parametersWithDefaults } from "./model-parameters";
import { qualityRank } from "./model-quality";

export interface MaskEditModelCandidate {
  connection: ProviderConnectionView;
  model: ModelDescriptor;
}

export interface MaskEditModelChoice extends MaskEditModelCandidate {
  parameters: Record<string, unknown>;
  capabilities: ImageEditingCapabilities & { mask: "multipart" | "url" };
}

function configured(connection: ProviderConnectionView): boolean {
  if (connection.provider === "fake") return false;
  if (connection.apiKeyUsable ?? connection.apiKeySet) return true;
  const connector = connection.config.connector;
  if (!connector || typeof connector !== "object" || Array.isArray(connector)) return false;
  const auth = (connector as Record<string, unknown>).auth;
  return Boolean(auth && typeof auth === "object" && !Array.isArray(auth) &&
    (auth as Record<string, unknown>).type === "none");
}

function tier(value: unknown): number {
  const match = /^([124])k$/iu.exec(String(value ?? ""));
  return match ? Number(match[1]) : 0;
}

function resolution(choice: MaskEditModelChoice): number {
  const fixed = /-(1k|2k|4k)$/iu.exec(choice.model.id);
  return Math.max(fixed ? tier(fixed[1]) : 0, ...["tier", "size_tier", "resolution", "image_size", "imageSize", "quality"]
    .map(key => tier(choice.parameters[key])));
}

function family(id: string | undefined): string | undefined {
  return id?.replace(/-(?:1k|2k|4k)$/iu, "");
}

/** Select only currently usable brush-mask routes; reference-image editing is insufficient. */
export function selectMaskEditModel(
  candidates: readonly MaskEditModelCandidate[],
  preferred: { connectionId?: string; modelId?: string; parameters?: Readonly<Record<string, unknown>> } = {},
): MaskEditModelChoice | null {
  const choices: MaskEditModelChoice[] = [];
  for (const { connection, model } of candidates) {
    if (!configured(connection)) continue;
    const descriptors = parameterDescriptorsFor("image-generation", connection.provider, model)
      .filter(parameter => !parameter.operations?.length || parameter.operations.includes("image.edit"));
    const isSourceModel = connection.id === preferred.connectionId && model.id === preferred.modelId;
    const sourceParameters = isSourceModel ? { ...preferred.parameters } : {};
    for (const key of ["mask", "maskAssetId", "maskSourceAssetId"]) delete sourceParameters[key];
    const parameters = parametersWithDefaults(descriptors, sourceParameters);
    // Native tier controls may default to a web route without masks. Pick only
    // a declared tier, rather than inventing a 4K value for every Image 2 alias.
    const sourceSupportsMask = isSourceModel && Boolean(modelImageCapabilities(connection, model, parameters).mask);
    for (const descriptor of descriptors) {
      if (sourceSupportsMask && sourceParameters[descriptor.key] !== undefined) continue;
      if (!["tier", "resolution", "image_size", "imageSize"].includes(descriptor.key) ||
          descriptor.visibleWhen?.some(condition => !condition.values.includes(parameters[condition.parameter] as string | number | boolean))) continue;
      const highest = descriptor.options?.reduce<(NonNullable<typeof descriptor.options>)[number] | undefined>((best, option) =>
        tier(option.value) > tier(best?.value) ? option : best, undefined);
      if (highest) parameters[descriptor.key] = highest.value;
    }
    const capabilities = modelImageCapabilities(connection, model, parameters);
    if (!capabilities.mask) continue;
    choices.push({ connection, model, parameters, capabilities: { ...capabilities, mask: capabilities.mask } });
  }
  const fromSource = (choice: MaskEditModelChoice) => Number(Boolean(preferred.connectionId) && choice.connection.id === preferred.connectionId);
  const sameFamily = (choice: MaskEditModelChoice) => Number(Boolean(preferred.modelId) && fromSource(choice) === 1 && family(choice.model.id) === family(preferred.modelId));
  const exactModel = (choice: MaskEditModelChoice) => Number(Boolean(preferred.modelId) && fromSource(choice) === 1 && choice.model.id === preferred.modelId);
  // Keep connection/catalog order across suppliers. Higher resolution only
  // ranks compatible variants in the same family, never a different supplier.
  const connectionOrder = (choice: MaskEditModelChoice) => candidates.findIndex(candidate => candidate.connection.id === choice.connection.id);
  const familyOrder = (choice: MaskEditModelChoice) => choices.findIndex(candidate =>
    candidate.connection.id === choice.connection.id && family(candidate.model.id) === family(choice.model.id));
  const familyOrders = new Map(choices.map(choice => [choice, familyOrder(choice)]));
  const quality = (choice: MaskEditModelChoice) => Math.max(0, ...["quality", "image_quality", "output_quality"]
    .map(key => qualityRank({ value: String(choice.parameters[key] ?? ""), label: "" }) ?? 0));
  choices.sort((a, b) => fromSource(b) - fromSource(a) || connectionOrder(a) - connectionOrder(b) ||
    exactModel(b) - exactModel(a) || sameFamily(b) - sameFamily(a) ||
    familyOrders.get(a)! - familyOrders.get(b)! || resolution(b) - resolution(a) || quality(b) - quality(a));
  return choices[0] ?? null;
}
