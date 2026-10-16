import { canvasUsableArea, type CanvasRect } from "./canvas-usable-area";

interface Bounds { x: number; y: number; width: number; height: number }
export interface ResultToolbarViewport { x?: number; y?: number; width: number; height: number }

/** Floating bottom controls also reserve the gap below them for result actions. */
export function resultToolbarUsableArea(canvas: CanvasRect, obstacles: readonly CanvasRect[], bottomChrome: readonly CanvasRect[] = []) {
  return canvasUsableArea(canvas, [...obstacles, ...bottomChrome.map(({ left, top, right }) => ({ left, top, right, bottom: canvas.bottom }))]);
}

/** Prefer space outside media; pin to a visible edge when the image fills the canvas. */
export function placeResultToolbar(node: Bounds, surface: { width: number; height: number }, viewport: ResultToolbarViewport) {
  const gap = 12;
  // An explicit origin is the already-padded usable canvas, excluding open
  // Agent/parameter panels and the Dock. Legacy callers retain viewport insets.
  const left = viewport.x ?? 8, top = viewport.y ?? 72;
  const right = viewport.x === undefined ? viewport.width - 8 : viewport.x + viewport.width;
  const bottom = viewport.y === undefined ? viewport.height - 72 : viewport.y + viewport.height;
  const maxX = Math.max(left, right - surface.width);
  const centeredX = Math.max(left, Math.min(node.x + (node.width - surface.width) / 2, maxX));
  const centeredY = Math.max(top, Math.min(node.y + (node.height - surface.height) / 2, bottom - surface.height));
  const candidates = [
    { x: centeredX, y: node.y + node.height + gap },
    { x: centeredX, y: node.y - surface.height - gap },
    { x: node.x + node.width + gap, y: centeredY },
    { x: node.x - surface.width - gap, y: centeredY },
  ];
  const overflow = (position: { x: number; y: number }) =>
    Math.max(0, left - position.x) + Math.max(0, position.x + surface.width - right) +
    Math.max(0, top - position.y) + Math.max(0, position.y + surface.height - bottom);
  const outside = candidates.find(candidate => overflow(candidate) === 0);
  if (outside) return outside;

  // A large result can occupy every side. Keep the controls reachable, favoring
  // an edge away from the central image content over an offscreen surface.
  const minY = top;
  const maxY = Math.max(minY, bottom - surface.height);
  const edgePositions = [
    { x: maxX, y: maxY },
    { x: left, y: maxY },
    { x: maxX, y: minY },
    { x: left, y: minY },
  ];
  const mainContent = { x: node.x + node.width * 0.15, y: node.y + node.height * 0.15,
    width: node.width * 0.7, height: node.height * 0.7 };
  const overlap = (position: { x: number; y: number }) =>
    Math.max(0, Math.min(position.x + surface.width, mainContent.x + mainContent.width) - Math.max(position.x, mainContent.x)) *
    Math.max(0, Math.min(position.y + surface.height, mainContent.y + mainContent.height) - Math.max(position.y, mainContent.y));
  return edgePositions.reduce((best, candidate) => overlap(candidate) < overlap(best) ? candidate : best);
}
