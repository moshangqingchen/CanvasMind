import {
  arePortsCompatible,
  getEdgeSourcePortId,
  getEdgeTargetPortId,
  getNodePorts,
  resolveNodePort,
} from "./ports.js";
import type {
  GraphValidationIssue,
  GraphValidationOptions,
  GraphValidationResult,
  RunScope,
  RunSubgraph,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from "./types.js";

const byText = (left: string, right: string): number =>
  left.localeCompare(right);

interface ConnectivityNode {
  readonly id: string;
  readonly data?: unknown;
}

interface ConnectivityGraph {
  readonly nodes: readonly ConnectivityNode[];
  readonly edges: readonly WorkflowEdge[];
}

export class GraphCycleError extends Error {
  readonly cycles: readonly (readonly string[])[];

  constructor(cycles: readonly (readonly string[])[]) {
    super(`Workflow graph contains ${cycles.length} cycle(s)`);
    this.name = "GraphCycleError";
    this.cycles = cycles;
  }
}

export class InvalidGraphError extends Error {
  readonly issues: readonly GraphValidationIssue[];

  constructor(issues: readonly GraphValidationIssue[]) {
    super(`Workflow graph is invalid (${issues.length} issue(s))`);
    this.name = "InvalidGraphError";
    this.issues = issues;
  }
}

function makeNodeMap<TNode extends { readonly id: string }>(
  nodes: readonly TNode[],
): Map<string, TNode> {
  const map = new Map<string, TNode>();
  for (const node of nodes) {
    if (!map.has(node.id)) {
      map.set(node.id, node);
    }
  }
  return map;
}

function buildAdjacency(
  graph: ConnectivityGraph,
): ReadonlyMap<string, readonly string[]> {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const nodeMap = makeNodeMap(graph.nodes);
  const adjacencySets = new Map<string, Set<string>>();

  for (const nodeId of nodeIds) {
    adjacencySets.set(nodeId, new Set());
  }

  for (const edge of graph.edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      const target = nodeMap.get(edge.target);
      if (generatedResultFeedbackTarget(target) === edge.source) {
        continue;
      }
      adjacencySets.get(edge.source)?.add(edge.target);
    }
  }

  return new Map(
    [...adjacencySets.entries()].map(([nodeId, targets]) => [
      nodeId,
      [...targets].sort(byText),
    ]),
  );
}

function generatedResultFeedbackTarget(
  node: ConnectivityNode | undefined,
): string | null {
  const data = node?.data;
  if (typeof data !== "object" || data === null) return null;
  const generatedResult = (data as Record<string, unknown>)["generatedResult"];
  const generatedFromNodeId = (data as Record<string, unknown>)[
    "generatedFromNodeId"
  ];
  return generatedResult === true && typeof generatedFromNodeId === "string"
    ? generatedFromNodeId
    : null;
}

function canonicalizeCycle(path: readonly string[]): readonly string[] {
  const core = path[0] === path.at(-1) ? path.slice(0, -1) : [...path];
  if (core.length === 0) {
    return [];
  }

  let best = core;
  let bestKey = core.join("\u0000");
  for (let index = 1; index < core.length; index += 1) {
    const rotated = [...core.slice(index), ...core.slice(0, index)];
    const key = rotated.join("\u0000");
    if (key < bestKey) {
      best = rotated;
      bestKey = key;
    }
  }

  const first = best[0];
  return first === undefined ? [] : [...best, first];
}

