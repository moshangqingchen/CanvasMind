import { useState } from "react";
import type { CanvasNode } from "../components/types";
import { hasImageMask } from "./generation-node-layout";

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

/** The expensive presentation pass reads definitions, never selection or geometry. */
export function nodeDefinitionsEqual(previous: readonly CanvasNode[], nodes: readonly CanvasNode[]): boolean {
  return previous.length === nodes.length && nodes.every((node, index) => {
    const old = previous[index];
    return old?.id === node.id && old.type === node.type && old.data === node.data;
  });
}

/** Keep the existing content/selected-node hook's behavior separate and unchanged. */
export function useStableNodeDefinitions(nodes: CanvasNode[]): CanvasNode[] {
  const [previous, setPrevious] = useState(nodes);
  if (!nodeDefinitionsEqual(previous, nodes)) {
    setPrevious(nodes);
    return nodes;
  }
  return previous;
}

export interface NodePresentationSelection {
  size: number;
  anchorId: string | null;
  onAlignSelection?: CanvasNode["data"]["onAlignSelection"];
}

/** Keep untouched React Flow node identities while drag geometry changes. */
export function createNodePresentationCache() {
  const cache = new WeakMap<CanvasNode, CanvasNode>();
  // Drag geometry creates new outer node objects while the presented content
  // stays stable. Derive structural selectors once per content identity.
  const contentClasses = new WeakMap<CanvasNode["data"], string>();
  // Only live selected nodes own this extra object. A source-data change must
  // replace it even if model/scan callbacks changed without geometry changing.
  const selectedData = new Map<string, {
    source: CanvasNode["data"];
    size: number;
    anchor: boolean;
    onAlignSelection: NodePresentationSelection["onAlignSelection"];
    data: CanvasNode["data"];
  }>();
  return (nodes: CanvasNode[], presentation: ReadonlyMap<string, CanvasNode["data"]>, selection?: NodePresentationSelection) => {
    const liveSelected = new Set<string>();
    const renderedNodes = nodes.map((node) => {
      // The base pass must omit the four selection-only presentation fields.
      const source = presentation.get(node.id) ?? node.data;
      let data = source;
      if (selection && node.selected) {
        liveSelected.add(node.id);
        const anchor = selection.anchorId === node.id;
        const previous = selectedData.get(node.id);
        if (previous?.source === source && previous.size === selection.size &&
            previous.anchor === anchor && previous.onAlignSelection === selection.onAlignSelection) {
          data = previous.data;
        } else {
          data = { ...source, selectionSize: selection.size, selectionAlignmentVisible: anchor,
            selectionCount: anchor ? selection.size : undefined,
            onAlignSelection: anchor ? selection.onAlignSelection : undefined };
          selectedData.set(node.id, { source, size: selection.size, anchor,
            onAlignSelection: selection.onAlignSelection, data });
        }
      }
      const previous = cache.get(node);
      if (previous?.data === data) return previous;
      let derivedClasses = contentClasses.get(source);
      if (derivedClasses === undefined) {
        const generated = data.nodeType === "asset-input" && data.generatedResult === true;
        const imageGeneration = data.nodeType === "image-generation";
        derivedClasses = [
          data.nodeType ? `canvas-node-${data.nodeType}` : "",
          generated ? "canvas-node-result" : "",
          generated && (data.generatedStatus === "failed" || data.generatedStatus === "needs_attention")
            ? "canvas-node-result-problem" : "",
          imageGeneration && data.linkedAssets?.some(asset => asset.kind === "image")
            ? "canvas-node-has-image-reference" : "",
          imageGeneration && hasImageMask(data.parameters) ? "canvas-node-mask-edit" : "",
        ].filter(Boolean).join(" ");
        contentClasses.set(source, derivedClasses);
      }
      const className = [node.className, derivedClasses].filter(Boolean).join(" ");
      const rendered = { ...node, data, className };
      cache.set(node, rendered);
      return rendered;
    });
    for (const id of selectedData.keys()) if (!liveSelected.has(id)) selectedData.delete(id);
    return renderedNodes;
  };
}
