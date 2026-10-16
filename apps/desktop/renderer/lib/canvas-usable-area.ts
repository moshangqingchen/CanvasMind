export type CanvasRect = { left: number; top: number; right: number; bottom: number };

/** Reserve edge chrome while leaving a useful canvas even in a narrow window. */
export function canvasUsableArea(canvas: CanvasRect, obstacles: readonly CanvasRect[]) {
  let left = canvas.left + 24, top = canvas.top + 24, right = canvas.right - 24, bottom = canvas.bottom - 24;
  const width = canvas.right - canvas.left, height = canvas.bottom - canvas.top;
  // Right-side cards can sit beside the Agent. Consume them from right to
  // left so the whole connected strip is excluded, rather than just its edge.
  for (const item of [...obstacles].sort((a, b) => b.right - a.right)) {
    if (item.right <= item.left || item.bottom <= item.top || item.right <= canvas.left || item.left >= canvas.right || item.bottom <= canvas.top || item.top >= canvas.bottom) continue;
    const itemWidth = item.right - item.left, itemHeight = item.bottom - item.top;
    if (item.top <= canvas.top + 16 && itemHeight < height * .4) top = Math.max(top, item.bottom + 16);
    else if (item.bottom >= canvas.bottom - 32 && itemHeight < height * .3) bottom = Math.min(bottom, item.top - 16);
    else if (item.left <= canvas.left + 24 && itemWidth < width * .5) left = Math.max(left, item.right + 16);
    else if (item.right >= right - 24 && itemWidth < width * .8) right = Math.min(right, item.left - 16);
  }
  // Prefer the largest actual unobscured rectangle; retain nonzero geometry on
  // exceptionally small windows, where the side card itself becomes scrollable.
  right = Math.max(left + Math.min(160, width / 3), right);
  bottom = Math.max(top + Math.min(160, height / 3), bottom);
  return { x: left - canvas.left, y: top - canvas.top, width: right - left, height: bottom - top };
}
