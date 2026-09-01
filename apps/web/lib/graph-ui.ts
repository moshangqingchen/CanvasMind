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
  weai: ["image.generate", "image.edit"],
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

/** Returns the provider-supplied reason for a scanned, display-only model. */
export function modelCanvasUnavailableReason(
  model: Pick<ModelDescriptor, "metadata">,
): string | null {
  if (model.metadata?.canvasRunnable !== false) return null;
  const reason = model.metadata.canvasUnavailableReason;
  return typeof reason === "string" && reason.trim()
    ? reason.trim()
    : "尚无已验证的画布生成协议";
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
  const right = Math.max(...nodes.map((node) => node.position.x + node.width));
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

export type CanvasLayoutDirection = "horizontal" | "vertical";

export interface TidyCanvasRect extends PositionedCanvasRect {
  generatedFromNodeId?: string;
  canvasGroupId?: string;
}

export interface TidyCanvasEdge {
  source: string;
  target: string;
}

export interface TidyCanvasOptions {
  layerGap?: number;
  nodeGap?: number;
  resultGap?: number;
  resultGridGap?: number;
  maxResultColumns?: number;
  componentGap?: number;
  maxComponentColumns?: number;
}

function canvasLayoutOwnerIds(
  nodes: readonly TidyCanvasRect[],
): Map<string, string> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return new Map(
    nodes.map((node) => {
      const sourceId = node.generatedFromNodeId;
      return [
        node.id,
        sourceId && sourceId !== node.id && nodeIds.has(sourceId)
          ? sourceId
          : node.id,
      ] as const;
    }),
  );
}

/** Choose the direction that best preserves the canvas's current visual flow. */
export function preferredCanvasLayoutDirection(
  nodes: readonly TidyCanvasRect[],
  edges: readonly TidyCanvasEdge[],
): CanvasLayoutDirection {
  if (nodes.length < 2) return "horizontal";
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const ownerIds = canvasLayoutOwnerIds(nodes);
  const seenPairs = new Set<string>();
  let horizontalScore = 0;
  let verticalScore = 0;

  for (const edge of edges) {
    const sourceId = ownerIds.get(edge.source);
    const targetId = ownerIds.get(edge.target);
    if (!sourceId || !targetId || sourceId === targetId) continue;
    const pair = `${sourceId}\u0000${targetId}`;
    if (seenPairs.has(pair)) continue;
    seenPairs.add(pair);
    const source = nodeById.get(sourceId);
    const target = nodeById.get(targetId);
    if (!source || !target) continue;
    const sourceCenterX = source.position.x + source.width / 2;
    const sourceCenterY = source.position.y + source.height / 2;
    const targetCenterX = target.position.x + target.width / 2;
    const targetCenterY = target.position.y + target.height / 2;
    horizontalScore += Math.abs(targetCenterX - sourceCenterX);
    verticalScore += Math.abs(targetCenterY - sourceCenterY);
  }

  if (horizontalScore > 0 || verticalScore > 0)
    return horizontalScore >= verticalScore ? "horizontal" : "vertical";

  const primaryNodes = nodes.filter(
    (node) => ownerIds.get(node.id) === node.id,
  );
  if (primaryNodes.length === 0) return "horizontal";
  const horizontalSpan =
    Math.max(...primaryNodes.map((node) => node.position.x + node.width)) -
    Math.min(...primaryNodes.map((node) => node.position.x));
  const verticalSpan =
    Math.max(...primaryNodes.map((node) => node.position.y + node.height)) -
    Math.min(...primaryNodes.map((node) => node.position.y));
  return horizontalSpan >= verticalSpan ? "horizontal" : "vertical";
}

interface TidyLayoutBlock {
  id: string;
  source: TidyCanvasRect;
  width: number;
  height: number;
  offsets: Map<string, { x: number; y: number }>;
}

interface TidyComponentLayout {
  id: string;
  width: number;
  height: number;
  originalX: number;
  originalY: number;
  offsets: Map<string, { x: number; y: number }>;
}

