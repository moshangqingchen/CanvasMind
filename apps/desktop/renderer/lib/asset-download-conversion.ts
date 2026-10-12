import sharp from "sharp";
import { detectMediaMimeType } from "../app/api/assets/media-utils";

export const IMAGE_DOWNLOAD_CONTENT_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
} as const;

export type ImageDownloadFormat = keyof typeof IMAGE_DOWNLOAD_CONTENT_TYPES;

export class ImageDownloadConversionError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ImageDownloadConversionError";
  }
}

const RASTER_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
]);

function hasPngAnimationControl(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset);
    if (length > bytes.byteLength - offset - 12) return false;
    if (
      length === 8 &&
      bytes[offset + 4] === 0x61 &&
      bytes[offset + 5] === 0x63 &&
      bytes[offset + 6] === 0x54 &&
      bytes[offset + 7] === 0x4c
    ) return true;
    offset += length + 12;
  }
  return false;
}

/** Encode a download copy from the full original; never write back to storage. */
export async function convertImageDownload(
  source: Uint8Array,
  format: ImageDownloadFormat,
): Promise<Uint8Array> {
  // Validate bytes before decoding. In particular, never rasterize active SVG
  // documents merely because a stored MIME type calls them an image.
  const sourceType = detectMediaMimeType(source);
  if (!RASTER_IMAGE_TYPES.has(sourceType ?? "")) {
    throw new ImageDownloadConversionError(
      "此文件无法转换为图片格式，请下载原文件。",
      415,
    );
  }
  // libvips currently decodes APNG as a single PNG and does not report pages.
  // Inspect PNG chunks so selecting WebP cannot silently discard its animation.
  if (sourceType === "image/png" && hasPngAnimationControl(source)) {
    throw new ImageDownloadConversionError(
      "此动态图为 APNG，格式转换无法保留全部帧，请下载原文件。",
      422,
    );
  }

  try {
    const metadata = await sharp(source, { failOn: "error" }).metadata();
    const animated = (metadata.pages ?? 1) > 1;
    if (animated && format !== "webp") {
      throw new ImageDownloadConversionError(
        "动态图不能转换为 PNG 或 JPG，请下载原文件或选择 WebP，以保留全部帧。",
        422,
      );
    }

    // Apply the original display orientation without resizing or using a
    // thumbnail. Sharp converts colour to sRGB when metadata is omitted.
    const image = sharp(source, { animated, failOn: "error" }).autoOrient();
    const encoded =
      format === "jpg"
        ? image
            .flatten({ background: "#ffffff" })
            .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
        : format === "png"
          ? image.png({ compressionLevel: 6, palette: false })
          : image.webp({ lossless: true, effort: 4 });
    return new Uint8Array(await encoded.toBuffer());
  } catch (error) {
    if (error instanceof ImageDownloadConversionError) throw error;
    throw new ImageDownloadConversionError(
      "图片转换失败，请下载原文件。",
      422,
    );
  }
}
