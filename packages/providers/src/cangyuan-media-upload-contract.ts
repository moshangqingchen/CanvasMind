import type { ProviderOperation } from "./contracts.js";
import { canApplyCangyuanCurrentContract } from "./cangyuan-current-models.js";
import { isCangyuanVideoRequest } from "./cangyuan-video-contract.js";

/** Exact first-party origins documented for the same API token. Browser safe. */
export function cangyuanMediaUploadOrigin(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash ||
        !["ai.cangyuansuanli.cn", "direct-api.cangyuansuanli.cn", "vip-api.cangyuansuanli.cn"].includes(url.hostname) ||
        !/^(?:\/v1)?\/?$/u.test(url.pathname)) return undefined;
    return url.origin;
  } catch { return undefined; }
}

export function cangyuanOwnMediaUploadAvailable(provider: string, settings: Readonly<Record<string, unknown>> | undefined,
  model: string | undefined, operation: ProviderOperation): boolean {
  if (provider !== "rest" || !settings || settings.manualProtocol === true || !cangyuanMediaUploadOrigin(settings.baseUrl)) return false;
  if (Array.isArray(settings.manualModels) && settings.manualModels.some(row => row && typeof row === "object" && (row as { id?: unknown }).id === model)) return false;
  const interfaces = settings.autoModelInterfaces;
  if (interfaces && typeof interfaces === "object" && model && Object.hasOwn(interfaces, model)) return false;
  // Grok's documented data-URI transport already sends bytes in the request.
  if (operation.startsWith("image.") && /^grok-imagine-image(?:-2\.0)?$/u.test(model ?? "")) return false;
  return operation.startsWith("image.")
    ? canApplyCangyuanCurrentContract(settings, String(settings.baseUrl), model)
    : operation.startsWith("video.") && isCangyuanVideoRequest(model, String(settings.baseUrl));
}

export const CANGYUAN_UPLOAD_LIMITS: Readonly<Record<string, number>> = {
  "image/png": 20 * 1024 * 1024, "image/jpeg": 20 * 1024 * 1024, "image/webp": 20 * 1024 * 1024,
  "video/mp4": 100 * 1024 * 1024, "video/webm": 100 * 1024 * 1024,
  "audio/wav": 20 * 1024 * 1024, "audio/mpeg": 20 * 1024 * 1024, "audio/mp4": 20 * 1024 * 1024,
};
