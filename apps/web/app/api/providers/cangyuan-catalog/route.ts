import { loadCangyuanCatalog } from "../../../../lib/cangyuan-catalog";
import { normalizeCangyuanImageGroup } from "../../../../lib/provider-presets";
import { jsonError } from "../../../../lib/server";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const group = searchParams.get("group");
  // Catalog browsing is read-only; never rewrite every saved connection when
  // the settings panel is opened.
  const catalog = await loadCangyuanCatalog({
    force: searchParams.get("refresh") === "1",
  });
  if (!group)
    return Response.json({
      checkedAt: catalog.checkedAt,
      source: catalog.source,
      groups: catalog.marketplaceGroups,
    });
  const normalizedGroup = normalizeCangyuanImageGroup(group);
  if (!normalizedGroup) return jsonError("沧元模型分组无效", 400);
  return Response.json({
    group: normalizedGroup,
    checkedAt: catalog.checkedAt,
    source: catalog.source,
    models: catalog.groups[normalizedGroup],
  });
}