export interface PackedCanvasRectGrid {
  width: number;
  height: number;
  offsets: Map<string, { x: number; y: number }>;
}

/** Pack mixed-size cards into a stable, gap-aware grid. */
export function packedCanvasRectGrid(
  nodes: readonly Pick<PositionedCanvasRect, "id" | "width" | "height">[],
  gap = 24,
  maxColumns = 3,
): PackedCanvasRectGrid {
  if (nodes.length === 0) return { width: 0, height: 0, offsets: new Map() };
  const columns = Math.min(
    Math.max(1, Math.floor(maxColumns)),
    Math.ceil(Math.sqrt(nodes.length)),
  );
  const rows = Math.ceil(nodes.length / columns);
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: rows }, () => 0);
  nodes.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, node.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, node.height);
  });
  const columnOffsets: number[] = [];
  const rowOffsets: number[] = [];
  let width = 0;
  let height = 0;
  for (const columnWidth of columnWidths) {
    if (columnOffsets.length > 0) width += gap;
    columnOffsets.push(width);
    width += columnWidth;
  }
  for (const rowHeight of rowHeights) {
    if (rowOffsets.length > 0) height += gap;
    rowOffsets.push(height);
    height += rowHeight;
  }
  const offsets = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    offsets.set(node.id, {
      x: columnOffsets[column] ?? 0,
      y: rowOffsets[row] ?? 0,
    });
  });
  return { width, height, offsets };
}

function tidyLayoutBlock(
  source: TidyCanvasRect,
  results: readonly TidyCanvasRect[],
  direction: CanvasLayoutDirection,
  resultGap: number,
  gridGap: number,
  maxResultColumns: number,
): TidyLayoutBlock {
  if (results.length === 0)
    return {
      id: source.id,
      source,
      width: source.width,
      height: source.height,
      offsets: new Map([[source.id, { x: 0, y: 0 }]]),
    };

  const grid = packedCanvasRectGrid(results, gridGap, maxResultColumns);
  const horizontal = direction === "horizontal";
  const width = horizontal
    ? source.width + resultGap + grid.width
    : Math.max(source.width, grid.width);
  const height = horizontal
    ? Math.max(source.height, grid.height)
    : source.height + resultGap + grid.height;
  const gridX = horizontal
    ? source.width + resultGap
    : (width - grid.width) / 2;
  const gridY = horizontal
    ? (height - grid.height) / 2
    : source.height + resultGap;
  const offsets = new Map<string, { x: number; y: number }>([
    [
      source.id,
      {
        x: horizontal ? 0 : (width - source.width) / 2,
        y: horizontal ? (height - source.height) / 2 : 0,
      },
    ],
  ]);
  results.forEach((result) => {
    const offset = grid.offsets.get(result.id) ?? { x: 0, y: 0 };
    offsets.set(result.id, {
      x: gridX + offset.x,
      y: gridY + offset.y,
    });
  });
  return { id: source.id, source, width, height, offsets };
}

