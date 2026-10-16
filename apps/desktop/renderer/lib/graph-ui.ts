import { arePortKindsCompatible, type PortKind } from "@super-canvas/core";
import { modelSupportsGenerationMedia } from "@super-canvas/providers/model-media";
import type {
  ModelDescriptor,
  ProviderOperation,
} from "@super-canvas/providers";

export type GenerationNodeType = "image-generation" | "video-generation" | "music-generation";
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
  { nodeType: "music-generation", targetHandle: "prompt", targetKind: "text", sourceKinds: ["text"], label: "音乐生成" },
  { nodeType: "preview", targetHandle: "audio", targetKind: "audio[]", sourceKinds: ["audio", "audio[]"], label: "结果预览" },
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
    "music.generate",
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
    "music.generate",
    "image.generate",
    "image.edit",
    "video.generate",
    "video.image-to-video",
  ],
  cli: ["image.generate", "image.edit", "video.generate", "video.image-to-video"],
};

function operationsForNodeType(
  nodeType: GenerationNodeType,
): readonly ProviderOperation[] {
  return nodeType === "image-generation"
    ? ["image.generate", "image.edit"]
    : nodeType === "music-generation" ? ["music.generate"] : ["video.generate", "video.image-to-video"];
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
  model: Pick<ModelDescriptor, "operations"> &
    Partial<Pick<ModelDescriptor, "id" | "metadata" | "outputKinds">>,
  nodeType: GenerationNodeType,
): boolean {
  return modelSupportsGenerationMedia(model, nodeType === "music-generation" ? "music" : nodeType === "image-generation" ? "image" : "video");
}

