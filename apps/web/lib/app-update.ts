import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const APP_UPDATE_FORMAT_VERSION = 1;
export const DEFAULT_UPDATE_REPOSITORY = "moshangqingchen/CanvasMind";
export const DEFAULT_UPDATE_INTERVAL_SECONDS = 600;
export const UPDATE_MANAGER_HEARTBEAT_TIMEOUT_MS = 120_000;
export const APP_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

export type AppUpdatePhase =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "waiting_for_idle"
  | "applying"
  | "failed";

export interface AppReleaseSummary {
  version: string;
  tag: string;
  commit?: string;
  publishedAt?: string;
  htmlUrl?: string;
  notes?: string;
  assetName?: string;
  assetSize?: number;
}

export interface AppUpdateProgress {
  downloadedBytes: number;
  totalBytes?: number;
}

export interface AppUpdateStatus {
  formatVersion: 1;
  currentVersion: string;
  currentCommit?: string;
  phase: AppUpdatePhase;
  latest?: AppReleaseSummary;
  downloadedVersion?: string;
  progress?: AppUpdateProgress;
  lastCheckedAt?: string;
  lastSuccessfulCheckAt?: string;
  error?: string;
  deferredVersion?: string;
  managerPid?: number;
  managerHeartbeatAt?: string;
  updatedAt: string;
}

export type AppUpdateCommandAction =
  | "check"
  | "download"
  | "apply"
  | "defer";

export interface AppUpdateCommand {
  id: string;
  action: AppUpdateCommandAction;
  requestedAt: string;
  version?: string;
}

export interface AppUpdateConfig {
  enabled: boolean;
  repository: string;
  intervalSeconds: number;
  token?: string;
}

export interface ReleaseManifest {
  formatVersion: 1;
  app: "super-canvas";
  version: string;
  tag: string;
  commit?: string;
  assetName?: string;
  assetSha256?: string;
  builtAt?: string;
}

export function isValidAppVersion(value: string): boolean {
  return APP_VERSION_PATTERN.test(value);
}

export function compareAppVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?/u.exec(value);
    if (!match) return null;
    return {
      numbers: match.slice(1, 4).map(Number),
      prerelease: match[4]?.split(".") ?? [],
    };
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index])
      return a.numbers[index] > b.numbers[index] ? 1 : -1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/u.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/u.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null)
      return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

export function validateReleaseManifest(
  value: unknown,
  expected?: { version?: string; tag?: string; assetName?: string },
): value is ReleaseManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  if (
    manifest.formatVersion !== 1 ||
    manifest.app !== "super-canvas" ||
    typeof manifest.version !== "string" ||
    !isValidAppVersion(manifest.version) ||
    manifest.tag !== `v${manifest.version}`
  )
    return false;
  if (expected?.version && manifest.version !== expected.version) return false;
  if (expected?.tag && manifest.tag !== expected.tag) return false;
  if (expected?.assetName && manifest.assetName !== expected.assetName) return false;
  if (
    manifest.assetSha256 !== undefined &&
    (typeof manifest.assetSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(manifest.assetSha256))
  )
    return false;
  return true;
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 60 ? parsed : fallback;
}

export function getAppVersion(): string {
  return nonEmpty(process.env.NEXT_PUBLIC_APP_VERSION) ?? "0.1.0";
}

export function getUpdateConfig(): AppUpdateConfig {
  const repository =
    nonEmpty(process.env.SUPERCANVAS_UPDATE_REPOSITORY) ??
    DEFAULT_UPDATE_REPOSITORY;
  return {
    enabled: process.env.SUPERCANVAS_UPDATE_ENABLED !== "false",
    repository,
    intervalSeconds: positiveInteger(
      process.env.SUPERCANVAS_UPDATE_INTERVAL_SECONDS,
      DEFAULT_UPDATE_INTERVAL_SECONDS,
    ),
    token: nonEmpty(process.env.SUPERCANVAS_GITHUB_TOKEN),
  };
}

export function getUpdateRoot(): string {
  const configured = nonEmpty(process.env.SUPERCANVAS_UPDATE_ROOT);
  if (configured) return isAbsolute(configured) ? configured : resolve(configured);
  const localAppData = nonEmpty(process.env.LOCALAPPDATA);
  if (localAppData) return join(localAppData, "SuperCanvas", "updates");
  return join(tmpdir(), "super-canvas-updates");
}

export function getUpdateStatusPath(): string {
  return (
    nonEmpty(process.env.SUPERCANVAS_UPDATE_STATUS_PATH) ??
    join(getUpdateRoot(), "status.json")
  );
}

export function getUpdateCommandPath(): string {
  return (
    nonEmpty(process.env.SUPERCANVAS_UPDATE_COMMAND_PATH) ??
    join(getUpdateRoot(), "command.json")
  );
}