function tidyConnectedComponent(
  componentBlocks: readonly TidyLayoutBlock[],
  direction: CanvasLayoutDirection,
  outgoing: ReadonlyMap<string, ReadonlySet<string>>,
  incoming: ReadonlyMap<string, ReadonlySet<string>>,
  nodeById: ReadonlyMap<string, TidyCanvasRect>,
  nodeOrder: ReadonlyMap<string, number>,
  layerGap: number,
  nodeGap: number,
): TidyComponentLayout {
  const componentIds = new Set(componentBlocks.map((block) => block.id));
  const horizontal = direction === "horizontal";
  const originalMainPosition = (block: TidyLayoutBlock) =>
    horizontal ? block.source.position.x : block.source.position.y;
  const originalCrossPosition = (block: TidyLayoutBlock) =>
    horizontal ? block.source.position.y : block.source.position.x;
  const stableBlockOrder = (left: TidyLayoutBlock, right: TidyLayoutBlock) =>
    originalCrossPosition(left) - originalCrossPosition(right) ||
    (nodeOrder.get(left.id) ?? 0) - (nodeOrder.get(right.id) ?? 0);

  const blockById = new Map(
    componentBlocks.map((block) => [block.id, block] as const),
  );
  const indegree = new Map(
    componentBlocks.map((block) => [
      block.id,
      Array.from(incoming.get(block.id) ?? []).filter((id) =>
        componentIds.has(id),
      ).length,
    ]),
  );
  const rank = new Map<string, number>();
  const queue = componentBlocks
    .filter((block) => (indegree.get(block.id) ?? 0) === 0)
    .sort(stableBlockOrder)
    .map((block) => block.id);
  const processed = new Set<string>();
  while (queue.length > 0) {
    const sourceId = queue.shift()!;
    processed.add(sourceId);
    const sourceRank = rank.get(sourceId) ?? 0;
    for (const targetId of outgoing.get(sourceId) ?? []) {
      if (!componentIds.has(targetId)) continue;
      rank.set(targetId, Math.max(rank.get(targetId) ?? 0, sourceRank + 1));
      const nextIndegree = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, nextIndegree);
      if (nextIndegree === 0) {
        queue.push(targetId);
        queue.sort((left, right) =>
          stableBlockOrder(blockById.get(left)!, blockById.get(right)!),
        );
      }
    }
  }

  // Workflows should normally be acyclic. If old canvas data contains a
  // cycle, keep every card usable by placing the unresolved cycle in its
  // current visual order instead of collapsing all of it into one layer.
  if (processed.size < componentBlocks.length) {
    const remaining = componentBlocks
      .filter((block) => !processed.has(block.id))
      .sort(
        (left, right) =>
          originalMainPosition(left) - originalMainPosition(right) ||
          stableBlockOrder(left, right),
      );
    let fallbackRank =
      Math.max(0, ...Array.from(rank.values())) + (processed.size > 0 ? 1 : 0);
    for (const block of remaining) {
      rank.set(block.id, fallbackRank);
      fallbackRank += 1;
    }
  }

  const blocksByLayer = new Map<number, TidyLayoutBlock[]>();
  for (const block of componentBlocks) {
    const layer = rank.get(block.id) ?? 0;
    const layerBlocks = blocksByLayer.get(layer) ?? [];
    layerBlocks.push(block);
    blocksByLayer.set(layer, layerBlocks);
  }
  const layerNumbers = Array.from(blocksByLayer.keys()).sort(
    (left, right) => left - right,
  );
  for (const layer of layerNumbers)
    blocksByLayer.get(layer)!.sort(stableBlockOrder);

  // A pair of barycentric sweeps keeps branches that share a parent or child
  // adjacent, which greatly reduces crossed and needlessly long connections.
  const orderInLayer = new Map<string, number>();
  const rememberLayerOrder = (layer: number) => {
    blocksByLayer
      .get(layer)
      ?.forEach((block, index) => orderInLayer.set(block.id, index));
  };
  for (const layer of layerNumbers) {
    const layerBlocks = blocksByLayer.get(layer)!;
    if (layer > layerNumbers[0]!) {
      layerBlocks.sort((left, right) => {
        const score = (block: TidyLayoutBlock) => {
          const values = Array.from(incoming.get(block.id) ?? [])
            .filter((id) => (rank.get(id) ?? layer) < layer)
            .map((id) => orderInLayer.get(id))
            .filter((value): value is number => value !== undefined);
          return values.length > 0
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : Number.POSITIVE_INFINITY;
        };
        return score(left) - score(right) || stableBlockOrder(left, right);
      });
    }
    rememberLayerOrder(layer);
  }
  for (let index = layerNumbers.length - 1; index >= 0; index -= 1) {
    const layer = layerNumbers[index]!;
    const layerBlocks = blocksByLayer.get(layer)!;
    if (index < layerNumbers.length - 1) {
      layerBlocks.sort((left, right) => {
        const score = (block: TidyLayoutBlock) => {
          const values = Array.from(outgoing.get(block.id) ?? [])
            .filter((id) => (rank.get(id) ?? layer) > layer)
            .map((id) => orderInLayer.get(id))
            .filter((value): value is number => value !== undefined);
          return values.length > 0
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : Number.POSITIVE_INFINITY;
        };
        return score(left) - score(right) || stableBlockOrder(left, right);
      });
    }
    rememberLayerOrder(layer);
  }

  const layerMetrics = layerNumbers.map((layer) => {
    const layerBlocks = blocksByLayer.get(layer)!;
    return {
      layer,
      blocks: layerBlocks,
      mainSize: Math.max(
        ...layerBlocks.map((block) =>
          horizontal ? block.width : block.height,
        ),
      ),
      crossSize:
        layerBlocks.reduce(
          (sum, block) => sum + (horizontal ? block.height : block.width),
          0,
        ) +
        nodeGap * Math.max(0, layerBlocks.length - 1),
    };
  });
  const mainSize =
    layerMetrics.reduce((sum, metric) => sum + metric.mainSize, 0) +
    layerGap * Math.max(0, layerMetrics.length - 1);
  const crossSize = Math.max(...layerMetrics.map((metric) => metric.crossSize));
  const offsets = new Map<string, { x: number; y: number }>();
  let mainCursor = 0;
  for (const metric of layerMetrics) {
    let crossCursor = (crossSize - metric.crossSize) / 2;
    for (const block of metric.blocks) {
      const blockX = horizontal
        ? mainCursor + (metric.mainSize - block.width) / 2
        : crossCursor;
      const blockY = horizontal
        ? crossCursor
        : mainCursor + (metric.mainSize - block.height) / 2;
      for (const [nodeId, offset] of block.offsets) {
        if (!nodeById.has(nodeId)) continue;
        offsets.set(nodeId, {
          x: blockX + offset.x,
          y: blockY + offset.y,
        });
      }
      crossCursor += (horizontal ? block.height : block.width) + nodeGap;
    }
    mainCursor += metric.mainSize + layerGap;
  }

  const componentNodes = Array.from(offsets.keys())
    .map((id) => nodeById.get(id))
    .filter((node): node is TidyCanvasRect => node !== undefined);
  return {
    id: componentBlocks[0]!.id,
    width: horizontal ? mainSize : crossSize,
    height: horizontal ? crossSize : mainSize,
    originalX: Math.min(...componentNodes.map((node) => node.position.x)),
    originalY: Math.min(...componentNodes.map((node) => node.position.y)),
    offsets,
  };
}

