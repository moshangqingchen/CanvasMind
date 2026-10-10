import type { ModelDescriptor } from "@super-canvas/providers";
import { jijiuGptImageParameters, jijiuGptImageRequestIssues, jijiuImageOrigin } from "@super-canvas/providers/jijiu-image-contract";

type QualityMode = "highest" | "custom";

export interface SavedModelParameters {
  connectionId: string;
  model: string;
  provider?: string;
  parameters: Record<string, unknown>;
  qualityMode?: QualityMode;
}

interface NodeSelection {
  connectionId?: string;
  model?: string;
  provider?: string;
  parameters?: Record<string, unknown>;
  qualityMode?: QualityMode;
  modelParameterSelections?: unknown;
}

function selection(value: unknown): value is SavedModelParameters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<SavedModelParameters>;
  return typeof item.connectionId === "string" && typeof item.model === "string" &&
    !!item.parameters && typeof item.parameters === "object" && !Array.isArray(item.parameters);
}

/** Persist each connection/model choice with the canvas, outside wire parameters. */
export function rememberModelParameters(data: NodeSelection): SavedModelParameters[] {
  const previous = Array.isArray(data.modelParameterSelections)
    ? data.modelParameterSelections.filter(selection) : [];
  if (!data.connectionId || !data.model) return previous;
  const parameters = { ...data.parameters };
  // Masks belong to the current canvas editing session, never an old model choice.
  for (const key of ["maskAssetId", "maskSourceAssetId", "mask"]) delete parameters[key];
  return [...previous.filter(item => item.connectionId !== data.connectionId || item.model !== data.model), {
    connectionId: data.connectionId, model: data.model, provider: data.provider,
    parameters, qualityMode: data.qualityMode,
  }];
}

/** An explicit model uses its own values; switching connections restores its last model. */
export function savedModelParameters(
  selections: readonly SavedModelParameters[],
  connectionId: string,
  model?: string,
): SavedModelParameters | undefined {
  for (let index = selections.length - 1; index >= 0; index--) {
    const item = selections[index]!;
    if (item.connectionId === connectionId && (model === undefined || item.model === model)) return item;
  }
  return undefined;
}

interface SelectionConnection {
  id: string;
  provider: string;
  config: Readonly<Record<string, unknown>>;
}

/** First visits to another Jijiu group may retain this exact model's legal choice. */
export function transferableJijiuModelParameters(
  data: NodeSelection,
  source: SelectionConnection | undefined,
  target: SelectionConnection,
  targetModel: ModelDescriptor | null,
): SavedModelParameters | undefined {
  const sourceOrigin = source && jijiuImageOrigin(source.config.baseUrl);
  if (!sourceOrigin || sourceOrigin !== jijiuImageOrigin(target.config.baseUrl) ||
      !["openai", "rest"].includes(source.provider) || !["openai", "rest"].includes(target.provider) ||
      data.model !== "gpt-image-2-2K/4K" || targetModel?.id !== data.model ||
      targetModel.metadata?.jijiuImageContract !== true || targetModel.metadata.canvasRunnable === false) return undefined;
  const parameters = { ...data.parameters };
  for (const key of ["maskAssetId", "maskSourceAssetId", "mask"]) delete parameters[key];
  if (jijiuGptImageRequestIssues(target, { idempotencyKey: "local-parameter-compatibility", connectionId: target.id,
    operation: "image.generate", model: data.model, prompt: "parameter compatibility", parameters }).length) return undefined;
  const requestParameters = jijiuGptImageParameters(parameters, data.model);
  for (const key of ["size", "quality"]) {
    const value = requestParameters[key];
    if (value !== undefined && !targetModel.parameters?.find(parameter => parameter.key === key)?.options?.some(option => option.value === value)) return undefined;
  }
  return { connectionId: target.id, model: data.model, provider: target.provider, parameters, qualityMode: data.qualityMode };
}
