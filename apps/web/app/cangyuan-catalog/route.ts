import { loadCangyuanCatalog } from "../../lib/cangyuan-catalog";
import { isCangyuanImageGroup } from "../../lib/provider-presets";

export async function GET(request: Request) {
  const group = new URL(request.url).searchParams.get("group");
  const catalog = await loadCangyuanCatalog();
  if (!group)
    return Response.json({
      checkedAt: catalog.checkedAt,
      source: catalog.source,
      groups: catalog.marketplaceGroups,
    });
  if (!isCangyuanImageGroup(group))
    return Response.json({ error: "沧元模型分组无效" }, { status: 400 });
  return Response.json({
    group,
    checkedAt: catalog.checkedAt,
    source: catalog.source,
    models: catalog.groups[group],
  });
}
