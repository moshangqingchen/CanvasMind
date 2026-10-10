import { randomBytes } from "node:crypto";
import { join } from "node:path";

export const APP_ID = "com.supercanvas.desktop";
export const UPDATE_REPOSITORY = "moshangqingchen/CanvasMind";
export const [UPDATE_OWNER, UPDATE_REPO] = UPDATE_REPOSITORY.split("/");
export const UPDATE_INTERVAL = 6 * 60 * 60 * 1000;
export const TOKEN_HEADER = "x-supercanvas-desktop-token";

/** Session callbacks can arrive after the owning BrowserWindow is destroyed. */
export function liveWindowContents(window) {
  if (!window || window.isDestroyed()) return undefined;
  const contents = window.webContents;
  return contents && !contents.isDestroyed() ? contents : undefined;
}

export function windowRequestHeaders(details, window, origin, development, token) {
  const headers = { ...details.requestHeaders };
  for (const key of Object.keys(headers)) if (key.toLowerCase() === TOKEN_HEADER) delete headers[key];
  const contents = liveWindowContents(window);
  if (contents && isAppRequestUrl(details.url, origin, development) && details.webContentsId === contents.id)
    headers[TOKEN_HEADER] = token;
  return headers;
}

export function isAppUrl(value, origin) {
  try { return Boolean(origin) && new URL(value).origin === origin; } catch { return false; }
}

/** Only the development HMR websocket may receive the desktop session header. */
export function isAppRequestUrl(value, origin, development = false) {
  if (isAppUrl(value, origin)) return true;
  if (!development || !origin) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "ws:" || url.pathname !== "/_next/hmr") return false;
    url.protocol = "http:";
    return !url.username && !url.password && url.origin === origin;
  } catch { return false; }
}

export function externalUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// Do not inherit development databases, public URLs, Node injection options or credentials.
export function backendEnvironment(parent, root, port, token, secrets) {
  const env = {};
  for (const name of ["SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PATH", "COMSPEC", "PATHEXT"]) {
    if (parent[name]) env[name] = parent[name];
  }
  const profile = join(root, "profile");
  Object.assign(env, {
    NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port),
    SUPERCANVAS_DESKTOP: "true", SUPERCANVAS_DESKTOP_TOKEN: token,
    SUPERCANVAS_DESKTOP_ORIGIN: `http://127.0.0.1:${port}`,
    MASTER_KEY: secrets.masterKey, USE_MEMORY_STORE: "true",
    LOCAL_DATABASE_PATH: join(profile, "data", "super-canvas.json"),
    LOCAL_STORAGE_PATH: join(profile, "storage"),
    SUPERCANVAS_PROJECT_ROOT: join(profile, "projects"),
    SUPERCANVAS_RECOVERY_ROOT: join(profile, "data", "artifact-recovery"),
    SUPERCANVAS_REFERENCE_CHANNEL_FILE: join(profile, "reference-channel-status.json"),
    NEXT_TELEMETRY_DISABLED: "1",
  });
  for (const name of ["ARTIFACT_HTTP_PROXY", "PROVIDER_HTTP_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "NODE_USE_ENV_PROXY"]) {
    if (secrets.network?.[name]) env[name] = secrets.network[name];
  }
  for (const name of ["RUNTIME_RUN_CONCURRENCY", "RUNTIME_GLOBAL_CONCURRENCY", "RUNTIME_PROVIDER_CONCURRENCY", "RUNTIME_CONNECTION_CONCURRENCY"]) {
    const value = parent[name];
    if (typeof value === "string" && /^(?:[1-9]|[1-5][0-9]|6[0-4])$/.test(value)) env[name] = value;
  }
  // A copied public origin still points to the OLD database. It is retained in
  // the migration report, never activated merely because it existed there.
  return env;
}

export function newMasterKey() { return `base64:${randomBytes(32).toString("base64")}`; }
