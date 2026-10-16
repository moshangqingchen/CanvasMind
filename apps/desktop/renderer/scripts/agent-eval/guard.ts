import type { ResolvedDirectorConnection } from "@super-canvas/director";

const mediaKeys = new Set([
  "image_url", "input_image", "input_audio", "input_video", "inlineData", "inline_data",
  "fileData", "file_data", "file_id", "file_ids", "file_url", "audio_url", "video_url",
  "attachments", "input_file", "upload", "uploads", "multipart", "binary", "b64_json",
]);
const mediaTypes = /^(?:image_url|input_image|input_audio|input_video|input_file|computer_use|web_search.*)$/u;
export class EvaluationGuardError extends Error {}

function inspectTextOnly(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach(inspectTextOnly); return; }
  for (const [key, item] of Object.entries(value)) {
    if (mediaKeys.has(key) && item !== undefined && item !== null)
      throw new EvaluationGuardError(`评测禁止媒体或上传字段：${key}`);
    if (key === "tools" && Array.isArray(item) && item.length)
      throw new EvaluationGuardError("评测禁止上游工具、搜索和执行");
    if (key === "type" && typeof item === "string" && mediaTypes.test(item))
      throw new EvaluationGuardError("评测只允许文字内容");
    inspectTextOnly(item);
  }
}

function allowedEndpoints(connection: ResolvedDirectorConnection): Set<string> {
  const base = new URL(connection.baseUrl);
  if (base.username || base.password || base.search || base.hash)
    throw new EvaluationGuardError("连接地址不能包含凭证、查询或片段");
  const google = connection.protocol === "google-generate-content";
  const prefix = base.pathname.replace(/\/+$/u, "") || (google ? "/v1beta" : "/v1");
  const paths = google
    ? [`/models/${encodeURIComponent(connection.model.replace(/^models\//u, ""))}:generateContent`,
      `/models/${encodeURIComponent(connection.model.replace(/^models\//u, ""))}:streamGenerateContent?alt=sse`]
    : ["/chat/completions", "/responses"];
  return new Set(paths.map(path => `${base.origin}${prefix}${path}`));
}

/** Exact selected origin, base path and model only. Redirects must remain manual. */
export function assertTextModelRequest(
  connection: ResolvedDirectorConnection, input: string | URL | Request, init?: RequestInit,
): { url: string; body: Record<string, unknown> } {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!allowedEndpoints(connection).has(url) || (init?.method ?? "GET").toUpperCase() !== "POST")
    throw new EvaluationGuardError("评测拒绝非选定文字模型端点或非 POST 请求");
  if (init?.redirect !== "manual") throw new EvaluationGuardError("评测必须禁止自动重定向重发");
  if (typeof init.body !== "string") throw new EvaluationGuardError("评测只允许 JSON 文字请求");
  let body: unknown;
  try { body = JSON.parse(init.body); } catch { throw new EvaluationGuardError("无效 JSON 请求"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new EvaluationGuardError("请求必须为 JSON 对象");
  const record = body as Record<string, unknown>;
  if (connection.protocol !== "google-generate-content" && record.model !== connection.model)
    throw new EvaluationGuardError("评测拒绝替换已选型号");
  inspectTextOnly(record);
  return { url, body: record };
}

export function makeSecretRedactor(secrets: readonly string[]): (value: string) => string {
  const distinct = [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length);
  return value => distinct.reduce((text, secret) => text.split(secret).join("[REDACTED]"), value);
}

export function blockedOperation(name: string): never {
  throw new EvaluationGuardError(`隔离评测硬阻断：${name}`);
}
