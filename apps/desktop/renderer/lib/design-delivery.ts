import { Zip, ZipPassThrough, strToU8 } from "fflate";
import type { AssetView } from "../components/types";
import { readImageDesignReview } from "@super-canvas/core";
import type { ProjectResult } from "./project-results";

export const DELIVERY_CHECKS = [
  ["copy", "标题、日期、电话、地址与价格已逐项核对"],
  ["content", "客户要求的文字、标志和主体完整，无遗漏"],
  ["dimensions", "实际像素、比例和安全范围符合交付要求"],
  ["version", "这张图片是本次确认交付的最终版本"],
] as const;
export type DeliveryCheck = (typeof DELIVERY_CHECKS)[number][0];
const limit = 512 * 1024 * 1024;

/** Package original bytes and a review record; never draw, resize or composite. */
export async function createDesignDelivery(input: {
  asset: AssetView;
  context?: ProjectResult;
  dimensions: { width: number; height: number };
  checks: readonly DeliveryCheck[];
  fetchOriginal?: () => Promise<Response>;
}): Promise<Blob> {
  const { asset, dimensions } = input;
  if (readImageDesignReview(asset.metadata).status !== "approved")
    throw new Error("请先保存图片为定稿");
  if (DELIVERY_CHECKS.some(([key]) => !input.checks.includes(key)))
    throw new Error("请完成全部交付检查");
  if (!(dimensions.width > 0 && dimensions.height > 0))
    throw new Error("无法读取实际尺寸，请重试");
  if (asset.size <= 0 || asset.size > limit)
    throw new Error("交付原图须小于 512 MB");
  const extension = (
    {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/avif": "avif",
    } as Record<string, string>
  )[asset.mimeType];
  if (!extension) throw new Error("此图片格式暂不支持交付包，请下载原文件");
  const response = await (input.fetchOriginal?.() ??
    fetch(`/api/assets/${encodeURIComponent(asset.id)}/content`, {
      signal: AbortSignal.timeout(120_000),
    }));
  if (!response.ok || !response.body) throw new Error("原图下载失败，请重试");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let zip!: Zip;
  const complete = new Promise<void>((resolve, reject) => {
    zip = new Zip((error, data, final) => {
      if (error) reject(error);
      else {
        const copy = new Uint8Array(data.byteLength);
        copy.set(data);
        chunks.push(copy);
        if (final) resolve();
      }
    });
  });
  // Attach a handler before streaming so a ZIP error cannot become unhandled.
  void complete.catch(() => undefined);
  const reader = response.body.getReader();
  try {
    const original = new ZipPassThrough(`final.${extension}`);
    zip.add(original);
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit || size > asset.size)
        throw new Error("原图大小与记录不符，已停止导出");
      original.push(value);
    }
    if (size !== asset.size) throw new Error("原图不完整，请重试");
    original.push(new Uint8Array(), true);
    const context = input.context;
    const record = {
      format: "supercanvas-delivery",
      version: 1,
      exportedAt: new Date().toISOString(),
      image: {
        name: asset.name,
        assetId: asset.id,
        file: `final.${extension}`,
        mimeType: asset.mimeType,
        size,
        ...dimensions,
      },
      review: readImageDesignReview(asset.metadata),
      checks: DELIVERY_CHECKS.map(([key, label]) => ({
        key,
        label,
        confirmed: true,
      })),
      ...(context
        ? {
            project: {
              canvasId: context.canvasId,
              runId: context.runId,
              nodeId: context.nodeId,
              sourceAssetId: context.sourceAssetId,
            },
            requirements: context.requirements,
            instruction: context.instruction,
          }
        : {}),
    };
    const manifest = new ZipPassThrough("delivery.json");
    zip.add(manifest);
    manifest.push(strToU8(JSON.stringify(record, null, 2)), true);
    zip.end();
    await complete;
    return new Blob(chunks, { type: "application/zip" });
  } catch (error) {
    zip.terminate();
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
