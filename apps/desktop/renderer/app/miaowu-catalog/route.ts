import {
  loadMiaowuCatalog,
  miaowuModelsForGroup,
} from "../../lib/miaowu-catalog";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const group = searchParams.get("group")?.trim();
  const catalog = await loadMiaowuCatalog({
    force: searchParams.get("refresh") === "1",
  });
  if (!group) {
    return Response.json({
      checkedAt: catalog.checkedAt,
      source: catalog.source,
      groups: catalog.marketplaceGroups,
    });
  }
  if (!catalog.marketplaceGroups.some((item) => item.id === group)) {
    return Response.json({ error: "喵呜模型分组无效" }, { status: 400 });
  }
  return Response.json({
    group,
    checkedAt: catalog.checkedAt,
    source: catalog.source,
    models: miaowuModelsForGroup(catalog, group),
  });
}