/**
 * Lay out each connected workflow independently, then pack unrelated
 * workflows into a stable grid. Generated results stay beside their source.
 * The returned positions are display coordinates only; callers decide how
 * and when to persist them.
 */
export function tidyCanvasRectPositions(
  nodes: readonly TidyCanvasRect[],
  edges: readonly TidyCanvasEdge[],
  direction: CanvasLayoutDirection = preferredCanvasLayoutDirection(
    nodes,
    edges,
  ),
  options: TidyCanvasOptions = {},
): Map<string, { x: number; y: number }> {
  const positions = new Map(
    nodes.map((node) => [node.id, { ...node.position }] as const),
  );
  if (nodes.length < 2) return positions;

  const layerGap = options.layerGap ?? 160;
  const nodeGap = options.nodeGap ?? 88;
  const resultGap = options.resultGap ?? 48;
  const gridGap = options.resultGridGap ?? 24;
  const maxResultColumns = options.maxResultColumns ?? 3;
  const componentGap = options.componentGap ?? 240;
  const maxComponentColumns = options.maxComponentColumns ?? 3;
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const ownerIds = canvasLayoutOwnerIds(nodes);
  const primaryNodes = nodes.filter(
    (node) => ownerIds.get(node.id) === node.id,
  );
  const resultsByOwner = new Map<string, TidyCanvasRect[]>();
  for (const node of nodes) {
    const ownerId = ownerIds.get(node.id);
    if (!ownerId || ownerId === node.id) continue;
    const results = resultsByOwner.get(ownerId) ?? [];
    results.push(node);
    resultsByOwner.set(ownerId, results);
  }

  const blocks = primaryNodes.map((source) =>
    tidyLayoutBlock(
      source,
      resultsByOwner.get(source.id) ?? [],
      direction,
      resultGap,
      gridGap,
      maxResultColumns,
    ),
  );
  if (blocks.length === 0) return positions;
  const blockById = new Map(blocks.map((block) => [block.id, block] as const));
  const outgoing = new Map(
    blocks.map((block) => [block.id, new Set<string>()] as const),
  );
  const incoming = new Map(
    blocks.map((block) => [block.id, new Set<string>()] as const),
  );
  const neighbors = new Map(
    blocks.map((block) => [block.id, new Set<string>()] as const),
  );
  for (const edge of edges) {
    const sourceId = ownerIds.get(edge.source);
    const targetId = ownerIds.get(edge.target);
    if (
      !sourceId ||
      !targetId ||
      sourceId === targetId ||
      !blockById.has(sourceId) ||
      !blockById.has(targetId) ||
      outgoing.get(sourceId)?.has(targetId)
    )
      continue;
    outgoing.get(sourceId)!.add(targetId);
    incoming.get(targetId)!.add(sourceId);
    neighbors.get(sourceId)!.add(targetId);
    neighbors.get(targetId)!.add(sourceId);
  }

  // Manual visual groups are treated as packing units, without adding edges
  // to the executable graph or changing the workflow's rank ordering.
  const blocksByGroup = new Map<string, string[]>();
  for (const block of blocks) {
    const groupId = block.source.canvasGroupId;
    if (!groupId) continue;
    const members = blocksByGroup.get(groupId) ?? [];
    members.push(block.id);
    blocksByGroup.set(groupId, members);
  }
  for (const members of blocksByGroup.values()) {
    const first = members[0];
    if (!first) continue;
    for (const member of members.slice(1)) {
      neighbors.get(first)?.add(member);
      neighbors.get(member)?.add(first);
    }
  }

  const blockComponents: TidyLayoutBlock[][] = [];
  const visited = new Set<string>();
  for (const block of blocks) {
    if (visited.has(block.id)) continue;
    const component: TidyLayoutBlock[] = [];
    const stack = [block.id];
    visited.add(block.id);
    while (stack.length > 0) {
      const currentId = stack.pop()!;
      const current = blockById.get(currentId);
      if (current) component.push(current);
      for (const neighborId of neighbors.get(currentId) ?? []) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        stack.push(neighborId);
      }
    }
    component.sort(
      (left, right) =>
        (nodeOrder.get(left.id) ?? 0) - (nodeOrder.get(right.id) ?? 0),
    );
    blockComponents.push(component);
  }

  const horizontal = direction === "horizontal";
  const components = blockComponents
    .map((component) =>
      tidyConnectedComponent(
        component,
        direction,
        outgoing,
        incoming,
        nodeById,
        nodeOrder,
        layerGap,
        nodeGap,
      ),
    )
    .sort(
      (left, right) =>
        (horizontal
          ? left.originalY - right.originalY || left.originalX - right.originalX
          : left.originalX - right.originalX ||
            left.originalY - right.originalY) ||
        (nodeOrder.get(left.id) ?? 0) - (nodeOrder.get(right.id) ?? 0),
    );
  const originX = Math.min(...nodes.map((node) => node.position.x));
  const originY = Math.min(...nodes.map((node) => node.position.y));
  const componentCards = components.map((component) => ({
    id: component.id,
    width: horizontal ? component.width : component.height,
    height: horizontal ? component.height : component.width,
  }));
  const componentGrid = packedCanvasRectGrid(
    componentCards,
    componentGap,
    maxComponentColumns,
  );
  for (const component of components) {
    const packedOffset = componentGrid.offsets.get(component.id) ?? {
      x: 0,
      y: 0,
    };
    const componentX = originX + (horizontal ? packedOffset.x : packedOffset.y);
    const componentY = originY + (horizontal ? packedOffset.y : packedOffset.x);
    for (const [nodeId, offset] of component.offsets) {
      positions.set(nodeId, {
        x: componentX + offset.x,
        y: componentY + offset.y,
      });
    }
  }
  return positions;
}

