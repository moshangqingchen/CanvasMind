import { arePortKindsCompatible, type PortKind } from "@super-canvas/core";
import type {
  ModelDescriptor,
  ProviderOperation,
} from "@super-canvas/providers";

export type GenerationNodeType = "image-generation" | "video-generation";
export type AutoConnectNodeType = GenerationNodeType | "preview";

export interface AutoConnectionOption {
  nodeType: AutoConnectNodeType;
  targetHandle: string;
  targetKind: PortKind;
  label: string;
}

interface AutoConnectionCandidate extends AutoConnectionOption {
  sourceKinds: readonly PortKind[];
}

const autoConnectionCandidates: readonly AutoConnectionCandidate[] = [
  {
    nodeType: "image-generation",
    targetHandle: "prompt",
    targetKind: "text",
    sourceKinds: ["text"],
    label: "图片生成",
  },
  {
    nodeType: "video-generation",
    targetHandle: "prompt",
    targetKind: "text",
    sourceKinds: ["text"],
    label: "视频生成",
  },
  {
    nodeType: "image-generation",
    targetHandle: "references",
    targetKind: "image[]",
    sourceKinds: ["image", "image[]"],
    label: "图片编辑",
  },
  {
    nodeType: "video-generation",
    targetHandle: "firstFrame",
    targetKind: "image",
    sourceKinds: ["image"],
    label: "图生视频",
  },
  {
    nodeType: "video-generation",
    targetHandle: "referenceVideos",
    targetKind: "video[]",
    sourceKinds: ["video", "video[]"],
    label: "参考视频生成",
  },
  {
    nodeType: "video-generation",
    targetHandle: "referenceAudios",
    targetKind: "audio[]",
    sourceKinds: ["audio", "audio[]"],
    label: "参考音频生成",
  },
  {
    nodeType: "preview",
    targetHandle: "image",
    targetKind: "image[]",
    sourceKinds: ["image", "image[]"],
    label: "结果预览",
  },
  {
    nodeType: "preview",
    targetHandle: "video",
    targetKind: "video[]",
    sourceKinds: ["video", "video[]"],
    label: "结果预览",
  },
];

/**
 * Return only targets that can actually accept the dragged output. Keeping
 * this list derived from the same port kinds used by the nodes prevents the
 * blank-canvas shortcut from creating an edge that the normal connector would
 * reject.
 */
export function getAutoConnectionOptions(
  sourceKind: PortKind,
): AutoConnectionOption[] {
  return autoConnectionCandidates
    .filter(
      (candidate) =>
        candidate.sourceKinds.includes(sourceKind) &&
        arePortKindsCompatible(sourceKind, candidate.targetKind),
    )
    .map((candidate) => ({
      nodeType: candidate.nodeType,
      targetHandle: candidate.targetHandle,
      targetKind: candidate.targetKind,
      label: candidate.label,
    }));
}

export function getAutoConnectionTargetHandle(
  sourceKind: PortKind,
  nodeType: AutoConnectNodeType,
): string | null {
  return (
    getAutoConnectionOptions(sourceKind).find(
      (option) => option.nodeType === nodeType,
    )?.targetHandle ?? null
  );
}

const providerOperations: Readonly<
  Record<string, readonly ProviderOperation[]>
> = {
  fake: [
    "image.generate",
    "image.edit",
    "video.generate",
    "video.image-to-video",
  ],
  openai: ["image.generate", "image.edit"],
  runway: ["video.generate", "video.image-to-video"],
  // A REST connector declares its operation in its model/configuration.
  rest: [
    "image.generate",
    "image.edit",
    "video.generate",
    "video.image-to-video",
  ],
};

function operationsForNodeType(
  nodeType: GenerationNodeType,
): readonly ProviderOperation[] {
  return nodeType === "image-generation"
    ? ["image.generate", "image.edit"]
    : ["video.generate", "video.image-to-video"];
}

export function providerSupportsNodeType(
  provider: string,
  nodeType: GenerationNodeType,
): boolean {
  const supported = Object.prototype.hasOwnProperty.call(
    providerOperations,
    provider,
  )
    ? providerOperations[provider]
    : undefined;
  if (!supported) return false;
  const required = operationsForNodeType(nodeType);
  return required.some((operation) => supported.includes(operation));
}

export function modelSupportsNodeType(
  model: Pick<ModelDescriptor, "operations">,
  nodeType: GenerationNodeType,
): boolean {
  // An empty operation list is the connector's "capabilities unknown" form.
  if (model.operations.length === 0) return true;
  const required = operationsForNodeType(nodeType);
  return model.operations.some((operation) => required.includes(operation));
}

export interface CanvasShortcutContext {
  selectedId: string | null;
  editing: boolean;
  inPromptEditor: boolean;
  modalOpen: boolean;
  interactiveControl: boolean;
}

export function isCanvasShortcutAllowed(
  context: CanvasShortcutContext,
): boolean {
  if (!context.selectedId || context.modalOpen || context.interactiveControl)
    return false;
  return !context.editing || context.inPromptEditor;
}

export function isCanvasHistoryShortcutAllowed(
  context: Omit<CanvasShortcutContext, "selectedId" | "inPromptEditor">,
): boolean {
  return !context.editing && !context.modalOpen && !context.interactiveControl;
}

export function shouldPersistNodeChanges(
  changes: readonly { type: string }[],
): boolean {
  return changes.some((change) =>
    ["position", "dimensions", "remove"].includes(change.type),
  );
}
