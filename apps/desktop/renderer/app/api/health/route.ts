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

export async function GET() {
  const headers = new Headers({ "Cache-Control": "no-store" });
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
          queue: "in-process",
        },
        runtime: {
          // Presence flags only; never return credentials or proxy URLs.
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