/** Filter a connection by its declared output models, not the generic REST adapter. */
export function connectionSupportsNodeType(
  connection: { provider: string; config: Readonly<Record<string, unknown>> },
  nodeType: GenerationNodeType,
  models: readonly ModelDescriptor[],
): boolean {
  if (models.length) return models.some(model => modelSupportsNodeType(model, nodeType));
  if (["empty", "unauthorized"].includes(String(connection.config.modelScanStatus))) return false;
  if (Array.isArray(connection.config.modelCatalogModels)) return false;
  const connector = connection.config.connector as { output?: { kind?: string } } | undefined;
  const output = connector?.output?.kind;
  if (output === "audio") return false;
  if (output === "image" || output === "video") return nodeType === `${output}-generation`;
  // An unread generic REST connection must not appear in both selectors.
  return connection.provider !== "rest" && connection.provider !== "cli" && providerSupportsNodeType(connection.provider, nodeType);
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

export interface TidyCanvasRect extends PositionedCanvasRect {
  generatedFromNodeId?: string;
  canvasGroupId?: string;
  nodeType?: string;
  selected?: boolean;
  /** Handle centers relative to the node, measured by React Flow. */
  portCenters?: {
    source: readonly { id: string; y: number }[];
    target: readonly { id: string; y: number }[];
  };
}

export interface TidyCanvasEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface TidyCanvasOptions {
  layerGap?: number;
  nodeGap?: number;
  resultGap?: number;
  resultGridGap?: number;
  maxResultColumns?: number;
  componentGap?: number;
  viewportWidth?: number;
  /** Available screen height; omitted callers retain legacy row packing. */
  viewportHeight?: number;
  selectedIds?: readonly string[];
}

type CanvasPoint = { x: number; y: number };
interface TidyLayoutBlock {
  id: string;
  source: TidyCanvasRect;
  members: readonly TidyCanvasRect[];
  width: number;
  height: number;
  offsets: Map<string, CanvasPoint>;
}
interface TidyComponentLayout {
  id: string;
  width: number;
  height: number;
  originalX: number;
  originalY: number;
  offsets: Map<string, CanvasPoint>;
}
export interface PackedCanvasRectGrid {
  width: number;
  height: number;
  offsets: Map<string, CanvasPoint>;
}

/** Pack mixed-size cards in input order without changing their dimensions. */
export function packedCanvasRectGrid(
  nodes: readonly Pick<PositionedCanvasRect, "id" | "width" | "height">[],
  gap = 24,
  maxColumns = 3,
): PackedCanvasRectGrid {
  if (!nodes.length) return { width: 0, height: 0, offsets: new Map() };
  const columns = Math.min(Math.max(1, Math.floor(maxColumns)), Math.ceil(Math.sqrt(nodes.length)));
  const rows = Math.ceil(nodes.length / columns);
  const widths = Array<number>(columns).fill(0), heights = Array<number>(rows).fill(0);
  nodes.forEach((node, index) => {
    widths[index % columns] = Math.max(widths[index % columns]!, node.width);
    heights[Math.floor(index / columns)] = Math.max(heights[Math.floor(index / columns)]!, node.height);
  });
  const xs: number[] = [], ys: number[] = [];
  let width = 0, height = 0;
  for (const value of widths) { xs.push(width); width += value + gap; }
  for (const value of heights) { ys.push(height); height += value + gap; }
  return { width: width - gap, height: height - gap,
    offsets: new Map(nodes.map((node, index) => [node.id, {
      x: xs[index % columns]!, y: ys[Math.floor(index / columns)]!,
    }])) };
}

const layoutGrid = (value: number) => Math.round(value / 8) * 8;
const layoutExtent = (value: number) => Math.ceil(value / 8) * 8;
const median = (values: number[]) => {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
};

/** Translate whole workflows only; their port/group geometry stays untouched. */
function packTidyWorkflowRows(
  components: readonly TidyComponentLayout[],
  cards: readonly Pick<PositionedCanvasRect, "id" | "width" | "height">[],
  maxWidth: number,
  componentGap: number,
  nodeGap: number,
  viewportWidth: number,
  viewportHeight?: number,
) {
  const maximumCardWidth = Math.max(0, ...cards.map(card => card.width));
  const pack = (rowWidth: number) => {
    const offsets = new Map<string, CanvasPoint>();
    let x = 0, y = 0, rowHeight = 0, bottom = 0, right = 0;
    for (const component of components) {
      if (x && x + component.width > rowWidth) {
        x = 0; y += layoutExtent(rowHeight) + componentGap; rowHeight = 0;
      }
      offsets.set(component.id, { x, y });
      right = Math.max(right, x + component.width);
      x += layoutExtent(component.width) + componentGap;
      rowHeight = Math.max(rowHeight, component.height);
      bottom = Math.max(bottom, y + component.height);
    }
    // The unconnected region belongs in the scored bounds. It remains last,
    // left aligned and no wider than the packed workflows beside it.
    const trayWidth = components.length ? Math.min(rowWidth, right) : rowWidth;
    const columns = Math.max(1, Math.floor((trayWidth + nodeGap) / (maximumCardWidth + nodeGap)));
    const tray = packedCanvasRectGrid(cards, nodeGap, columns);
    const trayY = cards.length && components.length ? layoutExtent(bottom) + Math.min(componentGap, 80) : 0;
    return { offsets, tray, trayY, width: Math.max(right, tray.width),
      height: Math.max(bottom, cards.length ? trayY + tray.height : 0) };
  };
  const legacy = pack(maxWidth);
  if (!Number.isFinite(viewportHeight) || !viewportHeight || viewportHeight <= 0 ||
      !Number.isFinite(viewportWidth) || viewportWidth <= 0) return legacy;

  // A shelf's arrangement changes at contiguous-workflow width thresholds.
  // Sample at most 32 deterministic thresholds, including both extremes, so
  // many disconnected workflows do not turn packing into a combinatorial job.
  const widths = new Set<number>([maxWidth]);
  for (let first = 0; first < components.length; first++) {
    let width = 0;
    for (let last = first; last < components.length; last++) {
      width += (last > first ? componentGap : 0) + layoutExtent(components[last]!.width);
      if (width > maxWidth) break;
      widths.add(width);
    }
  }
  for (let columns = 1; columns <= Math.ceil(Math.sqrt(cards.length)); columns++) {
    const width = columns * (maximumCardWidth + nodeGap) - nodeGap;
    if (width > 0 && width <= maxWidth) widths.add(width);
  }
  const sorted = [...widths].sort((a, b) => a - b);
  const candidates = sorted.length <= 32 ? sorted
    : Array.from({ length: 32 }, (_, index) => sorted[Math.round(index * (sorted.length - 1) / 31)]!);
  const score = (layout: ReturnType<typeof pack>) => [
    Math.max(layout.width / viewportWidth, layout.height / viewportHeight),
    layout.width * layout.height,
    layout.width,
  ];
  let best = legacy, bestScore = score(legacy);
  for (const width of candidates) {
    const candidate = pack(width), candidateScore = score(candidate);
    const difference = candidateScore.findIndex((value, index) => Math.abs(value - bestScore[index]!) > 1e-9);
    if (difference >= 0 && candidateScore[difference]! < bestScore[difference]!) {
      best = candidate; bestScore = candidateScore;
    }
  }
  return best;
}

function layoutPortY(node: TidyCanvasRect, direction: "source" | "target", handle: string | null | undefined): number {
  const ports = node.portCenters?.[direction];
  // React Flow uses the first handle only when the edge has no explicit id.
  const port = handle == null ? ports?.[0] : ports?.find(port => port.id === handle);
  return port && Number.isFinite(port.y) ? port.y : node.height / 2;
}

/** Preserve manual groups as rigid blocks; attach only ungrouped results. */
function tidyLayoutBlocks(nodes: readonly TidyCanvasRect[], edges: readonly TidyCanvasEdge[], resultGap: number, gridGap: number, resultColumns: number) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const parents = new Map(nodes.map(node => [node.id, node.id]));
  const root = (id: string): string => {
    const parent = parents.get(id)!;
    if (parent === id) return id;
    const owner = root(parent);
    parents.set(id, owner);
    return owner;
  };
  const unite = (a: string, b: string) => {
    const left = root(a), right = root(b);
    if (left === right) return;
    if (order.get(left)! < order.get(right)!) parents.set(right, left);
    else parents.set(left, right);
  };
  const groupRoots = new Map<string, string>();
  for (const node of nodes) {
    if (!node.canvasGroupId) continue;
    const first = groupRoots.get(node.canvasGroupId);
    if (first) unite(first, node.id);
    else groupRoots.set(node.canvasGroupId, node.id);
  }
  const attachments = new Map<string, string>();
  for (const node of nodes) {
    if (node.canvasGroupId || !node.generatedFromNodeId) continue;
    let source = byId.get(node.generatedFromNodeId);
    const seen = new Set([node.id]);
    while (source?.generatedFromNodeId && !source.canvasGroupId && !seen.has(source.id)) {
      const next = byId.get(source.generatedFromNodeId);
      if (!next) break;
      seen.add(source.id);
      source = next;
    }
    if (!source || seen.has(source.id)) continue;
    attachments.set(node.id, source.id);
    unite(node.id, source.id);
  }
  const members = new Map<string, TidyCanvasRect[]>();
  for (const node of nodes) {
    const id = root(node.id), group = members.get(id) ?? [];
    group.push(node); members.set(id, group);
  }
  const blocks: TidyLayoutBlock[] = [];
  for (const [id, items] of members) {
    const base = items.filter(node => !attachments.has(node.id));
    const left = Math.min(...base.map(node => node.position.x));
    const top = Math.min(...base.map(node => node.position.y));
    const baseWidth = Math.max(...base.map(node => node.position.x - left + node.width));
    const offsets = new Map(base.map(node => [node.id, { x: node.position.x - left, y: node.position.y - top }]));
    const resultsByOwner = new Map<string, TidyCanvasRect[]>();
    for (const node of items) {
      const owner = attachments.get(node.id);
      if (!owner) continue;
      const results = resultsByOwner.get(owner) ?? [];
      results.push(node); resultsByOwner.set(owner, results);
    }
    let gridBottom = -Infinity;
    const owners = [...resultsByOwner.keys()].sort((a, b) => offsets.get(a)!.y - offsets.get(b)!.y || order.get(a)! - order.get(b)!);
    for (const owner of owners) {
      const source = byId.get(owner)!, sourceOffset = offsets.get(owner)!;
      const results = resultsByOwner.get(owner)!;
      const grid = packedCanvasRectGrid(results.map(result => ({ id: result.id,
        width: layoutExtent(result.width), height: layoutExtent(result.height) })), gridGap, resultColumns);
      const gridX = layoutExtent(baseWidth + resultGap);
      const connectedOffsets = results.flatMap(result => edges.filter(edge =>
        (source.portCenters || result.portCenters) && edge.source === owner && edge.target === result.id)
        .map(edge => sourceOffset.y + layoutPortY(source, "source", edge.sourceHandle) -
          grid.offsets.get(result.id)!.y - layoutPortY(result, "target", edge.targetHandle)));
      const preferredY = connectedOffsets.length ? median(connectedOffsets) :
        layoutGrid(sourceOffset.y + source.height / 2 - grid.height / 2);
      const gridY = Math.max(preferredY, gridBottom + gridGap);
      for (const result of results) {
        const offset = grid.offsets.get(result.id)!;
        offsets.set(result.id, { x: gridX + offset.x, y: gridY + offset.y });
      }
      gridBottom = gridY + grid.height;
    }
    const minY = Math.min(...[...offsets.values()].map(point => point.y));
    if (minY) for (const point of offsets.values()) point.y -= minY;
    const width = Math.max(...items.map(node => offsets.get(node.id)!.x + node.width));
    const height = Math.max(...items.map(node => offsets.get(node.id)!.y + node.height));
    blocks.push({ id, source: base[0]!, members: items, width, height, offsets });
  }
  return { blocks, ownerIds: new Map(nodes.map(node => [node.id, root(node.id)])) };
}

