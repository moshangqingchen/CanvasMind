type Rect = { left: number; top: number; right: number; bottom: number };
/**
 * Position the inspector in screen space without letting a node near an edge
 * collapse it into an unusably thin strip. The canvas is zoomable, so the
 * panel must stay in CSS pixels and choose the side with the most room.
 */
export function nodeConfigPosition(node: Rect, viewport: Rect) {
  const viewportWidth = Math.max(1, viewport.right - viewport.left);
  const viewportHeight = Math.max(1, viewport.bottom - viewport.top);
  const gap = 10;
  // Node bounds already include canvas zoom; only use them as the anchor.
  const panelWidth = Math.min(420, viewportWidth);
  const below = Math.max(0, viewport.bottom - node.bottom - gap);
  const above = Math.max(0, node.top - viewport.top - gap);
  // Canvas zoom changes the anchor, never the inspector's dimensions. Only
  // a smaller window may shrink the panel; edge collisions change position.
  const height = Math.min(560, viewportHeight);
  const placeAbove = below < height && above > below;
  const desiredTop = placeAbove ? node.top - height - gap : node.bottom + gap;
  const top = Math.max(viewport.top, Math.min(viewport.bottom - height, desiredTop));
  const left = Math.min(
    viewport.right - panelWidth,
    Math.max(viewport.left, node.left),
  );
  return { left, top, width: panelWidth, height };
}
