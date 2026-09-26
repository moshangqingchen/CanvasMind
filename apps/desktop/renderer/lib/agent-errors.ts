import { DirectorAdapterError } from "./director-adapters/shared";

export function safeAgentError(error: unknown) {
  const message = (error instanceof Error ? error.message : "智能体请求失败")
    .replace(/Bearer\s+\S+/giu, "Bearer ***")
    .replace(/sk-[\w-]{8,}/gu, "***")
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=_-]+/giu, "[附件]")
    .replace(/([?&](?:key|api_key|token)=)[^&\s]+/giu, "$1***")
    .slice(0, 1200);
  return {
    message,
    errorCode: error instanceof DirectorAdapterError ? error.code : "request_failed",
    retryable: error instanceof DirectorAdapterError ? error.retryable : false,
  };
}
