export interface ImageMaskSize {
  width: number;
  height: number;
}

export interface ImageMaskPoint {
  x: number;
  y: number;
}

// One 16 MP RGBA surface is 64 MiB. History stores paths, not full surfaces.
export const MAX_IMAGE_MASK_PIXELS = 16_777_216;
export const MAX_IMAGE_MASK_DIMENSION = 8192;
export const IMAGE_MASK_COLOR = [168, 116, 255] as const;

export function validateImageMaskSize({ width, height }: ImageMaskSize): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error("无法读取原图尺寸，请重新选择图片。");
  }
  if (width > MAX_IMAGE_MASK_DIMENSION || height > MAX_IMAGE_MASK_DIMENSION || width * height > MAX_IMAGE_MASK_PIXELS) {
    throw new Error("这张图片过大。局部涂抹支持最多 1677 万像素、单边不超过 8192 像素，请先使用较小的原图。");
  }
}

export function imageMaskFitScale(image: ImageMaskSize, viewport: ImageMaskSize, padding = 24): number {
  if (image.width <= 0 || image.height <= 0) return 1;
  return Math.min(1, Math.max(1, viewport.width - padding * 2) / image.width, Math.max(1, viewport.height - padding * 2) / image.height);
}

/** The bounds belong to the image-sized canvas, not its letterboxed viewport.
 * Keep captured points outside the image unbounded: canvas clipping then avoids
 * spuriously painting along an edge when the pointer leaves the image. */
export function imageMaskPointFromClient(
  point: ImageMaskPoint,
  bounds: { left: number; top: number; width: number; height: number },
  image: ImageMaskSize,
): ImageMaskPoint | null {
  if (bounds.width <= 0 || bounds.height <= 0 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return {
    x: (point.x - bounds.left) * image.width / bounds.width,
    y: (point.y - bounds.top) * image.height / bounds.height,
  };
}

/** Convert a selection overlay to a binary PNG mask, in place.
 * Canvas antialiasing is thresholded so every output alpha is exactly 0 or 255.
 * RGB has no selection meaning: transparent = edit, opaque = protect. */
export function selectionPixelsToMask(pixels: Uint8ClampedArray): boolean {
  let selected = false;
  for (let index = 0; index < pixels.length; index += 4) {
    const edit = pixels[index + 3]! >= 128;
    pixels[index] = pixels[index + 1] = pixels[index + 2] = 255;
    pixels[index + 3] = edit ? 0 : 255;
    selected ||= edit;
  }
  return selected;
}

/** A saved mask is not itself a colored overlay. Invert its alpha explicitly. */
export function maskPixelsToSelection(pixels: Uint8ClampedArray): boolean {
  let selected = false;
  for (let index = 0; index < pixels.length; index += 4) {
    const edit = pixels[index + 3]! < 128;
    pixels[index] = IMAGE_MASK_COLOR[0];
    pixels[index + 1] = IMAGE_MASK_COLOR[1];
    pixels[index + 2] = IMAGE_MASK_COLOR[2];
    pixels[index + 3] = edit ? 255 : 0;
    selected ||= edit;
  }
  return selected;
}

export function selectionPixelsHaveEdits(pixels: Uint8ClampedArray): boolean {
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index]! >= 128) return true;
  }
  return false;
}

export function imageMaskFileName(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 100);
  return `${stem || "image"}-mask.png`;
}
