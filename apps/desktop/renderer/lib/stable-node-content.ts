import { useState } from "react";
import type { CanvasNode } from "../components/types";

/** Geometry changes must not rebuild model menus, upstream assets or node callbacks. */
export function useStableNodeContent(nodes: CanvasNode[]): CanvasNode[] {
  const [previous, setPrevious] = useState(nodes);
  if (
    previous.length !== nodes.length ||
    nodes.some((node, index) => {
      const old = previous[index];
      return (
        !old ||
        old.id !== node.id ||
        old.type !== node.type ||
        old.data !== node.data ||
        old.selected !== node.selected
      );
    })
  ) {
    setPrevious(nodes);
    return nodes;
  }
  return previous;
}

/** Keep untouched React Flow node identities while drag geometry changes. */
export function createNodePresentationCache() {
  const cache = new WeakMap<CanvasNode, CanvasNode>();
  return (nodes: CanvasNode[], presentation: ReadonlyMap<string, CanvasNode["data"]>) =>
    nodes.map((node) => {
      const data = presentation.get(node.id) ?? node.data;
      const previous = cache.get(node);
      if (previous?.data === data) return previous;
      const rendered = { ...node, data };
      cache.set(node, rendered);
      return rendered;
    });
}
