interface DirectedCanvasEdge {
  source: string;
  target: string;
}

interface PortLike {
  id: string;
}

type PortMapValue = Omit<PortLike, "id"> & { id?: string };

interface PortNodeLike {
  id: string;
  data?: {
    inputs?:
      | readonly PortLike[]
      | Readonly<Record<string, PortMapValue>>;
    outputs?:
      | readonly PortLike[]
      | Readonly<Record<string, PortMapValue>>;
  };
}

interface PortEdgeLike extends DirectedCanvasEdge {
  sourceHandle?: string | null;
  targetHandle?: string | null;
  sourcePort?: string | null;
  targetPort?: string | null;
  sourceOutput?: string | null;
  targetInput?: string | null;
}

function edgePortId(
  edge: PortEdgeLike,
  direction: "source" | "target",
): string | undefined {
  const value =
    direction === "source"
      ? (edge.sourceHandle ?? edge.sourcePort ?? edge.sourceOutput)
      : (edge.targetHandle ?? edge.targetPort ?? edge.targetInput);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function hasKnownPort(
  node: PortNodeLike,
  direction: "source" | "target",
  requestedPortId: string | undefined,
): boolean {
  const collection =
    direction === "source" ? node.data?.outputs : node.data?.inputs;
  // Nodes without a port declaration are legacy/custom nodes. Leave those
  // edges alone and let the server's normal graph validation handle them.
  if (!collection) return true;
  const ports = Array.isArray(collection)
    ? collection
    : Object.entries(collection).map(([key, port]) => ({
        ...port,
        id: port.id ?? key,
      }));
  if (ports.length === 0) return true;
  if (!requestedPortId) return ports.length === 1;
  return ports.some((port) => port.id === requestedPortId);
}

/** Remove edges that point at nodes/ports no longer present in the canvas. */
export function filterEdgesToKnownPorts<
  NodeType extends PortNodeLike,
  EdgeType extends PortEdgeLike,
>(nodes: readonly NodeType[], edges: readonly EdgeType[]): EdgeType[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const filtered = edges.filter((edge) => {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    return Boolean(
      source &&
        target &&
        hasKnownPort(source, "source", edgePortId(edge, "source")) &&
        hasKnownPort(target, "target", edgePortId(edge, "target")),
    );
  });

  // Preserve the input identity when no edge was removed. Callers use
  // identity to distinguish a real graph change from a normalization pass.
  return filtered.length === edges.length ? (edges as EdgeType[]) : filtered;
}

function nodePairKey(edge: DirectedCanvasEdge): string {
  return `${edge.source}\u0000${edge.target}`;
}

/**
 * A source node may connect to a target node through only one pair of handles.
 * Keep the newest edge so reconnecting to another input replaces the old route.
 */
export function keepLatestEdgePerNodePair<EdgeType extends DirectedCanvasEdge>(
  edges: EdgeType[],
): EdgeType[] {
  const seen = new Set<string>();
  const nextReversed: EdgeType[] = [];

  for (let index = edges.length - 1; index >= 0; index -= 1) {
    const edge = edges[index]!;
    const key = nodePairKey(edge);
    if (seen.has(key)) continue;
    seen.add(key);
    nextReversed.push(edge);
  }

  if (nextReversed.length === edges.length) return edges;
  return nextReversed.reverse();
}

export function hasEdgeForNodePair<EdgeType extends DirectedCanvasEdge>(
  edges: readonly EdgeType[],
  source: string,
  target: string,
): boolean {
  return edges.some((edge) => edge.source === source && edge.target === target);
}
