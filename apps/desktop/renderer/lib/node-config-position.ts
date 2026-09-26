type Rect = { left: number; top: number; right: number; bottom: number };
/**
 * Position the inspector in screen space without letting a node near an edge
 * collapse it into an unusably thin strip. The canvas is zoomable, so the
 * panel must stay in CSS pixels and choose the side with the most room.
 */
export function nodeConfigPosition(node: Rect, viewport: Rect) {
  const width = Math.max(1, node.right - node.left);
  const viewportWidth = Math.max(1, viewport.right - viewport.left);
  const viewportHeight = Math.max(1, viewport.bottom - viewport.top);
  const gap = 10;
  const panelWidth = Math.min(width, viewportWidth);
  const below = Math.max(0, viewport.bottom - node.bottom - gap);
  const above = Math.max(0, node.top - viewport.top - gap);
  const maxHeight = Math.min(560, viewportHeight);
  // Keep a comfortable panel when possible. If the node is close to the
  // bottom edge, use the space above it instead of shrinking to a few pixels.
  // A 240px body is still usable and lets the inspector stay below nodes in
  // the common zoomed canvas case. Only switch sides when the lower space is
  // genuinely too small for the header and a useful first field.
  const preferredMinimum = Math.min(240, maxHeight);
  const placeAbove = below < preferredMinimum && above > below;
  const available = placeAbove ? above : below;
  const height = Math.max(1, Math.min(maxHeight, Math.max(preferredMinimum, available)));
  const top = placeAbove
    ? Math.max(viewport.top, node.top - height - gap)
    : Math.min(viewport.bottom - height, Math.max(viewport.top, node.bottom + gap));
  const left = Math.min(
    viewport.right - panelWidth,
    Math.max(viewport.left, node.left),
  );
  return { left, top, width: panelWidth, height };
}
