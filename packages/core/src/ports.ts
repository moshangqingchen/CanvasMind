import type {
  PortCollection,
  PortDefinition,
  PortKind,
  WorkflowEdge,
  WorkflowNode,
} from "./types.js";

const SINGLE_TO_ARRAY: Readonly<Partial<Record<PortKind, PortKind>>> = {
  image: "image[]",
  video: "video[]",
  audio: "audio[]",
};

export interface PortCompatibilityResult {
  readonly compatible: boolean;
  readonly sourceKind: PortKind;
  readonly targetKind: PortKind;
  readonly coercion: "none" | "single_to_array" | null;
  readonly reason?: string;
}

export function normalizePortCollection(
  collection: PortCollection | undefined,
): readonly PortDefinition[] {
  if (collection === undefined) {
    return [];
  }

  if (Array.isArray(collection)) {
    return collection.map((port) => ({ ...port }));
  }

  return Object.entries(collection)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, port]) => ({
      ...port,
      id: port.id ?? key,
    }));
}

export function getNodePorts(
  node: WorkflowNode,
  direction: "input" | "output",
): readonly PortDefinition[] {
  const directCollection =
    direction === "input"
      ? (node.inputs ?? node.inputPorts)
      : (node.outputs ?? node.outputPorts);
  if (directCollection !== undefined) {
    return normalizePortCollection(directCollection);
  }

  const data = node.data;
  if (data !== undefined) {
    const key = direction === "input" ? "inputs" : "outputs";
    const aliasKey = direction === "input" ? "inputPorts" : "outputPorts";
    const value = data[key] ?? data[aliasKey];
    if (isPortCollectionLike(value)) {
      return normalizePortCollection(value);
    }
  }
  return [];
}

function isPortCollectionLike(value: unknown): value is PortCollection {
  if (Array.isArray(value)) {
    return value.every(
      (port) =>
        typeof port === "object" &&
        port !== null &&
        typeof (port as { id?: unknown }).id === "string" &&
        typeof (port as { kind?: unknown }).kind === "string",
    );
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return Object.values(value).every(
    (port) =>
      typeof port === "object" &&
      port !== null &&
      typeof (port as { kind?: unknown }).kind === "string",
  );
}

export function getEdgeSourcePortId(edge: WorkflowEdge): string | undefined {
  return edge.sourcePort ?? edge.sourceHandle ?? edge.sourceOutput ?? undefined;
}

export function getEdgeTargetPortId(edge: WorkflowEdge): string | undefined {
  return edge.targetPort ?? edge.targetHandle ?? edge.targetInput ?? undefined;
}

export function resolveNodePort(
  node: WorkflowNode,
  direction: "input" | "output",
  requestedPortId?: string,
): PortDefinition | undefined {
  const ports = getNodePorts(node, direction);

  if (requestedPortId !== undefined) {
    return ports.find((port) => port.id === requestedPortId);
  }

  return ports.length === 1 ? ports[0] : undefined;
}

export function getPortCompatibility(
  source: PortKind | PortDefinition,
  target: PortKind | PortDefinition,
): PortCompatibilityResult {
  const sourceKind = typeof source === "string" ? source : source.kind;
  const targetKind = typeof target === "string" ? target : target.kind;

  if (sourceKind === targetKind) {
    return {
      compatible: true,
      sourceKind,
      targetKind,
      coercion: "none",
    };
  }

  if (SINGLE_TO_ARRAY[sourceKind] === targetKind) {
    return {
      compatible: true,
      sourceKind,
      targetKind,
      coercion: "single_to_array",
    };
  }

  return {
    compatible: false,
    sourceKind,
    targetKind,
    coercion: null,
    reason: `Cannot connect ${sourceKind} output to ${targetKind} input`,
  };
}

export function arePortKindsCompatible(
  sourceKind: PortKind,
  targetKind: PortKind,
): boolean {
  return getPortCompatibility(sourceKind, targetKind).compatible;
}

export function arePortsCompatible(
  source: PortKind | PortDefinition,
  target: PortKind | PortDefinition,
): boolean {
  return getPortCompatibility(source, target).compatible;
}

export const isPortCompatible = arePortsCompatible;
export const canConnectPorts = arePortsCompatible;
export const isPortKindCompatible = arePortKindsCompatible;
