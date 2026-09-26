export const CANVAS_PREVIEW_SIZES = [160, 640, 1200, 2400, 3840] as const;
export type CanvasPreviewSize = (typeof CANVAS_PREVIEW_SIZES)[number];

/** Pixel demand uses the rendered longest side, including display and in-node zoom. */
export function canvasPreviewSize(pixelDemand: number, current?: CanvasPreviewSize): CanvasPreviewSize {
  const pixels = Number.isFinite(pixelDemand) ? Math.max(1, pixelDemand) : 640;
  const wanted = CANVAS_PREVIEW_SIZES.find((size) => size >= pixels) ?? 3840;
  // Separate upgrade/downgrade boundaries prevent oscillation near a tier edge.
  if (current && wanted > current && pixels <= current * 1.12) return current;
  if (current && wanted < current && pixels > wanted * 0.8) return current;
  return wanted;
}
