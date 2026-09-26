import type { CanvasNode } from "../components/types";

type Ports = readonly { id: string; kind: string }[] | undefined;
type PortSnapshot = readonly (readonly [id: string, kind: string])[];

interface CachedLayout {
  width: number | undefined;
  height: number | undefined;
  inputs: Ports;
  outputs: Ports;
  inputSnapshot: PortSnapshot;
  outputSnapshot: PortSnapshot;
  seen: number;
}

function samePorts(ports: Ports, snapshot: PortSnapshot): boolean {
  return (ports?.length ?? 0) === snapshot.length &&
    (ports ?? []).every((port, index) =>
      port.id === snapshot[index]?.[0] && port.kind === snapshot[index]?.[1]);
}

const snapshotPorts = (ports: Ports): PortSnapshot =>
  (ports ?? []).map(port => [port.id, port.kind] as const);

/** Position and selection changes must not schedule a new handle measurement. */
export function createNodePortLayoutCache() {
  const entries = new Map<string, CachedLayout>();
  let signatures = new Map<string, string>();
  let generation = 0;
  return (nodes: readonly CanvasNode[]): ReadonlyMap<string, string> => {
    generation += 1;
    let next = signatures;
    const writable = () => {
      if (next === signatures) next = new Map(signatures);
      return next;
    };
    for (const node of nodes) {
      const previous = entries.get(node.id);
      const { inputs, outputs } = node.data;
      const sameInputs = previous !== undefined &&
        (previous.inputs === inputs || samePorts(inputs, previous.inputSnapshot));
      const sameOutputs = previous !== undefined &&
        (previous.outputs === outputs || samePorts(outputs, previous.outputSnapshot));
      if (previous && sameInputs && sameOutputs &&
          previous.width === node.width && previous.height === node.height) {
        previous.inputs = inputs;
        previous.outputs = outputs;
        previous.seen = generation;
        continue;
      }
      const inputSnapshot = sameInputs ? previous!.inputSnapshot : snapshotPorts(inputs);
      const outputSnapshot = sameOutputs ? previous!.outputSnapshot : snapshotPorts(outputs);
      const signature = JSON.stringify([node.width, node.height, inputSnapshot, outputSnapshot]);
      entries.set(node.id, {
        width: node.width, height: node.height, inputs, outputs,
        inputSnapshot, outputSnapshot, seen: generation,
      });
      writable().set(node.id, signature);
    }
    if (entries.size !== nodes.length) {
      for (const [id, entry] of entries) {
        if (entry.seen === generation) continue;
        entries.delete(id);
        writable().delete(id);
      }
    }
    signatures = next;
    return signatures;
  };
}
