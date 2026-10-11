import type { LocalizedRunError } from "./error-localization";

export function runErrorTechnicalTitle(error: LocalizedRunError | null | undefined): string {
  if (error?.source === "local_validation") return "技术详情与本地校验";
  if (error?.source === "provider_response") return "技术详情与供应商原文";
  return "技术详情与错误原文";
}

export function runErrorDiagnostic(error: LocalizedRunError | null | undefined): string | null {
  if (!error) return null;
  if (error.source === "local_validation") {
    const message = error.localMessage ?? error.providerMessage;
    return message ? `本地校验：${message}` : null;
  }
  return error.providerMessage
    ? `${error.source === "provider_response" ? "供应商原文" : "错误原文"}：${error.providerMessage}`
    : null;
}
