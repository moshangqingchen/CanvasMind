import { loadCangyuanCatalog } from "../../../../lib/cangyuan-catalog";
import { isCangyuanImageGroup } from "../../../../lib/provider-presets";
import { jsonError } from "../../../../lib/server";

export async function GET(request: Request) {
  const group = new URL(request.url).searchParams.get("group");
  const catalog = await loadCangyuanCatalog();
  if (!group)
    return Response.json({
      checkedAt: catalog.checkedAt,
      source: catalog.source,
      groups: catalog.marketplaceGroups,
    });
  if (!isCangyuanImageGroup(group)) return jsonError("沧元模型分组无效", 400);
  return Response.json({
    group,
    checkedAt: catalog.checkedAt,
    source: catalog.source,
    models: catalog.groups[group],
  });
}
