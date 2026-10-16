import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { CanvasNode } from "../components/types";

type Handler = (...args: never[]) => unknown;
type Entry = {
  data: CanvasNode["data"];
  handlers: Map<string, Handler>;
  forwards: Map<string, Handler>;
};
type Batch = {
  nodes: CanvasNode[];
  handlers: Array<{ id: string; entry: Entry; handlers: Map<string, Handler> }>;
  live: Set<string>;
};

/** JSON presentation fields may be rebuilt by a different connection's scan.
 * Reuse equal subtrees; opaque objects and functions retain identity semantics. */
function share(previous: unknown, next: unknown, pairs: WeakMap<object, WeakMap<object, unknown>>): unknown {
  if (Object.is(previous, next)) return previous;
  if (!previous || !next || typeof previous !== "object" || typeof next !== "object") return next;
  if (Array.isArray(previous) !== Array.isArray(next)) return next;
  const prototype = Object.getPrototypeOf(next);
  if (Object.getPrototypeOf(previous) !== prototype ||
      (!Array.isArray(next) && prototype !== Object.prototype && prototype !== null)) return next;
  let compared = pairs.get(next);
  if (!compared) { compared = new WeakMap(); pairs.set(next, compared); }
  if (compared.has(previous)) return compared.get(previous);
  // Also bounds recursion for unexpected cyclic metadata. Such objects are
  // conservatively replaced instead of being treated as equal JSON.
  compared.set(previous, next);
  const oldKeys = Object.keys(previous), keys = Object.keys(next);
  const oldRecord = previous as Record<string, unknown>, nextRecord = next as Record<string, unknown>;
  let equal = oldKeys.length === keys.length;
  const result: Record<string, unknown> = Array.isArray(next) ? [] as unknown as Record<string, unknown> : Object.create(prototype);
  for (const key of keys) {
    const value = share(oldRecord[key], nextRecord[key], pairs);
    result[key] = value;
    if (!Object.hasOwn(oldRecord, key) || !Object.is(value, oldRecord[key])) equal = false;
  }
  // Sparse arrays can have identical enumerable keys and different lengths.
  if (Array.isArray(next)) {
    (result as unknown as unknown[]).length = next.length;
    if ((previous as unknown[]).length !== next.length) equal = false;
  }
  const shared = equal ? previous : result;
  compared.set(previous, shared);
  return shared;
}

/** Bounded to live nodes. Event closures are published only after React commits,
 * so stable node props never call an old model list or an abandoned render. */
export function createStableNodePresentationData() {
  const entries = new Map<string, Entry>();
  const release = (entry: Entry) => {
    entry.handlers.clear();
    entry.forwards.clear();
    entry.data = { label: "" };
  };
  return {
    prepare(nodes: CanvasNode[]): Batch {
      const live = new Set<string>();
      const pairs = new WeakMap<object, WeakMap<object, unknown>>();
      const handlers: Batch["handlers"] = [];
      const result = nodes.map(node => {
        live.add(node.id);
        let entry = entries.get(node.id);
        if (!entry) {
          entry = { data: node.data, handlers: new Map(), forwards: new Map() };
          entries.set(node.id, entry);
        }
        const current = new Map<string, Handler>();
        const data = { ...node.data };
        for (const [key, value] of Object.entries(node.data)) {
          if (typeof value !== "function") continue;
          current.set(key, value as Handler);
          let forward = entry.forwards.get(key);
          if (!forward) {
            const owner = entry;
            forward = (...args: never[]) => owner.handlers.get(key)?.(...args);
            entry.forwards.set(key, forward);
          }
          (data as Record<string, unknown>)[key] = forward;
        }
        entry.data = share(entry.data, data, pairs) as CanvasNode["data"];
        handlers.push({ id: node.id, entry, handlers: current });
        return { ...node, data: entry.data };
      });
      return { nodes: result, handlers, live };
    },
    commit(batch: Batch) {
      for (const [id, entry] of entries) if (!batch.live.has(id)) {
        release(entry);
        entries.delete(id);
      }
      for (const value of batch.handlers) {
        value.entry.handlers = value.handlers;
        entries.set(value.id, value.entry);
      }
    },
    clear() { entries.forEach(release); entries.clear(); },
    get size() { return entries.size; },
  };
}

export function useStableNodePresentationData(nodes: CanvasNode[]): CanvasNode[] {
  const [cache] = useState(createStableNodePresentationData);
  const batch = useMemo(() => cache.prepare(nodes), [cache, nodes]);
  useLayoutEffect(() => { cache.commit(batch); }, [cache, batch]);
  // The canvas flushes buffered editor changes during its earlier passive
  // cleanup. Keep their forwarding handlers alive through that flush, then
  // release the canvas-scoped closures before another canvas can reuse them.
  useEffect(() => () => { cache.clear(); }, [cache]);
  return batch.nodes;
}
