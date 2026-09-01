import { repository, storage } from "../../../lib/server";

const SCAN_STATUSES = new Set([
  "live",
  "empty",
  "unauthorized",
  "unconfigured",
  "failed",
]);

function supplierKeyFor(connection: {
  provider: string;
  config: Record<string, unknown>;
}): string {
  const configured = connection.config.supplierKey;
  return typeof configured === "string" && configured.trim()
    ? configured.trim()
    : connection.provider;
}

function latestCheckedAt(config: Record<string, unknown>): string | undefined {
  const candidates = [
    config.modelScanCheckedAt,
    config.scanCheckedAt,
    config.catalogCheckedAt,
  ].filter((value): value is string => typeof value === "string");
  const valid = candidates
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left));
  return valid[0];
}

function summarizeSuppliers(
  connections: ReadonlyArray<{
    provider: string;
    config: Record<string, unknown>;
  }>,
) {
  const summary: Record<
    string,
    {
      connections: number;
      statuses: Record<string, number>;
      lastCheckedAt?: string;
    }
  > = {};
  for (const connection of connections) {
    const supplier = supplierKeyFor(connection);
    const current =
      summary[supplier] ??
      (summary[supplier] = { connections: 0, statuses: {} });
    current.connections += 1;
    const configuredStatus = connection.config.modelScanStatus;
    const status =
      typeof configuredStatus === "string" && SCAN_STATUSES.has(configuredStatus)
        ? configuredStatus
        : "unscanned";
    current.statuses[status] = (current.statuses[status] ?? 0) + 1;
    const checkedAt = latestCheckedAt(connection.config);
    if (
      checkedAt &&
      (!current.lastCheckedAt ||
        Date.parse(checkedAt) > Date.parse(current.lastCheckedAt))
    )
      current.lastCheckedAt = checkedAt;
  }
  return summary;
}

function localAccessHeaders(request: Request): Headers {
  const headers = new Headers({
    vary: "Origin, Access-Control-Request-Private-Network",
  });
  const origin = request.headers.get("origin");
  const configured = process.env.PUBLIC_BASE_URL;
  let allowedOrigin: string | undefined;
  try {
    allowedOrigin = configured ? new URL(configured).origin : undefined;
  } catch {
    allowedOrigin = undefined;
  }
  if (origin && origin === allowedOrigin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "GET, OPTIONS");
    headers.set("access-control-max-age", "600");
    headers.set("cross-origin-resource-policy", "cross-origin");
    if (
      request.headers.get("access-control-request-private-network") === "true"
    ) {
      headers.set("access-control-allow-private-network", "true");
    }
  }
  return headers;
}

export function OPTIONS(request: Request) {
  const headers = localAccessHeaders(request);
  return new Response(null, {
    status: headers.has("access-control-allow-origin") ? 204 : 403,
    headers,
  });
}

export async function GET(request: Request) {
  const headers = localAccessHeaders(request);
  try {
    const [canvas, , connections] = await Promise.all([
      repository.ensureDefaultCanvas(),
      storage.healthCheck?.(),
      repository.listConnections().catch(() => []),
    ]);
    return Response.json(
      {
        ok: true,
        canvasId: canvas.id,
        components: {
          database: "ready",
          storage: "ready",
          queue: process.env.REDIS_URL ? "configured" : "in-process",
        },
        runtime: {
          // These are presence flags only; never return the actual key or
          // proxy URL from a public health response. They make a missing
          // PUBLIC_BASE_URL/MASTER_KEY immediately diagnosable because
          // providers such as 喵呜 and 辰途 require signed public assets.
          publicAssetUrlConfigured: Boolean(
            process.env.PUBLIC_BASE_URL?.trim(),
          ),
          masterKeyConfigured: Boolean(process.env.MASTER_KEY?.trim()),
          providerProxyConfigured: Boolean(
            process.env.PROVIDER_HTTP_PROXY?.trim() ||
              process.env.HTTPS_PROXY?.trim() ||
              process.env.HTTP_PROXY?.trim(),
          ),
        },
        suppliers: summarizeSuppliers(connections),
        time: new Date().toISOString(),
      },
      { headers },
    );
  } catch {
    return Response.json(
      {
        ok: false,
        error: "健康检查失败",
        time: new Date().toISOString(),
      },
      { status: 503, headers },
    );
  }
}
