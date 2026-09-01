import {
  getUpdateConfig,
  isValidAppVersion,
  writeUpdateCommand,
  type AppUpdateCommandAction,
} from "../../../lib/app-update";
import { isLoopbackHost } from "../../../lib/public-auth";

const actions = new Set<AppUpdateCommandAction>([
  "check",
  "download",
  "apply",
  "defer",
]);

function isCrossOriginWrite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    const sameOrigin =
      requestUrl.protocol !== originUrl.protocol ||
      requestUrl.host !== originUrl.host;
    if (!sameOrigin) return false;

    // Cloudflare Tunnel and similar local reverse proxies can expose the app
    // at PUBLIC_BASE_URL while Next sees the loopback origin internally.
    // Trust that one configured public origin only for loopback requests.
    const configuredPublicOrigin = process.env.PUBLIC_BASE_URL
      ? new URL(process.env.PUBLIC_BASE_URL).origin
      : "";
    if (
      configuredPublicOrigin &&
      originUrl.origin === configuredPublicOrigin &&
      isLoopbackHost(requestUrl.hostname)
    )
      return false;

    return true;
  } catch {
    return true;
  }
}

export async function handleAppUpdatePost(
  request: Request,
  forcedAction?: string,
) {
  if (isCrossOriginWrite(request))
    return Response.json(
      { ok: false, error: "跨站更新请求已被拒绝" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );

  const config = getUpdateConfig();
  if (!config.enabled)
    return Response.json(
      { ok: false, error: "应用更新已禁用" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    if (forcedAction) body = {};
    else
      return Response.json(
        { ok: false, error: "更新请求格式无效" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
  }
  const bodyAction =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { action?: unknown }).action
      : undefined;
  const action = forcedAction ?? bodyAction;
  if (forcedAction && bodyAction !== undefined && bodyAction !== forcedAction)
    return Response.json(
      { ok: false, error: "更新操作与请求路径不匹配" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  if (typeof action !== "string" || !actions.has(action as AppUpdateCommandAction))
    return Response.json(
      { ok: false, error: "不支持的更新操作" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  const version =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { version?: unknown }).version
      : undefined;
  if (
    version !== undefined &&
    (typeof version !== "string" || !isValidAppVersion(version))
  )
    return Response.json(
      { ok: false, error: "更新版本号格式无效" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  const command = await writeUpdateCommand(
    action as AppUpdateCommandAction,
    typeof version === "string" ? version : undefined,
  );
  return Response.json(
    { ok: true, commandId: command.id, action: command.action },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
