import type { RunSnapshot } from "../components/types";

function older(next?: string, previous?: string): boolean {
  const nextTime = Date.parse(next ?? "");
  const previousTime = Date.parse(previous ?? "");
  return Number.isFinite(nextTime) && Number.isFinite(previousTime) && nextTime < previousTime;
}

function retainRequestDetails(
  current: RunSnapshot["nodes"][number],
  other: RunSnapshot["nodes"][number],
): RunSnapshot["nodes"][number] {
  if (!other.request) return current;
  // Only enrich immutable inputs. Status, recovery instructions and billing
  // evidence belong to the newer node record and must never be revived here.
  if (current.request?.model && other.request.model && current.request.model !== other.request.model) return current;
  const details = Object.fromEntries(
    (["prompt", "inputAssetIds", "inputAssets", "imageMask"] as const)
      .filter(key => current.request?.[key] === undefined && other.request?.[key] !== undefined)
      .map(key => [key, other.request![key]]),
  );
  return Object.keys(details).length ? { ...current, request: { ...current.request, ...details } } : current;
}

/** Reconcile reads of the same run without imposing a status progression on resumes. */
export function reconcileRunSnapshot(previous: RunSnapshot | undefined, incoming: RunSnapshot): RunSnapshot {
  if (!previous || previous.run.id !== incoming.run.id || previous.run.canvasId !== incoming.run.canvasId) return incoming;
  const runIsOlder = older(incoming.run.updatedAt, previous.run.updatedAt);
  const base = runIsOlder ? previous : incoming;
  const previousNodes = new Map(previous.nodes.map(node => [node.id, node]));
  const incomingNodes = new Map(incoming.nodes.map(node => [node.id, node]));
  return {
    run: base.run,
    nodes: base.nodes.map(node => {
      const before = previousNodes.get(node.id);
      const next = incomingNodes.get(node.id);
      if (!before || !next) return node;
      // Node progress can advance without updating the parent run record.
      const knownNodeTimes = Number.isFinite(Date.parse(next.updatedAt ?? "")) && Number.isFinite(Date.parse(before.updatedAt ?? ""));
      const nodeIsOlder = knownNodeTimes ? older(next.updatedAt, before.updatedAt) : runIsOlder;
      return nodeIsOlder ? retainRequestDetails(before, next) : retainRequestDetails(next, before);
    }),
  };
}
