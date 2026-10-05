import sharp from "sharp";
import type { Repository } from "@super-canvas/db";
import type { ProviderAssetInput } from "@super-canvas/providers";
import type { ObjectStorage } from "@super-canvas/storage";

export class ImageMaskValidationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export interface ImageMaskProvenance {
  maskAssetId: string;
  maskSourceAssetId: string;
  width: number;
  height: number;
}

/** Validate stored bytes, never client-supplied dimensions or alpha metadata. */
export async function resolveImageMask(input: {
  parameters: Readonly<Record<string, unknown>>;
  assets: readonly ProviderAssetInput[];
  supported: boolean;
  imageEdit: boolean;
  repository: Repository;
  storage: ObjectStorage;
}): Promise<{ asset: ProviderAssetInput; provenance: ImageMaskProvenance } | null> {
  const { maskAssetId, maskSourceAssetId } = input.parameters;
  const fail = (code: string, message: string): never => { throw new ImageMaskValidationError(code, message); };
  if (maskAssetId === undefined && maskSourceAssetId === undefined) {
    if (input.assets.some(asset => asset.role === "mask"))
      fail("invalid_mask_reference", "蒙版必须通过局部编辑绑定原图，不能作为普通素材连入。");
    return null;
  }
  if (!input.supported) fail("unsupported_mask", "当前供应商分组、型号或档位不支持蒙版局部编辑。");
  if (!input.imageEdit) fail("mask_requires_image", "蒙版编辑需要原始图片，不能用于文生图或视频。");
  if (typeof maskAssetId !== "string" || !maskAssetId.trim() || typeof maskSourceAssetId !== "string" || !maskSourceAssetId.trim())
    return fail("invalid_mask_reference", "蒙版和原图引用不完整，请重新打开局部编辑并保存蒙版。");
  if (input.parameters.mask || input.assets.some(asset => asset.role === "mask" || asset.id === maskAssetId))
    fail("multiple_masks", "每次局部编辑只能提交一张独立蒙版，不能同时作为普通参考图或蒙版链接使用。");
  const source = input.assets.find(asset => asset.kind === "image" && asset.role !== "mask");
  if (!source || source.id !== maskSourceAssetId)
    return fail("mask_source_changed", "蒙版对应的原图已改变，请基于当前第一张原图重新绘制蒙版。");
  const [sourceRecord, maskRecord] = await Promise.all([
    input.repository.getAsset(maskSourceAssetId), input.repository.getAsset(maskAssetId),
  ]);
  if (!sourceRecord || sourceRecord.deleted || sourceRecord.kind !== "image" || !sourceRecord.mimeType.startsWith("image/"))
    return fail("invalid_mask_source", "蒙版原图不存在、已删除或不是图片。");
  if (!maskRecord || maskRecord.deleted || maskRecord.kind !== "image" || maskRecord.mimeType.split(";", 1)[0]?.trim().toLowerCase() !== "image/png")
    return fail("invalid_mask", "蒙版必须是资产库中包含透明通道的 PNG 图片。");
  const stored = await input.storage.get(maskRecord.storageKey);
  if (!stored || !source.data) return fail("invalid_mask", "原图或蒙版文件缺失，请重新上传。");
  try {
    const sourceImage = sharp(source.data, { limitInputPixels: 50_000_000, failOn: "warning" });
    const maskImage = sharp(stored.bytes, { limitInputPixels: 50_000_000, failOn: "warning" });
    const [sourceInfo, maskInfo] = await Promise.all([sourceImage.metadata(), maskImage.metadata()]);
    if (!sourceInfo.format || !["png", "jpeg", "webp", "gif", "avif", "tiff"].includes(sourceInfo.format) || (sourceInfo.pages ?? 1) !== 1)
      fail("invalid_mask_source", "局部编辑需要一张可解码的静态原图。");
    if (maskInfo.format !== "png" || !maskInfo.hasAlpha || (maskInfo.pages ?? 1) !== 1)
      fail("invalid_mask", "蒙版必须是包含透明通道的静态 PNG 图片。");
    // Browser image decoding applies EXIF orientation before the brush canvas is sized.
    const rotated = (sourceInfo.orientation ?? 1) >= 5;
    const width = rotated ? sourceInfo.height : sourceInfo.width;
    const height = rotated ? sourceInfo.width : sourceInfo.height;
    if (!width || !height || maskInfo.width !== width || maskInfo.height !== height)
      fail("mask_size_mismatch", "蒙版必须与当前原图的原始像素尺寸完全相同，请重新绘制。");
    const [decoded] = await Promise.all([
      maskImage.ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sourceImage.stats(),
    ]);
    let selected = false;
    const channels = decoded.info.channels;
    for (let index = channels - 1; index < decoded.data.length && !selected; index += channels) {
      if (decoded.data[index]! < 255) selected = true;
    }
    if (!selected)
      fail("empty_mask_selection", "蒙版尚未选择区域，请先涂抹需要修改的位置。");
    return {
      asset: { id: maskAssetId, kind: "image", mimeType: "image/png", data: stored.bytes, role: "mask", filename: maskRecord.name },
      provenance: { maskAssetId, maskSourceAssetId, width: width!, height: height! },
    };
  } catch (error) {
    if (error instanceof ImageMaskValidationError) throw error;
    return fail("invalid_mask", "原图或蒙版无法安全解码，请重新上传并绘制蒙版。");
  }
}