/** Project desired Y positions onto the current order with the minimum gap. */
function separateLayoutLayer(blocks: readonly TidyLayoutBlock[], desired: readonly number[], gap: number): number[] {
  const prefixes: number[] = [];
  let prefix = 0;
  const pools: Array<{ start: number; end: number; total: number; count: number }> = [];
  blocks.forEach((block, index) => {
    prefixes.push(prefix);
    pools.push({ start: index, end: index, total: desired[index]! - prefix, count: 1 });
    while (pools.length > 1) {
      const a = pools[pools.length - 2]!, b = pools[pools.length - 1]!;
      if (a.total / a.count <= b.total / b.count) break;
      pools.splice(-2, 2, { start: a.start, end: b.end, total: a.total + b.total, count: a.count + b.count });
    }
    prefix += layoutExtent(block.height) + gap;
  });
  const result: number[] = [];
  for (const pool of pools) for (let index = pool.start; index <= pool.end; index++)
    result[index] = pool.total / pool.count + prefixes[index]!;
  return result;
}

interface TidyPortLink { source: string; target: string; deltaY: number }

function tidyConnectedComponent(blocks: readonly TidyLayoutBlock[], outgoing: ReadonlyMap<string, ReadonlySet<string>>,
  incoming: ReadonlyMap<string, ReadonlySet<string>>, portLinks: readonly TidyPortLink[], nodeOrder: ReadonlyMap<string, number>, layerGap: number, nodeGap: number): TidyComponentLayout {
  const compare = (a: string, b: string) => nodeOrder.get(a)! - nodeOrder.get(b)!;
  const ranks = new Map(blocks.map(block => [block.id, 0]));
  const degrees = new Map(blocks.map(block => [block.id, incoming.get(block.id)!.size]));
  const remaining = new Set(blocks.map(block => block.id));
  const queue = blocks.filter(block => !degrees.get(block.id)).map(block => block.id).sort(compare);
  while (remaining.size) {
    // A deterministic cycle break keeps legacy cyclic graphs finite and usable.
    if (!queue.length) queue.push([...remaining].sort(compare)[0]!);
    const id = queue.shift()!;
    if (!remaining.delete(id)) continue;
    for (const target of outgoing.get(id)!) {
      if (!remaining.has(target)) continue;
      ranks.set(target, Math.max(ranks.get(target)!, ranks.get(id)! + 1));
      degrees.set(target, degrees.get(target)! - 1);
      if (!degrees.get(target)) queue.push(target);
    }
    queue.sort(compare);
  }
  // Sources entering a deeper join belong directly before their first child.
  for (const block of blocks) if (!incoming.get(block.id)!.size && outgoing.get(block.id)!.size)
    ranks.set(block.id, Math.min(...[...outgoing.get(block.id)!].map(id => ranks.get(id)!)) - 1);
  const layerNumbers = [...new Set(ranks.values())].sort((a, b) => a - b);
  let layers = layerNumbers.map(rank => blocks.filter(block => ranks.get(block.id) === rank).sort((a, b) => compare(a.id, b.id)));
  const rankIndex = new Map(layerNumbers.map((rank, index) => [rank, index]));
  const links = blocks.flatMap(block => [...outgoing.get(block.id)!].flatMap(target => {
    const start = rankIndex.get(ranks.get(block.id)!)!, end = rankIndex.get(ranks.get(target)!)!;
    return start < end ? [{ source: block.id, target, start, end }] : [];
  }));
  // Edge intervals and shared endpoints cannot change between sweeps. Avoid
  // checking disjoint columns again in all eight crossing counts.
  const crossingPairs: number[] = [];
  for (let a = 0; a < links.length; a++) for (let b = a + 1; b < links.length; b++) {
    const first = links[a]!, second = links[b]!;
    if (first.source === second.source || first.target === second.target) continue;
    const left = Math.max(first.start, second.start), right = Math.min(first.end, second.end);
    if (left < right) crossingPairs.push(a, b, left, right);
  }
  const rememberOrder = () => new Map(layers.flatMap(layer => layer.map((block, index) => [block.id, index] as const)));
  const crossings = () => {
    const order = rememberOrder();
    const points = links.map(link => ({ ...link, y1: order.get(link.source)!, y2: order.get(link.target)! }));
    let total = 0;
    for (let index = 0; index < crossingPairs.length; index += 4) {
      const a = crossingPairs[index]!, b = crossingPairs[index + 1]!;
      const left = crossingPairs[index + 2]!, right = crossingPairs[index + 3]!;
      const first = points[a]!, second = points[b]!;
      const firstSlope = (first.y2 - first.y1) / (first.end - first.start);
      const secondSlope = (second.y2 - second.y1) / (second.end - second.start);
      const leftDifference = first.y1 + firstSlope * (left - first.start) - second.y1 - secondSlope * (left - second.start);
      const rightDifference = first.y1 + firstSlope * (right - first.start) - second.y1 - secondSlope * (right - second.start);
      if (leftDifference * rightDifference < 0) total++;
    }
    return total;
  };
  let best = layers.map(layer => [...layer]), bestCrossings = crossings();
  for (let round = 0; round < 8 && bestCrossings > 0; round++) {
    const down = round % 2 === 0;
    const indices = layers.map((_, index) => index);
    if (!down) indices.reverse();
    const order = rememberOrder();
    for (const index of indices) {
      const score = (block: TidyLayoutBlock) => {
        const neighbors = [...(down ? incoming : outgoing).get(block.id)!]
          .filter(id => down ? ranks.get(id)! < ranks.get(block.id)! : ranks.get(id)! > ranks.get(block.id)!);
        return neighbors.length ? neighbors.reduce((sum, id) => sum + order.get(id)!, 0) / neighbors.length : order.get(block.id)!;
      };
      const scores = new Map(layers[index]!.map(block => [block.id, score(block)]));
      layers[index]!.sort((a, b) => scores.get(a.id)! - scores.get(b.id)! || compare(a.id, b.id));
      layers[index]!.forEach((block, position) => order.set(block.id, position));
    }
    const count = crossings();
    if (count < bestCrossings) { bestCrossings = count; best = layers.map(layer => [...layer]); }
  }
  layers = best;
  const layerHeights = layers.map(layer => layer.reduce((sum, block) => sum + layoutExtent(block.height), 0) + Math.max(0, layer.length - 1) * nodeGap);
  const fullHeight = Math.max(...layerHeights);
  const ys = new Map<string, number>();
  layers.forEach((layer, index) => {
    let y = (fullHeight - layerHeights[index]!) / 2;
    for (const block of layer) { ys.set(block.id, y); y += layoutExtent(block.height) + nodeGap; }
  });
  const entering = new Map(blocks.map(block => [block.id, [] as TidyPortLink[]]));
  const leaving = new Map(blocks.map(block => [block.id, [] as TidyPortLink[]]));
  for (const link of portLinks) {
    if (!entering.has(link.target) || !leaving.has(link.source) || ranks.get(link.source)! >= ranks.get(link.target)!) continue;
    entering.get(link.target)!.push(link);
    leaving.get(link.source)!.push(link);
  }
  for (let round = 0; round < 8; round++) {
    const down = round % 2 === 0;
    const indices = layers.map((_, index) => index);
    if (!down) indices.reverse();
    for (const index of indices) {
      const layer = layers[index]!;
      const desired = layer.map(block => {
        const adjacent = (down ? entering : leaving).get(block.id)!;
        return adjacent.length ? median(adjacent.map(link => down
          ? ys.get(link.source)! + link.deltaY
          : ys.get(link.target)! - link.deltaY)) : ys.get(block.id)!;
      });
      separateLayoutLayer(layer, desired, nodeGap).forEach((y, position) => ys.set(layer[position]!.id, y));
    }
  }
  const minY = Math.min(...ys.values()), offsets = new Map<string, CanvasPoint>();
  // A 58px input and a 50%-height output need not differ by a multiple of 8.
  // Preserve their measured alignment; only columns/component spacing snap.
  const hasPortGeometry = blocks.some(block => block.members.some(node => node.portCenters));
  let x = 0, height = 0;
  for (const layer of layers) {
    for (const block of layer) {
      const y = hasPortGeometry ? ys.get(block.id)! - minY : layoutGrid(ys.get(block.id)! - minY);
      for (const [id, offset] of block.offsets) offsets.set(id, { x: x + offset.x, y: y + offset.y });
      height = Math.max(height, y + block.height);
    }
    x += layoutExtent(Math.max(...layer.map(block => block.width))) + layerGap;
  }
  const members = blocks.flatMap(block => block.members);
  return { id: blocks[0]!.id, width: x - layerGap, height,
    originalX: Math.min(...members.map(node => node.position.x)),
    originalY: Math.min(...members.map(node => node.position.y)), offsets };
}

