import type { DirectorAttachment } from "@super-canvas/director";
import { repository, storage } from "./server";

const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 24 * 1024 * 1024;

class DirectorServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "DirectorServiceError";
  }
}

export async function loadDirectorAttachments(
  assetIds: readonly string[] | undefined,
  dependencies: Pick<typeof import("./server"), "repository" | "storage"> = {
    repository,
    storage,
  },
): Promise<DirectorAttachment[]> {
  if (!assetIds?.length) return [];
  const attachments: DirectorAttachment[] = [];
  let totalBytes = 0;
  for (const assetId of assetIds) {
    const asset = await dependencies.repository.getAsset(assetId);
    if (!asset || asset.deleted) {
      throw new DirectorServiceError(
        "ATTACHMENT_NOT_FOUND",
        "选中的导演素材不存在或已被删除",
        404,
      );
    }
    if (asset.kind === "text") {
      throw new DirectorServiceError(
        "ATTACHMENT_UNSUPPORTED",
        "导演附件只支持图片、音频或视频",
        422,
      );
    }
    if (!asset.mimeType.startsWith(`${asset.kind}/`)) {
      throw new DirectorServiceError(
        "ATTACHMENT_TYPE_MISMATCH",
        "导演素材类型与文件内容声明不一致",
        422,
      );
    }
    if (asset.size <= 0 || asset.size > MAX_ATTACHMENT_BYTES) {
      throw new DirectorServiceError(
        "ATTACHMENT_TOO_LARGE",
        "单个导演素材不能超过 16 MB",
        413,
      );
    }
    totalBytes += asset.size;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new DirectorServiceError(
        "ATTACHMENTS_TOO_LARGE",
        "导演素材总大小不能超过 24 MB",
        413,
      );
    }
    const metadata = dependencies.storage.head
      ? await dependencies.storage.head(asset.storageKey)
      : null;
    if (metadata && metadata.size !== asset.size) {
      throw new DirectorServiceError(
        "ATTACHMENT_SIZE_MISMATCH",
        "导演素材大小校验失败",
        409,
      );
    }
    const object = await dependencies.storage.get(asset.storageKey);
    if (!object || object.bytes.byteLength !== asset.size) {
      throw new DirectorServiceError(
        "ATTACHMENT_UNAVAILABLE",
        "导演素材文件不可用",
        409,
      );
    }
    attachments.push({
      kind: asset.kind,
      name: asset.name,
      mimeType: asset.mimeType,
      url: `data:${asset.mimeType};base64,${Buffer.from(object.bytes).toString("base64")}`,
    });
  }
  return attachments;
}