export function findCycles(
  graph: WorkflowGraph,
): readonly (readonly string[])[] {
  const adjacency = buildAdjacency(graph);
  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const stackIndexes = new Map<string, number>();
  const cycles = new Map<string, readonly string[]>();

  const visit = (nodeId: string): void => {
    state.set(nodeId, "visiting");
    stackIndexes.set(nodeId, stack.length);
    stack.push(nodeId);

    for (const targetId of adjacency.get(nodeId) ?? []) {
      const targetState = state.get(targetId);
      if (targetState === undefined) {
        visit(targetId);
      } else if (targetState === "visiting") {
        const startIndex = stackIndexes.get(targetId);
        if (startIndex !== undefined) {
          const cycle = canonicalizeCycle([
            ...stack.slice(startIndex),
            targetId,
          ]);
          cycles.set(cycle.join("\u0000"), cycle);
        }
      }
    }

    stack.pop();
    stackIndexes.delete(nodeId);
    state.set(nodeId, "visited");
  };

  for (const nodeId of [...adjacency.keys()].sort(byText)) {
    if (state.get(nodeId) === undefined) {
      visit(nodeId);
    }
  }

  return [...cycles.entries()]
    .sort(([left], [right]) => byText(left, right))
    .map(([, cycle]) => cycle);
}

export function hasCycle(graph: WorkflowGraph): boolean {
  return findCycles(graph).length > 0;
}

export const detectCycle = hasCycle;
export const findCyclePaths = findCycles;
export const detectCycles = findCycles;

function addPortDefinitionIssues(
  node: WorkflowNode,
  issues: GraphValidationIssue[],
): void {
  for (const direction of ["input", "output"] as const) {
    const seen = new Set<string>();
    for (const port of getNodePorts(node, direction)) {
      if (seen.has(port.id)) {
        issues.push({
          code: "duplicate_port_id",
          message: `Node ${node.id} has duplicate ${direction} port ${port.id}`,
          nodeId: node.id,
          portId: port.id,
        });
      }
      seen.add(port.id);
    }
  }
}

export function validateGraph(
  graph: WorkflowGraph,
  options: GraphValidationOptions = {},
): GraphValidationResult {
  const { checkPorts = true, checkRequiredInputs = true } = options;
  const issues: GraphValidationIssue[] = [];
  const nodeMap = makeNodeMap(graph.nodes);
  const seenNodeIds = new Set<string>();
  const seenEdgeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (seenNodeIds.has(node.id)) {
      issues.push({
        code: "duplicate_node_id",
        message: `Duplicate node id: ${node.id}`,
        nodeId: node.id,
      });
    }
    seenNodeIds.add(node.id);
    if (checkPorts) {
      addPortDefinitionIssues(node, issues);
    }
  }

  for (const edge of graph.edges) {
    if (seenEdgeIds.has(edge.id)) {
      issues.push({
        code: "duplicate_edge_id",
        message: `Duplicate edge id: ${edge.id}`,
        edgeId: edge.id,
      });
    }
    seenEdgeIds.add(edge.id);

    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (sourceNode === undefined) {
      issues.push({
        code: "dangling_source",
        message: `Edge ${edge.id} references missing source node ${edge.source}`,
        edgeId: edge.id,
        nodeId: edge.source,
      });
    }
    if (targetNode === undefined) {
      issues.push({
        code: "dangling_target",
        message: `Edge ${edge.id} references missing target node ${edge.target}`,
        edgeId: edge.id,
        nodeId: edge.target,
      });
    }
    if (edge.source === edge.target) {
      issues.push({
        code: "self_loop",
        message: `Edge ${edge.id} connects node ${edge.source} to itself`,
        edgeId: edge.id,
        nodeId: edge.source,
      });
    }

    if (!checkPorts || sourceNode === undefined || targetNode === undefined) {
      continue;
    }

    const sourcePorts = getNodePorts(sourceNode, "output");
    const targetPorts = getNodePorts(targetNode, "input");
    const sourcePortId = getEdgeSourcePortId(edge);
    const targetPortId = getEdgeTargetPortId(edge);
    const sourcePort = resolveNodePort(sourceNode, "output", sourcePortId);
    const targetPort = resolveNodePort(targetNode, "input", targetPortId);

    if (sourcePorts.length > 0 && sourcePort === undefined) {
      issues.push({
        code:
          sourcePortId === undefined
            ? "missing_source_port"
            : "unknown_source_port",
        message:
          sourcePortId === undefined
            ? `Edge ${edge.id} does not identify a source port`
            : `Edge ${edge.id} references unknown source port ${sourcePortId}`,
        edgeId: edge.id,
        nodeId: sourceNode.id,
        ...(sourcePortId === undefined ? {} : { portId: sourcePortId }),
      });
    }

    if (targetPorts.length > 0 && targetPort === undefined) {
      issues.push({
        code:
          targetPortId === undefined
            ? "missing_target_port"
            : "unknown_target_port",
        message:
          targetPortId === undefined
            ? `Edge ${edge.id} does not identify a target port`
            : `Edge ${edge.id} references unknown target port ${targetPortId}`,
        edgeId: edge.id,
        nodeId: targetNode.id,
        ...(targetPortId === undefined ? {} : { portId: targetPortId }),
      });
    }

    if (
      sourcePort !== undefined &&
      targetPort !== undefined &&
      !arePortsCompatible(sourcePort, targetPort)
    ) {
      issues.push({
        code: "incompatible_ports",
        message: `Edge ${edge.id} cannot connect ${sourcePort.kind} to ${targetPort.kind}`,
        edgeId: edge.id,
        nodeId: targetNode.id,
        portId: targetPort.id,
      });
    }
  }

  if (checkPorts) {
    for (const node of graph.nodes) {
      for (const input of getNodePorts(node, "input")) {
        const connections = graph.edges.filter((edge) => {
          if (edge.target !== node.id) {
            return false;
          }
          return (
            resolveNodePort(node, "input", getEdgeTargetPortId(edge))?.id ===
            input.id
          );
        });

        if (
          checkRequiredInputs &&
          input.required === true &&
          connections.length === 0
        ) {
          issues.push({
            code: "missing_required_input",
            message: `Required input ${input.id} on node ${node.id} is not connected`,
            nodeId: node.id,
            portId: input.id,
          });
        }

        const defaultMaximum =
          input.multiple === true || input.kind.endsWith("[]")
            ? Number.POSITIVE_INFINITY
            : 1;
        const maximum = input.maxConnections ?? defaultMaximum;
        if (connections.length > maximum) {
          issues.push({
            code: "too_many_connections",
            message: `Input ${input.id} on node ${node.id} accepts at most ${maximum} connection(s)`,
            nodeId: node.id,
            portId: input.id,
          });
        }
      }
    }
  }

  const cycles = findCycles(graph);
  for (const cycle of cycles) {
    issues.push({
      code: "cycle",
      message: `Workflow cycle detected: ${cycle.join(" -> ")}`,
      path: cycle,
    });
  }

  return {
    valid: issues.length === 0,
    errors: issues,
    cycles,
  };
}

