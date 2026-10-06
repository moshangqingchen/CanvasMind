import type { CanvasNode } from "../components/types";

export const MASK_EDIT_NODE_MIN_HEIGHT = 330;
export const MASK_EDIT_NODE_DEFAULT_HEIGHT = 360;
export const IMAGE_REFERENCE_NODE_MIN_HEIGHT = 270;

export function hasImageMask(parameters: Readonly<Record<string, unknown>> | undefined): boolean {
  return [parameters?.maskAssetId, parameters?.mask].some(value => typeof value === "string" && value.trim().length > 0);
}

/** Migrate saved compact nodes as well as new masks; keep Flow's geometry in sync. */
export function ensureMaskNodeSize(node: CanvasNode): CanvasNode {
  if (node.data.nodeType !== "image-generation" || !hasImageMask(node.data.parameters)) return node;
  const height = Math.max(MASK_EDIT_NODE_MIN_HEIGHT, Number(node.style?.height) || node.height || node.measured?.height || 0);
  const width = Math.max(300, Number(node.style?.width) || node.width || node.measured?.width || 420);
  if (node.style?.height === height && node.style?.width === width &&
      (node.height === undefined || node.height >= MASK_EDIT_NODE_MIN_HEIGHT) &&
      (node.width === undefined || node.width >= 300) &&
      (node.measured?.height === undefined || node.measured.height >= MASK_EDIT_NODE_MIN_HEIGHT) &&
      (node.measured?.width === undefined || node.measured.width >= 300)) return node;
  return {
    ...node,
    style: { ...node.style, width, height },
    ...(node.height !== undefined ? { height } : {}),
    ...(node.width !== undefined ? { width } : {}),
    ...(node.measured ? { measured: { ...node.measured,
      ...(node.measured.height !== undefined ? { height } : {}),
      ...(node.measured.width !== undefined ? { width } : {}),
    } } : {}),
  };
}
