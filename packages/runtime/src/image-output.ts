import sharp, { type Metadata, type Stats } from "sharp";

export interface ImageOutputInspection {
  mimeType: string;
  extension: string;
  metadata: {
    imageOutputVerified: true;
    imageFormat: string;
    width: number;
    height: number;
    imagePages: number;
    imageHasAlpha: boolean;
    imageHasTransparentPixels: boolean;
    imageOrientation?: number;
  };
}

function signature(bytes: Uint8Array): string | undefined {
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 64));
  if (head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (head[0] === 255 && head[1] === 216 && head[2] === 255) return "jpeg";
  if (head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (["GIF87a", "GIF89a"].includes(head.toString("ascii", 0, 6))) return "gif";
  if (head.subarray(0, 4).equals(Buffer.from([73, 73, 42, 0])) || head.subarray(0, 4).equals(Buffer.from([77, 77, 0, 42]))) return "tiff";
  if (head.toString("ascii", 4, 8) === "ftyp") {
    const brands = head.toString("ascii", 8);
    if (/avif|avis/u.test(brands)) return "avif";
    if (/heic|heix|hevc|hevx|mif1|msf1/u.test(brands)) return "heic";
  }
}

/** Decode the original bytes to verify pixels and alpha; never re-encode them. */
export async function inspectImageOutput(bytes: Uint8Array): Promise<ImageOutputInspection> {
  const format = signature(bytes);
  if (!format) throw new Error("供应商图片原文件没有受支持的真实图片签名，不能将 JSON、HTML 或未知文件归档为图片");
  const input = sharp(bytes, { animated: true, failOn: "warning", limitInputPixels: 100_000_000 });
  let meta: Metadata;
  let stats: Stats;
  try {
    meta = await input.metadata();
    // metadata() reads headers only. stats() also decodes every page and finds actual alpha pixels.
    stats = await input.stats();
  } catch (error) {
    throw new Error(`供应商图片原文件无法完整解码：${error instanceof Error ? error.message : String(error)}`);
  }
  const decodedFormat = meta.format === "heif" ? meta.compression === "av1" ? "avif" : "heic" : meta.format;
  const height = meta.pageHeight ?? meta.height;
  if (decodedFormat !== format || !Number.isSafeInteger(meta.width) || !meta.width || !Number.isSafeInteger(height) || !height)
    throw new Error("供应商图片原文件签名、解码格式或像素尺寸不一致");
  return {
    mimeType: format === "jpeg" ? "image/jpeg" : `image/${format}`,
    extension: format === "jpeg" ? "jpg" : format === "tiff" ? "tif" : format,
    metadata: {
      imageOutputVerified: true, imageFormat: format, width: meta.width, height,
      imagePages: meta.pages ?? 1, imageHasAlpha: meta.hasAlpha ?? false,
      imageHasTransparentPixels: !!meta.hasAlpha && !stats.isOpaque,
      ...(meta.orientation ? { imageOrientation: meta.orientation } : {}),
    },
  };
}

/** Explicit output format and transparent background must match the real file. */
export function imageOutputContractMismatches(
  inspected: ImageOutputInspection,
  parameters: Readonly<Record<string, unknown>>,
): string[] {
  const issues: string[] = [];
  const requested = parameters.output_format;
  const format = requested === "jpg" ? "jpeg" : requested;
  if (typeof format === "string" && format !== "auto" && format !== inspected.metadata.imageFormat)
    issues.push(`请求输出格式 ${format}，原文件实际为 ${inspected.metadata.imageFormat}`);
  if (parameters.background === "transparent" && !inspected.metadata.imageHasTransparentPixels)
    issues.push("请求透明背景，原文件没有实际透明像素");
  return issues;
}