export function defaultUpdateStatus(): AppUpdateStatus {
  return {
    formatVersion: APP_UPDATE_FORMAT_VERSION,
    currentVersion: getAppVersion(),
    phase: getUpdateConfig().enabled ? "idle" : "disabled",
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeRelease(value: unknown): AppReleaseSummary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (
    typeof record.version !== "string" ||
    typeof record.tag !== "string" ||
      !isValidAppVersion(record.version)
  )
    return;
  const result: AppReleaseSummary = {
    version: record.version.slice(0, 64),
    tag: record.tag.slice(0, 80),
  };
  for (const key of ["commit", "publishedAt", "htmlUrl", "notes", "assetName"] as const) {
    const value = record[key];
    if (
      typeof value === "string" &&
      value.trim() &&
      (key !== "htmlUrl" || /^https:\/\/github\.com\//u.test(value))
    )
      result[key] = value.slice(0, key === "notes" ? 50_000 : 2_048);
  }
  if (typeof record.assetSize === "number" && Number.isSafeInteger(record.assetSize))
    result.assetSize = Math.max(0, record.assetSize);
  return result;
}

export function normalizeUpdateStatus(value: unknown): AppUpdateStatus {
  const fallback = defaultUpdateStatus();
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  const phases: AppUpdatePhase[] = [
    "disabled",
    "idle",
    "checking",
    "available",
    "downloading",
    "ready",
    "waiting_for_idle",
    "applying",
    "failed",
  ];
  const phase = phases.includes(record.phase as AppUpdatePhase)
    ? (record.phase as AppUpdatePhase)
    : fallback.phase;
  const currentVersion =
    typeof record.currentVersion === "string" && record.currentVersion.trim()
      ? record.currentVersion.slice(0, 64)
      : fallback.currentVersion;
  const updatedAt =
    typeof record.updatedAt === "string" && record.updatedAt.trim()
      ? record.updatedAt
      : fallback.updatedAt;
  const status: AppUpdateStatus = {
    ...fallback,
    formatVersion: APP_UPDATE_FORMAT_VERSION,
    currentVersion,
    phase,
    updatedAt,
  };
  const latest = sanitizeRelease(record.latest);
  if (latest) status.latest = latest;
  for (const key of [
    "currentCommit",
    "downloadedVersion",
    "lastCheckedAt",
    "lastSuccessfulCheckAt",
    "error",
    "deferredVersion",
    "managerHeartbeatAt",
  ] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) status[key] = value.slice(0, 50_000);
  }
  if (
    typeof record.managerPid === "number" &&
    Number.isSafeInteger(record.managerPid) &&
    record.managerPid > 0
  )
    status.managerPid = record.managerPid;
  if (record.progress && typeof record.progress === "object") {
    const progress = record.progress as Record<string, unknown>;
    if (typeof progress.downloadedBytes === "number") {
      status.progress = {
        downloadedBytes: Math.max(0, Math.floor(progress.downloadedBytes)),
        ...(typeof progress.totalBytes === "number" && progress.totalBytes >= 0
          ? { totalBytes: Math.floor(progress.totalBytes) }
          : {}),
      };
    }
  }
  return status;
}

export async function readUpdateStatus(): Promise<AppUpdateStatus> {
  try {
    const raw = await readFile(getUpdateStatusPath(), "utf8");
    // Windows PowerShell 5 writes UTF-8 with a BOM by default. Keep the
    // reader compatible with status files written by older managers.
    return normalizeUpdateStatus(JSON.parse(raw.replace(/^\uFEFF/u, "")));
  } catch {
    return defaultUpdateStatus();
  }
}

export async function writeUpdateCommand(
  action: AppUpdateCommandAction,
  version?: string,
): Promise<AppUpdateCommand> {
  const command: AppUpdateCommand = {
    id: randomUUID(),
    action,
    requestedAt: new Date().toISOString(),
    ...(version ? { version } : {}),
  };
  const path = getUpdateCommandPath();
  await mkdir(join(path, ".."), { recursive: true });
  const temporaryPath = `${path}.${command.id}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(command)}\n`, "utf8");
  await rename(temporaryPath, path);
  return command;
}

export async function updateManagerAvailable(): Promise<boolean> {
  try {
    const raw = await readFile(getUpdateStatusPath(), "utf8");
    const status = normalizeUpdateStatus(
      JSON.parse(raw.replace(/^\uFEFF/u, "")),
    );
    if (!status.managerHeartbeatAt) return false;
    const heartbeat = Date.parse(status.managerHeartbeatAt);
    const heartbeatIsFresh =
      Number.isFinite(heartbeat) &&
      Math.abs(Date.now() - heartbeat) <= UPDATE_MANAGER_HEARTBEAT_TIMEOUT_MS;
    if (!heartbeatIsFresh) return false;
    if (!status.managerPid) return false;
    try {
      process.kill(status.managerPid, 0);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}
