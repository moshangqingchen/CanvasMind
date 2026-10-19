import type { ModelDescriptor } from "@super-canvas/providers";
import { modelCanvasUnavailableReason, modelSupportsNodeType, type GenerationNodeType } from "./graph-ui";
import { modelDescriptorForSavedSelection } from "./model-parameters";
import { rememberModelParameters, savedModelParameters, transferableJijiuModelParameters, type SavedModelParameters } from "./saved-model-parameters";

type NodeSelection = Parameters<typeof rememberModelParameters>[0];
type SelectionConnection = Parameters<typeof transferableJijiuModelParameters>[2];

/** The same eligible local directory is used by a connection switch and its preview. */
export function runnableConnectionModels(models: readonly ModelDescriptor[], nodeType: GenerationNodeType): ModelDescriptor[] {
  return models.filter(model => modelSupportsNodeType(model, nodeType) && !modelCanvasUnavailableReason(model));
}

/** Preserve saved aliases and the existing supplier-default/first-model fallback. */
export function preferredConnectionModel(compatible: readonly ModelDescriptor[], preferredId?: string): ModelDescriptor | null {
  return modelDescriptorForSavedSelection(compatible, preferredId) ?? compatible.find(model => model.isDefault) ?? compatible[0] ?? null;
}

/** Pure selection only: callers still own parameters, masks, quality and persistence.
 * Previewing must not replace this with an exact-ID guess or a second model change.
 */
export function nodeConnectionSelection(
  data: NodeSelection,
  nodeType: GenerationNodeType,
  source: SelectionConnection | undefined,
  target: SelectionConnection,
  selectModel: (preferredId?: string) => ModelDescriptor | null,
  selections: readonly SavedModelParameters[] = rememberModelParameters(data),
): { configuredModel: ModelDescriptor | null; restoredSelection?: SavedModelParameters } {
  const previousSelection = nodeType === "image-generation" ? savedModelParameters(selections, target.id) : undefined;
  const transferredSelection = nodeType === "image-generation" && !previousSelection
    ? transferableJijiuModelParameters(data, source, target, selectModel(data.model)) : undefined;
  const direct = target.config.defaultModel;
  const defaultModel = typeof direct === "string" && direct.trim() ? direct.trim() : undefined;
  const configuredModel = selectModel(previousSelection?.model ?? transferredSelection?.model ?? defaultModel);
  const restoredSelection = configuredModel && previousSelection?.model === configuredModel.id
    ? previousSelection : transferredSelection;
  return { configuredModel, restoredSelection };
}
