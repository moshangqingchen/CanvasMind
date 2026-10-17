import type { GenerationRequirements, DirectorCatalogCandidate } from "@super-canvas/director";
import { parametersForRequirements } from "@super-canvas/director";
import type { ModelDescriptor, ModelParameterDescriptor, ModelParameterValue } from "@super-canvas/providers";
import { resolveModelParameters, validateModelParameters } from "@super-canvas/providers/cli-contracts";
import { normalizedParametersForModel, parameterDescriptorsFor, parameterDescriptorsForValues } from "./model-parameters";

const aliases = {
  aspectRatio: ["aspect_ratio", "aspectRatio", "ratio"],
  resolution: ["size", "resolution", "image_size", "video_size"],
  durationSeconds: ["duration", "duration_seconds", "seconds"],
  quality: ["quality", "quality_tier"],
  count: ["n", "count", "num_outputs", "number_of_outputs"],
} as const;
export const agentNodeType = (operation: GenerationRequirements["operation"]) => operation.startsWith("image.") ? "image-generation" as const : "video-generation" as const;
export function scalarAgentParameters(parameters: Readonly<Record<string, unknown>>): Record<string, ModelParameterValue> {
  return Object.fromEntries(Object.entries(parameters).filter((entry): entry is [string, ModelParameterValue] =>
    typeof entry[1] === "string" || typeof entry[1] === "boolean" || (typeof entry[1] === "number" && Number.isFinite(entry[1]))));
}

function parameterContract(candidate: Pick<DirectorCatalogCandidate, "model" | "provider">, requirements: GenerationRequirements, values: Readonly<Record<string, unknown>>) {
  const visible = parameterDescriptorsForValues(agentNodeType(requirements.operation), candidate.provider, candidate.model, values, requirements.operation);
  // Keep currently hidden declarations in the graph: resetting a controlling
  // value can reveal another required field during resolveModelParameters.
  const descriptors = parameterDescriptorsFor(agentNodeType(requirements.operation), candidate.provider, candidate.model)
    .map(descriptor => visible.find(effective => effective.key === descriptor.key) ?? descriptor);
  // Exact-size canvas controls keep their chosen application tier next to size.
  // It is an application preference derived from actual listed sizes, never a
  // new provider request field or an invented supplier capability.
  const tiers = ["1K", "2K", "4K"].filter(tier => descriptors.some(descriptor => descriptor.key === "size" && descriptor.options?.some(option => option.label.toUpperCase().startsWith(tier))));
  const tierPreference: ModelParameterDescriptor[] = tiers.length && !descriptors.some(descriptor => descriptor.key === "size_tier") ? [{ key: "size_tier", label: "分辨率档位", control: "select", valueType: "string", options: tiers.map(value => ({ value, label: value })) }] : [];
  return { ...candidate.model, parameters: [...descriptors, ...tierPreference] };
}

export function agentCallParameters(requirements: GenerationRequirements, candidate: Pick<DirectorCatalogCandidate, "model" | "provider">, explicit?: Readonly<Record<string, unknown>>): Record<string, ModelParameterValue> {
  if (explicit) return scalarAgentParameters(explicit);
  return scalarAgentParameters(normalizedParametersForModel(agentNodeType(requirements.operation), candidate.provider, candidate.model, parametersForRequirements(requirements, candidate.model)));
}

/** This runs only on a user-selected channel change. Ordinary readback keeps the
 * exact saved snapshot, including invalid values, until the user edits it. */
export function switchAgentChannel(requirements: GenerationRequirements, current: Readonly<Record<string, unknown>>, candidate: Pick<DirectorCatalogCandidate, "model" | "provider">) {
  const values = { ...current };
  for (const keys of Object.values(aliases)) {
    const target = candidate.model.parameters?.find(descriptor => keys.some(key => key === descriptor.key));
    if (target && values[target.key] === undefined) {
      const previous = keys.find(key => values[key] !== undefined);
      if (previous) values[target.key] = values[previous];
    }
  }
  const contract = parameterContract(candidate, requirements, values);
  const resolved = resolveModelParameters(contract, values, requirements.operation);
  const defaults = normalizedParametersForModel(agentNodeType(requirements.operation), candidate.provider, candidate.model, resolved.parameters);
  const parameters = scalarAgentParameters({ ...defaults, ...resolved.parameters });
  const changedKeys = Object.keys(current).filter(key => current[key] !== parameters[key]);
  return { parameters, changedKeys, issues: validateModelParameters(parameterContract(candidate, requirements, parameters), parameters, requirements.operation).issues };
}

export function agentParameterIssues(requirements: GenerationRequirements, candidate: Pick<DirectorCatalogCandidate, "model" | "provider">, parameters: Readonly<Record<string, unknown>>) {
  return validateModelParameters(parameterContract(candidate, requirements, parameters), parameters, requirements.operation).issues;
}

/** Quotes and routing use the same selected parameters that will enter nodes. */
export function agentRequirementsForParameters(requirements: GenerationRequirements, parameters: Readonly<Record<string, unknown>>, model?: ModelDescriptor): GenerationRequirements {
  const next = { ...requirements };
  for (const key of ["aspectRatio", "resolution", "durationSeconds", "quality"] as const) delete next[key];
  for (const [name, keys] of Object.entries(aliases)) {
    const key = keys.find(key => parameters[key] !== undefined) ?? model?.parameters?.find(descriptor => keys.some(key => key === descriptor.key) && descriptor.default !== undefined)?.key;
    const value = key ? parameters[key] ?? model?.parameters?.find(descriptor => descriptor.key === key)?.default : undefined;
    if (value === undefined || value === "") continue;
    if (name === "count") next.count = Number(value);
    else if (name === "durationSeconds") next.durationSeconds = Number(value);
    else if (name === "aspectRatio" || name === "resolution" || name === "quality") next[name] = String(value);
  }
  if (requirements.operation.startsWith("video.") || model?.metadata?.fixedOutputCount === 1) next.count = 1;
  return next;
}
