import type { ModelParameterDescriptor } from "./contracts.js";
import type { RestModelConnectorOverride } from "./rest.js";

export const SECURE_BYTEPLUS_MODEL_IDS = ["dreamina-seedance-2-0-fast", "dreamina-seedance-2-0-mini"] as const;

/** The official guide permits IDs mapped by the selected Doubao/Ark group.
 * Group60's own live channel names these exact BytePlus mappings. Never grant
 * that contract by a similar model name, another group, or another host.
 */
export function isSecureByteplusVideoScope(id: string, context: {
  baseUrl?: unknown; officialGroupId?: string | number | undefined; manualProtocol?: unknown;
}): boolean {
  if (!(SECURE_BYTEPLUS_MODEL_IDS as readonly string[]).includes(id) || String(context.officialGroupId) !== "60" || context.manualProtocol === true) return false;
  try {
    const url = new URL(String(context.baseUrl ?? ""));
    return url.origin === "https://token.secure-skill.com" && !url.username && !url.password && !url.search && !url.hash && /^(?:\/v1)?\/?$/u.test(url.pathname);
  } catch { return false; }
}

const toggle = (key: string, label: string): ModelParameterDescriptor => ({ key, label, control: "toggle", valueType: "boolean" });
const integer = (key: string, label: string): ModelParameterDescriptor => ({ key, label, control: "number", valueType: "integer", step: 1 });
export const SECURE_BYTEPLUS_VIDEO_CONTRACT = {
  // Neither this mapping's complete duration range nor media counts are
  // published. The shared Seedance2.0 user fallback supplies 1–15 seconds.
  resolutions: [], openResolution: true, ratios: ["16:9", "9:16", "1:1", "21:9", "4:3", "3:4"], defaultRatio: "16:9",
  imageField: "images", videoField: "videos", audioField: "audios", secondsField: "duration", frames: "doubao-content",
  allowFrameMediaMix: true, outputAudio: "generate_audio", directoryContract: true, httpsOnly: true,
  submitPath: "/v1/videos", pollPath: "/v1/videos/{taskId}",
  outputPaths: ["$.video_url", "$.url", "$.output[0].url", "$.result.video_url", "$.result.url"],
  extraParameters: [toggle("watermark", "添加水印"), integer("seed", "随机种子"), toggle("return_last_frame", "返回尾帧"),
    integer("priority", "优先级"), { ...integer("execution_expires_after", "任务超时（秒）"), min: 1 }, toggle("use_asset_library", "自动入库参考素材"),
    { key: "safety_identifier", label: "安全标识", control: "text", valueType: "string" }],
  extraWireFields: ["content", "tools"], docs: "https://token.secure-skill.com/docs", checkedAt: "2026-10-21T02:56:28.244Z",
  note: "仅当前稳定分组60的完整BytePlus映射型号。使用官方文档允许的分组映射ID及兼容视频合同；分辨率按输入发送，480p/720p有本组Token费率，其余档位缺价留空。素材数量未公布，不套用其他渠道。时长范围为用户指定Seedance2.0兜底，并非供应商验证。未进行收费生成。",
} as const;

/** Compatible endpoint documented by this supplier; successful tasks return
 * the original signed URL. No undocumented content-download route is added.
 */
export function secureByteplusVideoTransport(): RestModelConnectorOverride {
  const response = { taskIdPath: "$.id", taskIdFallbackPaths: ["$.task_id"], statusPath: "$.status", progressPath: "$.progress", errorPath: "$.error.message" };
  return {
    submit: { path: "/v1/videos", method: "POST", bodyMode: "json", idempotent: false,
      mappings: [
        { target: "/model", source: { kind: "request", path: "$.model" } },
        { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
        ...["duration", "aspect_ratio", "resolution", "images", "videos", "audios", "content", "generate_audio", "watermark", "seed", "return_last_frame", "priority", "execution_expires_after", "tools", "safety_identifier", "use_asset_library"].map(key => ({
          target: `/${key}`, source: { kind: "request" as const, path: `$.parameters.${key}` }, omitIfUndefined: true,
        })),
      ], response },
    poll: { path: "/v1/videos/{taskId}", method: "GET", bodyMode: "none", response }, pollIntervalMs: 4000,
    statusMap: { queued: "queued", in_progress: "running", processing: "running", completed: "succeeded", succeeded: "succeeded", failed: "failed" },
    output: { path: "$.video_url", fallbackPaths: ["$.url", "$.output[0].url", "$.result.video_url", "$.result.url"], kind: "video", defaultMimeType: "video/mp4" },
  };
}