export function assertValidGraph(
  graph: WorkflowGraph,
  options?: GraphValidationOptions,
): void {
  const result = validateGraph(graph, options);
  if (!result.valid) {
    throw new InvalidGraphError(result.errors);
  }
}

export const validateDAG = validateGraph;
export const assertValidDAG = assertValidGraph;

export function topologicalLayers(
  graph: WorkflowGraph,
): readonly (readonly string[])[] {
  const cycles = findCycles(graph);
  if (cycles.length > 0) {
    throw new GraphCycleError(cycles);
  }

  const nodeIds = [...new Set(graph.nodes.map((node) => node.id))].sort(byText);
  const nodeIdSet = new Set(nodeIds);
  const adjacency = buildAdjacency(graph);
  const indegree = new Map(nodeIds.map((nodeId) => [nodeId, 0]));

  for (const [, targets] of adjacency) {
    for (const target of targets) {
      indegree.set(target, (indegree.get(target) ?? 0) + 1);
    }
  }

  let ready = nodeIds.filter((nodeId) => indegree.get(nodeId) === 0);
  const layers: string[][] = [];
  const emitted = new Set<string>();

  while (ready.length > 0) {
    const layer = [...ready].sort(byText);
    layers.push(layer);
    const next = new Set<string>();

    for (const nodeId of layer) {
      emitted.add(nodeId);
      for (const target of adjacency.get(nodeId) ?? []) {
        const remaining = (indegree.get(target) ?? 0) - 1;
        indegree.set(target, remaining);
        if (remaining === 0 && nodeIdSet.has(target)) {
          next.add(target);
        }
      }
    }

    ready = [...next].sort(byText);
  }

  if (emitted.size !== nodeIds.length) {
    throw new GraphCycleError(findCycles(graph));
  }

  return layers;
}

