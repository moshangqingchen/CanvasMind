import type { ModelDescriptor } from "./contracts.js";
import type { SupplierCatalogDiscovery } from "./supplier-catalog.js";

/** Dated, exact identities from the authorized 2026-10-14 recheck. These are
 * current menu removals, not permanent supplier shutdown assertions. */
export const SUPPLIER_MEDIA_REMOVALS_20261014 = [
  ...["deal", "default", "dreamina", "vip", "内部", "特价分组"].map(group => ({ host: "api.miaowuai.store", group, model: "seedance-2.5-pro" })),
  ...["vip", "内部", "特价分组"].flatMap(group => ["mjv8.2", "niji7"].map(model => ({ host: "api.miaowuai.store", group, model }))),
  { host: "api.miaowuai.store", group: "内部", model: "seedream-5-0-pro" },
  ...["sd-2.0-mini-J1", "seedance-2.0-X6", "wan-3.0-特惠", "wan-3.0-特惠-1"].map(model => ({ host: "ai.jiasuapi.com", group: "vip", model })),
  ...["SD2.0fast稳定900D", "SD2.0mini稳定900B"].map(model => ({ host: "newapi.jijiucanvas.com", group: "视频SD2.0", model })),
  { host: "newapi.jijiucanvas.com", group: "稳定满血视频模型", model: "稳定seedance-2.5全参D" },
  ...["VIDEO", "全模型-无claude/gpt"].flatMap(group => ["sd10-seedance-2.0", "sd10-seedance-2.0-fast", "sd10-seedance-2.0-mini"]
    .map(model => ({ host: "ai.cangyuansuanli.cn", group, model }))),
  { host: "tu.988236.xyz", group: "低价gemni生图", model: "leo-gemini-3.1-flash-image-preview" },
  ...["sd10-seedance-2.0", "sd10-seedance-2.0-fast", "sd10-seedance-2.0-mini", "sd15-seedance-2.0", "sd15-seedance-2.5"]
    .map(model => ({ host: "vapi.chuangxiangai.asia", group: "27", model })),
] as const;

const evidenceAt: Readonly<Record<string, string>> = {
  "api.miaowuai.store": "2026-10-14T23:27:25.807Z", "ai.jiasuapi.com": "2026-10-14T23:27:34.393Z",
  "newapi.jijiucanvas.com": "2026-10-14T23:27:39.897Z", "ai.cangyuansuanli.cn": "2026-10-14T23:26:49.630Z",
  "tu.988236.xyz": "2026-10-14T23:27:28.591Z", "vapi.chuangxiangai.asia": "2026-10-14T23:27:38.775Z",
};
const marker = "supplierAvailability20261014";

/** Only a complete, nonempty, exact-group refresh can confirm a menu removal.
 * Failed/empty/partial reads preserve the previous state. Returning models
 * clear only this function's own marker; other availability restrictions remain. */
export function applySupplierModelAvailability(
  models: readonly ModelDescriptor[], group: string, catalog: SupplierCatalogDiscovery,
  sourceUrl?: string, supplierGroupId?: string,
): ModelDescriptor[] {
  let host: string;
  try { const url = new URL(sourceUrl ?? ""); if (url.username || url.password || url.port) return [...models]; host = url.hostname; }
  catch { return [...models]; }
  const at = Date.parse(catalog.checkedAt);
  if (catalog.status !== "live" || catalog.complete !== true || !Number.isFinite(at) || at < Date.parse(evidenceAt[host] ?? "") || !evidenceAt[host]) return [...models];
  const groups = supplierGroupId ? catalog.groups.filter(item => item.supplierGroupId === supplierGroupId)
    : catalog.groups.filter(item => item.id === group);
  const selected = groups.length === 1 ? groups[0] : undefined;
  if (!selected || selected.details?.stale || !selected.models.length) return [...models];
  const identity = supplierGroupId ?? selected.supplierGroupId ?? group;
  return models.map(model => {
    const ownMarker = model.metadata?.[marker];
    const present = selected.models.some(item => item.id === model.id && item.metadata?.supplierCatalogModelStale !== true);
    if (present && ownMarker === `${host}/${identity}/${model.id}`) {
      const metadata = { ...model.metadata };
      if (metadata.canvasUnavailableReason === "当前官方分组目录未列出此型号") {
        const previous = metadata.supplierAvailabilityPreviousRunnable;
        if (typeof previous === "boolean") metadata.canvasRunnable = previous;
        else delete metadata.canvasRunnable;
        delete metadata.canvasUnavailableReason;
      }
      for (const key of [marker, "supplierAvailabilityPreviousRunnable", "supplierAvailabilityCheckedAt", "supplierAvailabilitySourceUrl"]) delete metadata[key];
      return { ...model, metadata };
    }
    const removal = SUPPLIER_MEDIA_REMOVALS_20261014.some(item => item.host === host && item.group === identity && item.model === model.id);
    if (present || !removal) return model;
    return { ...model, metadata: { ...model.metadata,
      ...(ownMarker ? {} : { supplierAvailabilityPreviousRunnable: model.metadata?.canvasRunnable }),
      [marker]: `${host}/${identity}/${model.id}`, supplierAvailabilityCheckedAt: catalog.checkedAt,
      supplierAvailabilitySourceUrl: `${new URL(sourceUrl!).origin}${host === "vapi.chuangxiangai.asia" ? "/api/v1/model-plaza" : "/api/pricing"}`,
      canvasRunnable: false, canvasUnavailableReason: "当前官方分组目录未列出此型号" } };
  });
}
