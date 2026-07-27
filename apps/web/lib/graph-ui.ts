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

export interface PositionedCanvasRect {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
}

export type NodeAlignmentAction =
  | "left"
  | "center-x"
  | "right"
  | "top"
  | "center-y"
  | "bottom"
  | "distribute-x"
  | "distribute-y";

export function alignedCanvasRectPositions(
  nodes: readonly PositionedCanvasRect[],
  action: NodeAlignmentAction,
  minimumGap = 16,
): Map<string, { x: number; y: number }> {
  const positions = new Map(
    nodes.map((node) => [node.id, { ...node.position }] as const),
  );
  if (nodes.length < 2) return positions;

  const left = Math.min(...nodes.map((node) => node.position.x));
  const right = Math.max(
    ...nodes.map((node) => node.position.x + node.width),
  );
  const top = Math.min(...nodes.map((node) => node.position.y));
  const bottom = Math.max(
    ...nodes.map((node) => node.position.y + node.height),
  );
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;

  if (action === "distribute-x" || action === "distribute-y") {
    if (nodes.length < 3) return positions;
    const horizontal = action === "distribute-x";
    const sorted = [...nodes].sort((first, second) =>
      horizontal
        ? first.position.x - second.position.x
        : first.position.y - second.position.y,
    );
    const totalSize = sorted.reduce(
      (sum, node) => sum + (horizontal ? node.width : node.height),
      0,
    );
    const span = horizontal ? right - left : bottom - top;
    const gap = Math.max(minimumGap, (span - totalSize) / (nodes.length - 1));
    let cursor = horizontal ? left : top;
    for (const node of sorted) {
      const current = positions.get(node.id)!;
      positions.set(node.id, {
        x: horizontal ? cursor : current.x,
        y: horizontal ? current.y : cursor,
      });
      cursor += (horizontal ? node.width : node.height) + gap;
    }
    return positions;
  }

  for (const node of nodes) {
    const current = positions.get(node.id)!;
    positions.set(node.id, {
      x:
        action === "left"
          ? left
          : action === "center-x"
            ? centerX - node.width / 2
            : action === "right"
              ? right - node.width
              : current.x,
      y:
        action === "top"
          ? top
          : action === "center-y"
            ? centerY - node.height / 2
            : action === "bottom"
              ? bottom - node.height
              : current.y,
    });
  }
  return positions;
}

export function closestAvailableResultPosition(
  source: PositionedCanvasRect,
  result: { width: number; height: number },
  occupied: readonly PositionedCanvasRect[],
  options: {
    sourceGap?: number;
    collisionGap?: number;
    verticalDirection?: "nearest" | "down";
  } = {},
): { x: number; y: number } {
  const sourceGap = options.sourceGap ?? 24;
  const collisionGap = options.collisionGap ?? 16;
  const verticalDirection = options.verticalDirection ?? "nearest";
  const x = source.position.x + source.width + sourceGap;
  const preferredY = source.position.y;

  const horizontallyRelevant = occupied.filter((node) => {
    if (node.id === source.id) return false;
    return !(
      x + result.width + collisionGap <= node.position.x ||
      x >= node.position.x + node.width + collisionGap
    );
  });
  const candidateYs = new Set([preferredY]);
  for (const node of horizontallyRelevant) {
    const below = node.position.y + node.height + collisionGap;
    if (below >= preferredY) candidateYs.add(below);
    if (verticalDirection === "nearest")
      candidateYs.add(node.position.y - result.height - collisionGap);
  }

  const overlapsAt = (y: number) =>
    horizontallyRelevant.some(
      (node) =>
        !(
          y + result.height + collisionGap <= node.position.y ||
          y >= node.position.y + node.height + collisionGap
        ),
    );
  const candidates = Array.from(candidateYs).sort((left, right) => {
    const distance =
      Math.abs(left - preferredY) - Math.abs(right - preferredY);
    if (Math.abs(distance) > 0.5) return distance;
    const leftIsBelow = left >= preferredY;
    const rightIsBelow = right >= preferredY;
    if (leftIsBelow !== rightIsBelow) return leftIsBelow ? -1 : 1;
    return left - right;
  });

  return { x, y: candidates.find((y) => !overlapsAt(y)) ?? preferredY };
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