export function topologicalSort(graph: WorkflowGraph): readonly string[] {
  return topologicalLayers(graph).flat();
}

export const topologicalOrder = topologicalSort;
export const getTopologicalOrder = topologicalSort;
export const stableTopologicalOrder = topologicalSort;
export const getTopologicalLayers = topologicalLayers;
export const stableTopologicalLayers = topologicalLayers;
export const topologicalSchedule = topologicalSort;
export const scheduleGraph = topologicalSort;
export const scheduleLayers = topologicalLayers;

export function wouldCreateCycle(
  graph: ConnectivityGraph,
  sourceNodeId: string,
  targetNodeId: string,
): boolean {
  if (sourceNodeId === targetNodeId) {
    return true;
  }

  const adjacency = buildAdjacency(graph);
  const pending = [targetNodeId];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (nodeId === undefined || visited.has(nodeId)) {
      continue;
    }
    if (nodeId === sourceNodeId) {
      return true;
    }
    visited.add(nodeId);
    pending.push(...(adjacency.get(nodeId) ?? []));
  }

  return false;
}

export function selectRunNodeIds(
  graph: WorkflowGraph,
  scope: RunScope,
  nodeId?: string,
  nodeIds?: readonly string[],
): readonly string[] {
  const nodeMap = makeNodeMap(graph.nodes);
  if (scope === "all") {
    return topologicalSort(graph);
  }

  if (scope === "selection") {
    if (nodeIds === undefined || nodeIds.length === 0) {
      throw new TypeError("nodeIds is required for selection scope");
    }
    const selected = new Set(nodeIds);
    for (const selectedNodeId of selected) {
      if (!nodeMap.has(selectedNodeId)) {
        throw new RangeError(`Unknown workflow node: ${selectedNodeId}`);
      }
    }
    return topologicalSort(graph).filter((id) => selected.has(id));
  }

  if (nodeId === undefined) {
    throw new TypeError(`nodeId is required for ${scope} scope`);
  }
  if (!nodeMap.has(nodeId)) {
    throw new RangeError(`Unknown workflow node: ${nodeId}`);
  }
  if (scope === "node") {
    return [nodeId];
  }

  const adjacency = buildAdjacency(graph);
  const selected = new Set<string>();
  const pending = [nodeId];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || selected.has(current)) {
      continue;
    }
    selected.add(current);
    for (const target of [...(adjacency.get(current) ?? [])].reverse()) {
      pending.push(target);
    }
  }

  return topologicalSort(graph).filter((id) => selected.has(id));
}

export const getRunNodeIds = selectRunNodeIds;

export function selectRunSubgraph<
  TNode extends WorkflowNode,
  TEdge extends WorkflowEdge,
>(
  graph: WorkflowGraph<TNode, TEdge>,
  scope: RunScope,
  nodeId?: string,
  nodeIds?: readonly string[],
): RunSubgraph<TNode, TEdge> {
  const selectedNodeIds = selectRunNodeIds(graph, scope, nodeId, nodeIds);
  const selected = new Set(selectedNodeIds);
  const nodeMap = makeNodeMap(graph.nodes);
  const nodes = selectedNodeIds
    .map((id) => nodeMap.get(id))
    .filter((node): node is TNode => node !== undefined);
  const edges = graph.edges
    .filter((edge) => selected.has(edge.source) && selected.has(edge.target))
    .slice()
    .sort((left, right) => byText(left.id, right.id));

  return {
    nodeIds: selectedNodeIds,
    edgeIds: edges.map((edge) => edge.id),
    nodes,
    edges,
  };
}

export const getRunSubgraph = selectRunSubgraph;
export const selectRunScopeSubgraph = selectRunSubgraph;