export function closestAvailableResultPosition(
  source: PositionedCanvasRect,
  result: { width: number; height: number },
  occupied: readonly PositionedCanvasRect[],
  options: { sourceGap?: number; collisionGap?: number } = {},
): { x: number; y: number } {
  const sourceGap = options.sourceGap ?? 24;
  const collisionGap = options.collisionGap ?? 16;
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
    candidateYs.add(node.position.y + node.height + collisionGap);
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
    const distance = Math.abs(left - preferredY) - Math.abs(right - preferredY);
    if (Math.abs(distance) > 0.5) return distance;
    const leftIsBelow = left >= preferredY;
    const rightIsBelow = right >= preferredY;
    if (leftIsBelow !== rightIsBelow) return leftIsBelow ? -1 : 1;
    return left - right;
  });

  return { x, y: candidates.find((y) => !overlapsAt(y)) ?? preferredY };
}

export function closestAvailableVerticalPosition(
  anchor: PositionedCanvasRect,
  result: { width: number; height: number },
  occupied: readonly PositionedCanvasRect[],
  gap = 16,
): { x: number; y: number } {
  const x = anchor.position.x + (anchor.width - result.width) / 2;
  const belowAnchor = anchor.position.y + anchor.height + gap;
  const aboveAnchor = anchor.position.y - result.height - gap;
  const horizontallyRelevant = occupied.filter(
    (node) =>
      !(
        x + result.width + gap <= node.position.x ||
        x >= node.position.x + node.width + gap
      ),
  );
  const candidateYs = new Set([belowAnchor, aboveAnchor]);
  for (const node of horizontallyRelevant) {
    candidateYs.add(node.position.y + node.height + gap);
    candidateYs.add(node.position.y - result.height - gap);
  }

  const overlapsAt = (y: number) =>
    horizontallyRelevant.some(
      (node) =>
        !(
          y + result.height + gap <= node.position.y ||
          y >= node.position.y + node.height + gap
        ),
    );
  const distanceFromAnchor = (y: number) =>
    y >= anchor.position.y + anchor.height
      ? y - (anchor.position.y + anchor.height)
      : y + result.height <= anchor.position.y
        ? anchor.position.y - (y + result.height)
        : Number.POSITIVE_INFINITY;
  const candidates = Array.from(candidateYs).sort((left, right) => {
    const distance = distanceFromAnchor(left) - distanceFromAnchor(right);
    if (Math.abs(distance) > 0.5) return distance;
    const leftIsBelow = left >= anchor.position.y + anchor.height;
    const rightIsBelow = right >= anchor.position.y + anchor.height;
    if (leftIsBelow !== rightIsBelow) return leftIsBelow ? -1 : 1;
    return left - right;
  });

  return { x, y: candidates.find((y) => !overlapsAt(y)) ?? belowAnchor };
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

interface BrowserTextSelection {
  readonly rangeCount: number;
  readonly isCollapsed: boolean;
  toString(): string;
}

export function hasSelectedBrowserText(
  selection: BrowserTextSelection | null | undefined,
): boolean {
  return Boolean(
    selection &&
    selection.rangeCount > 0 &&
    !selection.isCollapsed &&
    selection.toString().length > 0,
  );
}

export function shouldPersistNodeChanges(
  changes: readonly {
    type: string;
    dragging?: unknown;
    resizing?: unknown;
  }[],
): boolean {
  return changes.some((change) => {
    if (change.type === "remove") return true;
    if (change.type === "position") {
      return typeof change.dragging === "boolean";
    }
    if (change.type === "dimensions") {
      return typeof change.resizing === "boolean";
    }
    return false;
  });
}
