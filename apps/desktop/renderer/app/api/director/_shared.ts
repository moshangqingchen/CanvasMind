import { DirectorServiceError } from "../../../lib/director-service";
import { DirectorAdapterError } from "../../../lib/director-adapters/shared";

export interface PublicDirectorError {
  readonly error: string;
  readonly code: string;
  readonly status: number;
}

export function publicDirectorError(error: unknown): PublicDirectorError {
  if (error instanceof DirectorServiceError) {
    return {
      error: error.message,
      code: error.code,
      status: error.status,
    };
  }
  if (error instanceof DirectorAdapterError) {
    const status =
      error.status ??
      (error.code === "configuration" || error.code === "unsupported_input"
        ? 422
        : error.code === "aborted"
          ? 499
          : 502);
    return {
      // Adapter messages are already redacted by requestJson; returning them
      // here gives the UI an actionable failure without exposing secrets.
      error: error.message,
      code: `DIRECTOR_ADAPTER_${error.code.toUpperCase()}`,
      status,
    };
  }
  return {
    error: "超级导演请求处理失败，请稍后重试",
    code: "DIRECTOR_INTERNAL_ERROR",
    status: 500,
  };
}

export function directorErrorResponse(error: unknown): Response {
  const safe = publicDirectorError(error);
  return Response.json(
    { error: safe.error, code: safe.code },
    { status: safe.status },
  );
}

const SAFE_PROFILE_ERRORS = new Set([
  "导演大脑连接不存在",
  "请选择用途为“导演台”的独立连接",
  "导演大脑连接尚未配置 API Key",
  "研究连接不存在或未配置 API Key",
]);

export function directorProfileErrorResponse(error: unknown): Response {
  if (error instanceof Error && SAFE_PROFILE_ERRORS.has(error.message)) {
    return Response.json(
      { error: error.message, code: "DIRECTOR_PROFILE_INVALID" },
      { status: 422 },
    );
  }
  return directorErrorResponse(error);
}
