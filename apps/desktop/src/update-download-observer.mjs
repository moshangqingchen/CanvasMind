const ERROR_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "EPIPE",
  "ENOENT", "EACCES", "EPERM", "EBUSY", "ENOSPC", "EIO", "ERR_ABORTED", "ERR_CONNECTION_RESET",
  "ERR_CONNECTION_REFUSED", "ERR_CONNECTION_CLOSED", "ERR_INTERNET_DISCONNECTED", "ERR_NETWORK_CHANGED",
  "ERR_NAME_NOT_RESOLVED", "ERR_TIMED_OUT", "ERR_CONNECTION_TIMED_OUT", "ERR_PROXY_CONNECTION_FAILED",
  "ERR_TUNNEL_CONNECTION_FAILED", "ERR_HTTP_RESPONSE_CODE_FAILURE", "ERR_INVALID_URL",
  "ERR_UPDATER_CHECKSUM_MISMATCH", "ERR_UPDATER_INVALID_SIGNATURE", "ERR_UPDATER_INVALID_RELEASE_FEED",
  "ERR_UPDATER_LATEST_VERSION_NOT_FOUND", "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND", "ERR_UPDATER_NO_PUBLISHED_VERSIONS",
  "ERR_UPDATER_INVALID_PROVIDER_CONFIGURATION", "ERR_UPDATER_INVALID_UPDATE_INFO", "ERR_UPDATER_WEB_INSTALLER_DISABLED",
  "ERR_UPDATER_UNSUPPORTED_PROVIDER", "ERR_CHECKSUM_MISMATCH", "SHA512_MISMATCH", "CHECKSUM_MISMATCH", "DIGEST_MISMATCH",
]);

/** Returns fixed classifications only. Original errors, URLs and stack traces never leave this boundary. */
export function updateFailureDiagnostic(error, stage = "download") {
  const message = (error instanceof Error ? error.message : typeof error === "string" ? error : "").slice(0, 65_536);
  const text = message.replace(/https?:\/\/[^\s"'<>]+/gi, "[url]").replace(/(?:authorization|bearer|token|password|secret|api[-_]?key)[^\r\n]*/gi, "[credential]");
  const explicitCode = error && typeof error === "object" ? error.code : undefined;
  const code = ERROR_CODES.has(explicitCode) ? explicitCode : text.match(/\b[A-Z][A-Z0-9_]+\b/g)?.find(value => ERROR_CODES.has(value));
  const explicitStatus = error && typeof error === "object" ? error.statusCode : undefined;
  const parsedStatus = text.match(/(?:\bHTTP(?:\/\d(?:\.\d)?)?\s+|\bstatus(?:Code)?\s*[:=]?\s*|\bHttpError:\s*)([1-5]\d{2})\b/i)?.[1];
  const statusCode = Number.isInteger(explicitStatus) && explicitStatus >= 100 && explicitStatus <= 599 ? explicitStatus : parsedStatus ? Number(parsedStatus) : undefined;
  let category = "unknown";
  if (/checksum|digest|sha512|sha256/i.test(text) || /MISMATCH/.test(code ?? "")) category = "checksum";
  else if (/signature/i.test(text) || code === "ERR_UPDATER_INVALID_SIGNATURE") category = "signature";
  else if (/TIMED?_?OUT|TIMEOUT/.test(code ?? "") || /\b(?:timed?\s*out|timeout)\b/i.test(text)) category = "timeout";
  else if (statusCode === 404 || code === "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND") category = "not-found";
  else if (statusCode !== undefined) category = "http";
  else if (/^E(?:CONN|NOTFOUND|AI_AGAIN|NETUNREACH|HOSTUNREACH|PIPE)/.test(code ?? "") || /^ERR_(?:CONNECTION|INTERNET|NETWORK|NAME_NOT|PROXY|TUNNEL)/.test(code ?? "")) category = "network";
  else if (["ENOENT", "EACCES", "EPERM", "EBUSY", "ENOSPC", "EIO"].includes(code) || /\b(?:blockmap|cache|size mismatch)\b/i.test(text)) category = "cache";
  else if (/app-update\.yml|configuration|invalid.*(?:feed|provider|update info)/i.test(text) || /^ERR_UPDATER_(?:INVALID|NO_PUBLISHED|WEB_INSTALLER_DISABLED|UNSUPPORTED)/.test(code ?? "")) category = "configuration";
  return {
    stage: ["checksum", "signature"].includes(category) ? "verify" : stage,
    category, ...(code ? { code } : {}), ...(statusCode ? { statusCode } : {}),
    retryable: ["network", "timeout"].includes(category) || (category === "http" && (statusCode === 429 || statusCode >= 500)),
  };
}

export function differentialFallbackReason(diagnostic) {
  const reasons = {
    network: "差分连接中断，已切换完整安装包。", timeout: "差分下载超时，已切换完整安装包。",
    "not-found": "差分文件暂不可用，已切换完整安装包。", http: "差分下载服务返回错误，已切换完整安装包。",
    cache: "差分缓存或块数据不可用，已切换完整安装包。", checksum: "差分校验未通过，已切换完整安装包。",
    signature: "差分校验未通过，已切换完整安装包。", configuration: "差分更新配置不可用，已切换完整安装包。",
  };
  return reasons[diagnostic?.category] ?? "差分更新不可用，已切换完整安装包。";
}

function safely(callback, ...args) { try { callback?.(...args); } catch { /* Observation must not change downloading. */ } }
function observeMethod(target, name, start, resolved) {
  const original = target?.[name];
  if (typeof original !== "function") return false;
  function observed(...args) {
    safely(start);
    const result = Reflect.apply(original, this, args);
    if (result && typeof result.then === "function") {
      // Keep the original Promise, cancellation semantics and rejection identity.
      result.then(value => safely(resolved, value), () => {});
    } else safely(resolved, result);
    return result;
  }
  try { target[name] = observed; return target[name] === observed; } catch { return false; }
}

/** Observer for the pinned NSIS updater. Request options and verification stay entirely upstream. */
export function observeUpdateDownloads(updater, { differential, full, fallback, differentialResult } = {}) {
  updater.logger = {
    info() {}, debug() {}, warn() {},
    error(value) {
      if (typeof value === "string" && value.startsWith("Cannot download differentially, fallback to full download:")) {
        safely(fallback, updateFailureDiagnostic(value));
      }
    },
  };
  const differentialObserved = observeMethod(updater, "differentialDownloadInstaller", differential, differentialResult);
  const fullObserved = observeMethod(updater.httpExecutor, "download", full);
  return { canConfirmCache: differentialObserved && fullObserved };
}
