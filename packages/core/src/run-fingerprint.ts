import { selectRunNodeIds } from "./graph.js";
import type { RunScope, WorkflowEdge, WorkflowGraph, WorkflowNode } from "./types.js";

export interface RunFingerprintScope {
  readonly scope: RunScope;
  readonly nodeId?: string;
  readonly nodeIds?: readonly string[];
}

// These React Flow fields only affect presentation/interaction. Unknown fields,
// including every node.data field, stay in the fingerprint deliberately.
const nodeUiKeys = new Set([
  "position", "positionAbsolute", "width", "height", "initialWidth", "initialHeight",
  "measured", "style", "selected", "dragging", "resizing", "hidden", "zIndex",
  "focusable", "draggable", "selectable", "connectable", "deletable", "parentId",
  "extent", "expandParent", "origin", "sourcePosition", "targetPosition", "className",
  "domAttributes", "ariaLabel", "ariaRole",
]);

const edgeUiKeys = new Set([
  "style", "selected", "animated", "hidden", "zIndex", "focusable", "selectable",
  "deletable", "reconnectable", "className", "domAttributes", "ariaLabel", "ariaRole",
  "label", "labelStyle", "labelShowBg", "labelBgStyle", "labelBgPadding",
  "labelBgBorderRadius", "markerStart", "markerEnd", "interactionWidth",
]);

function withoutUiFields(value: object, excluded: ReadonlySet<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)));
}

function isGeneratedResultFeedback(edge: WorkflowEdge, target: WorkflowNode | undefined): boolean {
  return target?.data?.["generatedResult"] === true &&
    target.data["generatedFromNodeId"] === edge.source;
}

function referencedStrings(nodes: readonly WorkflowNode[]): ReadonlySet<string> {
  const strings = new Set<string>();
  const visited = new Set<object>();
  const pending: unknown[] = nodes.map((node) => node.data);
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      strings.add(value);
    } else if (typeof value === "object" && value !== null && !visited.has(value)) {
      visited.add(value);
      pending.push(...Object.values(value));
    }
  }
  return strings;
}

function referenceAspectRatioContext(
  graph: WorkflowGraph,
  relevantNodes: readonly WorkflowNode[],
): readonly { assetId: string; mediaAspectRatio: number }[] {
  // Runtime's referenceAspectRatio() finds the first node with a matching
  // data.assetId across the whole graph, including nodes outside the dependency
  // closure. Capture that existing request context without pulling unrelated
  // node models, result status or other data into the fingerprint. Collecting
  // every referenced string conservatively covers prompt assets, masks, output
  // asset arrays and future execution fields without a fragile asset whitelist.
  const candidates = referencedStrings(relevantNodes);
  const seen = new Set<string>();
  const context: { assetId: string; mediaAspectRatio: number }[] = [];
  for (const node of graph.nodes) {
    const assetId = node.data?.["assetId"];
    if (typeof assetId !== "string" || !candidates.has(assetId) || seen.has(assetId)) continue;
    seen.add(assetId);
    const ratio = node.data?.["mediaAspectRatio"];
    // Missing and nonnumeric first-match ratios both produce no inferred ratio
    // in runtime. Keep that equivalence when there is no first match at all.
    if (typeof ratio === "number") context.push({ assetId, mediaAspectRatio: ratio });
  }
  return context.sort((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0);
}

/**
 * Canonical JSON, rather than a short hash: equality cannot hide a changed paid
 * request behind a hash collision. Object key order is immaterial; array order
 * (notably prompt parts and incoming reference edges) remains significant.
 * Unsupported/cyclic values fail closed instead of silently disappearing.
 */
function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Run fingerprint requires JSON-serializable execution data");
  }
  if (ancestors.has(value)) throw new TypeError("Run fingerprint cannot contain cyclic data");
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Run fingerprint requires plain JSON objects");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${Array.from(value, (entry) => entry === undefined ? "null" : canonicalJson(entry, ancestors)).join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Identify all graph content that can affect this run: the same execution scope
 * as runtime plus every upstream dependency. Generated result display feedback
 * links are ignored just as they are by core scheduling; the result asset and
 * its data remain included whenever it is itself selected or used as input.
 *
 * Graph viewport/drawings and known React Flow UI fields are excluded. All data,
 * port definitions, edge aliases and unknown fields are retained conservatively.
 * The first-match media ratio for referenced asset ids is also captured because
 * runtime currently resolves that value from the entire graph.
 */
export function runFingerprint(graph: WorkflowGraph, selection: RunFingerprintScope): string {
  const nodeMap = new Map<string, WorkflowNode>();
  for (const node of graph.nodes) {
    if (nodeMap.has(node.id)) throw new TypeError(`Duplicate workflow node: ${node.id}`);
    nodeMap.set(node.id, node);
  }
  const executionNodeIds = selectRunNodeIds(
    graph, selection.scope, selection.nodeId, selection.nodeIds,
  );
  const incoming = new Map<string, WorkflowEdge[]>();
  for (const edge of graph.edges) {
    if (isGeneratedResultFeedback(edge, nodeMap.get(edge.target))) continue;
    const edges = incoming.get(edge.target) ?? [];
    edges.push(edge);
    incoming.set(edge.target, edges);
  }
  const relevant = new Set<string>();
  const pending = [...executionNodeIds];
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    if (relevant.has(nodeId)) continue;
    if (!nodeMap.has(nodeId)) throw new RangeError(`Unknown workflow node: ${nodeId}`);
    relevant.add(nodeId);
    for (const edge of incoming.get(nodeId) ?? []) pending.push(edge.source);
  }

  const relevantNodes = graph.nodes.filter((node) => relevant.has(node.id));
  return canonicalJson({
    version: 1,
    scope: selection.scope,
    executionNodeIds,
    // Preserve order conservatively: runtime can find the first node referring
    // to an asset when inferring its media ratio.
    nodes: relevantNodes.map((node) => withoutUiFields(node, nodeUiKeys)),
    referenceAspectRatios: referenceAspectRatioContext(graph, relevantNodes),
    // Runtime incoming() consumes edges in stored order, so never sort edges.
    edges: graph.edges.filter((edge) => relevant.has(edge.source) && relevant.has(edge.target) &&
      !isGeneratedResultFeedback(edge, nodeMap.get(edge.target)))
      .map((edge) => withoutUiFields(edge, edgeUiKeys)),
  });
}
