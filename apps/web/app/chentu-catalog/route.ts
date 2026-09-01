import { NextResponse } from "next/server";
import { getRepository } from "@super-canvas/db";
import { providerFetch } from "@super-canvas/providers";
import { CHENTU_PRESET_ID } from "../../lib/chentu-presets";
import { loadChentuCatalog } from "../../lib/chentu-catalog";
import { scanChentuConnection } from "../../lib/chentu-server";

export const dynamic = "force-dynamic";

function groupOf(connection: { config: Record<string, unknown> }): string {
  return typeof connection.config.modelGroup === "string"
    ? connection.config.modelGroup.trim()
    : "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const group = url.searchParams.get("group")?.trim();
  const refresh = url.searchParams.get("refresh") === "1";
  const catalog = await loadChentuCatalog({
    force: refresh,
    fetch: providerFetch,
  });
  const connections = (await getRepository().listConnections()).filter(
    (connection) => connection.config.preset === CHENTU_PRESET_ID,
  );

  if (group) {
    const connection =
      connections.find(
        (item) => groupOf(item) === group && item.config.usage === "canvas",
      ) ?? connections.find((item) => groupOf(item) === group);
    if (!connection) {
      return NextResponse.json({
        group,
        checkedAt: catalog.checkedAt,
        source: catalog.source,
        scanStatus: "unconfigured",
        models: catalog.groups[group] ?? [],
      });
    }
    const scan = await scanChentuConnection(connection.id, {
      forcePricing: refresh,
      persist: refresh,
    });
    return NextResponse.json({
      group,
      checkedAt: scan.checkedAt,
      source: catalog.source,
      scanStatus: scan.status,
      scanError: scan.error,
      scannedModelCount: scan.modelIds.length,
      models: scan.canvasModels,
      inventoryModels: scan.marketplaceGroup?.models ?? [],
    });
  }

  const connectionByGroup = new Map<string, (typeof connections)[number]>();
  for (const connection of connections) {
    const connectionGroup = groupOf(connection);
    if (!connectionGroup) continue;
    const current = connectionByGroup.get(connectionGroup);
    if (!current || connection.config.usage === "canvas")
      connectionByGroup.set(connectionGroup, connection);
  }
  if (!refresh)
    return NextResponse.json({
      checkedAt: catalog.checkedAt,
      source: catalog.source,
      groups: catalog.marketplaceGroups.map((item) => ({
        ...item,
        scanStatus: "saved",
      })),
    });
  const scans = await Promise.all(
    [...connectionByGroup.values()].map((connection) =>
      scanChentuConnection(connection.id, {
        forcePricing: true,
        persist: true,
      }),
    ),
  );
  const scanByGroup = new Map(
    scans.flatMap((scan) => {
      const scanGroup = scan.marketplaceGroup?.id;
      return scanGroup ? [[scanGroup, scan] as const] : [];
    }),
  );
  const groupIds = new Set([
    ...catalog.marketplaceGroups.map((item) => item.id),
    ...scanByGroup.keys(),
  ]);
  const groups = [...groupIds]
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .map((id) => {
      const scan = scanByGroup.get(id);
      const publicGroup = catalog.marketplaceGroups.find(
        (item) => item.id === id,
      );
      if (!scan)
        return {
          ...(publicGroup ?? {
            id,
            description: "",
            ratio: 1,
            canvasSupported: false,
            canvasModelCount: 0,
            models: [],
          }),
          scanStatus: "unconfigured",
        };
      return {
        ...(scan.marketplaceGroup ??
          publicGroup ?? {
            id,
            description: "",
            ratio: 1,
            canvasSupported: false,
            canvasModelCount: 0,
            models: [],
          }),
        scanStatus: scan.status,
        scanCheckedAt: scan.checkedAt,
        scanError: scan.error,
        scannedModelCount: scan.modelIds.length,
      };
    });
  return NextResponse.json({
    checkedAt: catalog.checkedAt,
    source: catalog.source,
    groups,
  });
}
