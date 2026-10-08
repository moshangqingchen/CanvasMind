import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { join, parse, resolve, sep } from "node:path";

const MAX_FILE_BYTES = 256 * 1024;
const MAX_PENDING_RECORDS = 128;
const EVENTS = new Set(["check-start", "check-complete", "download-start", "download-mode", "fallback", "download-complete", "error"]);
const PHASES = new Set(["idle", "checking", "available", "downloading", "ready", "failed", "waiting_for_idle", "applying", "disabled"]);
const MODES = new Set(["preparing", "differential", "full", "cached"]);
const STAGES = new Set(["check", "download", "verify", "apply"]);
const CATEGORIES = new Set(["network", "timeout", "not-found", "http", "cache", "checksum", "signature", "configuration", "unknown"]);
const CODES = new Set([
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

function safeRecord(record) {
  if (!record || typeof record !== "object") return undefined;
  const prototype = Object.getPrototypeOf(record);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  // Read data properties only. Never stringify the original object or invoke its getters.
  const value = (name) => Object.getOwnPropertyDescriptor(record, name)?.value;
  const event = value("event");
  if (!EVENTS.has(event)) return undefined;
  const result = { schemaVersion: 1, timestamp: new Date().toISOString(), event };
  for (const [name, allowed] of [["phase", PHASES], ["mode", MODES], ["stage", STAGES], ["category", CATEGORIES], ["code", CODES]]) {
    const candidate = value(name);
    if (allowed.has(candidate)) result[name] = candidate;
  }
  for (const name of ["currentVersion", "targetVersion"]) {
    const candidate = value(name);
    // Stable app versions are sufficient here; arbitrary prerelease/build labels can contain secrets.
    if (typeof candidate === "string" && candidate.length <= 64 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(candidate)) result[name] = candidate;
  }
  const statusCode = value("statusCode");
  if (Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599) result.statusCode = statusCode;
  const retryable = value("retryable");
  if (typeof retryable === "boolean") result.retryable = retryable;
  return result;
}

async function statIfPresent(path) {
  try { return await lstat(path); }
  catch (error) { if (error?.code === "ENOENT") return undefined; throw error; }
}

async function ensureDirectory(root) {
  const volume = parse(root).root;
  let current = volume;
  for (const part of root.slice(volume.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    let info = await statIfPresent(current);
    if (!info) {
      try { await mkdir(current, { mode: 0o700 }); }
      catch (error) { if (error?.code !== "EEXIST") throw error; }
      info = await lstat(current);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Unsafe diagnostics directory");
  }
}

async function safeFile(path) {
  const info = await statIfPresent(path);
  if (info && (info.isSymbolicLink() || !info.isFile() || info.nlink > 1)) throw new Error("Unsafe diagnostics file");
  return info;
}

async function appendRecord(root, line) {
  await ensureDirectory(root);
  const current = join(root, "update-diagnostics.jsonl");
  const previous = join(root, "update-diagnostics.previous.jsonl");
  const [currentInfo, previousInfo] = await Promise.all([safeFile(current), safeFile(previous)]);
  const bytes = Buffer.byteLength(line);
  if (previousInfo?.size > MAX_FILE_BYTES) await unlink(previous);
  if (currentInfo && currentInfo.size + bytes > MAX_FILE_BYTES) {
    if (previousInfo && previousInfo.size <= MAX_FILE_BYTES) await unlink(previous);
    if (currentInfo.size > MAX_FILE_BYTES) await unlink(current);
    else await rename(current, previous);
  }
  const file = await open(current, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW || 0), 0o600);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink > 1) throw new Error("Unsafe diagnostics file");
    await file.writeFile(line, "utf8");
  } finally { await file.close(); }
}

/** A bounded, best-effort structured log. The updater never depends on diagnostics succeeding. */
export function createUpdateDiagnostics(logRoot) {
  let root;
  try { if (typeof logRoot === "string" && logRoot.length) root = resolve(logRoot); }
  catch { /* Invalid destinations disable diagnostics. */ }
  let queue = Promise.resolve(false);
  let pending = 0;
  return (record) => {
    let line;
    try {
      const safe = safeRecord(record);
      if (!root || !safe || pending >= MAX_PENDING_RECORDS) return Promise.resolve(false);
      line = `${JSON.stringify(safe)}\n`;
    } catch { return Promise.resolve(false); }
    pending++;
    const task = queue.then(async () => {
      try { await appendRecord(root, line); return true; }
      catch { return false; }
      finally { pending--; }
    });
    queue = task;
    return task;
  };
}