/** Fixed left-to-right workflow layout. Selection never expands to unselected group members. */
export function tidyCanvasRectPositions(nodes: readonly TidyCanvasRect[], edges: readonly TidyCanvasEdge[],
  options: TidyCanvasOptions = {}): Map<string, CanvasPoint> {
  const positions = new Map(nodes.map(node => [node.id, { ...node.position }]));
  const selectedIds = options.selectedIds ? new Set(options.selectedIds) : new Set(nodes.filter(node => node.selected).map(node => node.id));
  const selected = nodes.filter(node => selectedIds.has(node.id));
  const scope = selected.length >= 2 ? selected : nodes;
  if (scope.length < 2) return positions;
  const layerGap = layoutExtent(options.layerGap ?? 120), nodeGap = layoutExtent(options.nodeGap ?? 40);
  const resultGap = layoutExtent(options.resultGap ?? 24), gridGap = layoutExtent(options.resultGridGap ?? 16);
  const componentGap = layoutExtent(options.componentGap ?? 160);
  const maxWidth = Math.max(1, (options.viewportWidth ?? 1280) * 2.5);
  const nodeOrder = new Map(scope.map((node, index) => [node.id, index]));
  const { blocks, ownerIds } = tidyLayoutBlocks(scope, edges, resultGap, gridGap, options.maxResultColumns ?? 3);
  const byId = new Map(blocks.map(block => [block.id, block]));
  const nodeById = new Map(scope.map(node => [node.id, node]));
  const outgoing = new Map(blocks.map(block => [block.id, new Set<string>()]));
  const incoming = new Map(blocks.map(block => [block.id, new Set<string>()]));
  const portLinks: TidyPortLink[] = [];
  for (const edge of edges) {
    const source = ownerIds.get(edge.source), target = ownerIds.get(edge.target);
    if (!source || !target || source === target) continue;
    outgoing.get(source)!.add(target); incoming.get(target)!.add(source);
    const sourceNode = nodeById.get(edge.source)!, targetNode = nodeById.get(edge.target)!;
    portLinks.push({ source, target, deltaY:
      byId.get(source)!.offsets.get(edge.source)!.y + layoutPortY(sourceNode, "source", edge.sourceHandle) -
      byId.get(target)!.offsets.get(edge.target)!.y - layoutPortY(targetNode, "target", edge.targetHandle) });
  }
  const visited = new Set<string>(), components: TidyComponentLayout[] = [], isolated: TidyLayoutBlock[] = [];
  for (const block of blocks) {
    if (visited.has(block.id)) continue;
    if (block.members.length === 1 && !block.source.canvasGroupId && !outgoing.get(block.id)!.size && !incoming.get(block.id)!.size) {
      isolated.push(block); visited.add(block.id); continue;
    }
    const connected: TidyLayoutBlock[] = [], queue = [block.id];
    visited.add(block.id);
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index]!;
      connected.push(byId.get(id)!);
      for (const neighbor of [...outgoing.get(id)!, ...incoming.get(id)!]) if (!visited.has(neighbor)) {
        visited.add(neighbor); queue.push(neighbor);
      }
    }
    connected.sort((a, b) => nodeOrder.get(a.id)! - nodeOrder.get(b.id)!);
    components.push(tidyConnectedComponent(connected, outgoing, incoming, portLinks, nodeOrder, layerGap, nodeGap));
  }
  components.sort((a, b) => a.originalY - b.originalY || a.originalX - b.originalX || nodeOrder.get(a.id)! - nodeOrder.get(b.id)!);
  const originX = Math.min(...scope.map(node => node.position.x)), originY = Math.min(...scope.map(node => node.position.y));
  if (isolated.length) {
    const types = ["asset-input", "prompt", "image-generation", "video-generation", "music-generation", "result", "preview"];
    const type = (block: TidyLayoutBlock) => {
      const index = types.indexOf(block.source.generatedFromNodeId ? "result" : block.source.nodeType ?? "");
      return index < 0 ? types.length : index;
    };
    isolated.sort((a, b) => type(a) - type(b) || nodeOrder.get(a.id)! - nodeOrder.get(b.id)!);
  }
  const cards = isolated.map(block => ({ id: block.id, width: layoutExtent(block.width), height: layoutExtent(block.height) }));
  const packing = packTidyWorkflowRows(components, cards, maxWidth, componentGap, nodeGap,
    options.viewportWidth ?? 1280, options.viewportHeight);
  for (const component of components) {
    const placement = packing.offsets.get(component.id)!;
    for (const [id, offset] of component.offsets) positions.set(id, {
      x: originX + placement.x + offset.x, y: originY + placement.y + offset.y,
    });
  }
  for (const block of isolated) {
    const offset = packing.tray.offsets.get(block.id)!;
    positions.set(block.id, { x: originX + offset.x, y: originY + packing.trayY + offset.y });
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
  context: Omit<CanvasShortcutContext, "selectedId" | "inPromptEditor"> & {
    plainCanvasButton?: boolean;
  },
): boolean {
  return !context.editing && !context.modalOpen &&
    (!context.interactiveControl || context.plainCanvasButton === true);
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
