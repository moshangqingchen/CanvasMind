import { loadCangyuanCatalog } from "../../lib/cangyuan-catalog";
import { normalizeCangyuanImageGroup } from "../../lib/provider-presets";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const group = searchParams.get("group");
  // Browsing the marketplace is read-only. Applying a catalog to saved
  // connections is reserved for an explicit model-refresh action.
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
  if (!normalizedGroup)
    return Response.json({ error: "沧元模型分组无效" }, { status: 400 });
  return Response.json({
    group: normalizedGroup,
    checkedAt: catalog.checkedAt,
    source: catalog.source,
    models: catalog.groups[normalizedGroup],
  });
}
