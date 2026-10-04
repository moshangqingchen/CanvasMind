/** Display grouping only; exact IDs remain the saved and submitted model IDs. */
export interface Tk1688DisplayModel {
  id: string;
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export function tk1688ModelFamily(model: Tk1688DisplayModel): string | undefined {
  if (model.metadata?.tk1688Catalog !== true) return undefined;
  const base = model.metadata.tk1688BaseModel;
  if (typeof base !== "string" || !base.trim()) return undefined;
  return model.id === base || model.id.startsWith(`${base}@s`) && /@s\d+c\d+$/u.test(model.id) ? base : undefined;
}

export function groupTk1688Models<T extends Tk1688DisplayModel>(models: readonly T[]) {
  const groups = new Map<string, { id: string; models: T[]; smart?: T; merchants: T[] }>();
  for (const model of models) {
    const id = tk1688ModelFamily(model);
    if (!id) continue;
    const group = groups.get(id) ?? { id, models: [], merchants: [] };
    if (model.id === id) group.smart = model;
    else group.merchants.push(model);
    group.models.push(model);
    groups.set(id, group);
  }
  // Keep the automatic route first without changing the source directory.
  return [...groups.values()].map(group => ({ ...group,
    models: [...(group.smart ? [group.smart] : []), ...group.merchants] }));
}

export function tk1688RouteLabel(model: Tk1688DisplayModel): string | undefined {
  const base = tk1688ModelFamily(model);
  if (!base) return undefined;
  if (model.id === base) return "自动路由";
  const alias = model.id.match(/@s(\d+)c(\d+)$/u)!;
  return `商家 ${alias[1]} · 渠道 ${alias[2]}`;
}

export function tk1688RouteSummary(model: Tk1688DisplayModel): string | undefined {
  const base = tk1688ModelFamily(model);
  if (!base) return undefined;
  const metadata = model.metadata!;
  const facts: string[] = [];
  if (model.id === base) facts.push("平台自动选路，商家规格和价格可能不同");
  else {
    if (typeof metadata.tk1688FixedSize === "string") facts.push(`固定 ${metadata.tk1688FixedSize.replace("x", "×")}`);
    else if (Array.isArray(metadata.tk1688SupportedResolutions)) {
      const tiers = ["1K", "2K", "4K"].filter(tier => (metadata.tk1688SupportedResolutions as unknown[]).includes(tier));
      if (tiers.length) facts.push(`商家声明 ${tiers.join(" / ")}`);
      else if (metadata.protocol === "openai-images") facts.push("分辨率档位未公布");
    }
    if (metadata.tk1688OmitN === true) facts.push("一次 1 张");
    const description = typeof metadata.supplierChannelDescription === "string" ? metadata.supplierChannelDescription : model.description;
    if (description?.trim()) facts.push(`商家说明：${description.trim()}`);
  }
  if (metadata.tk1688CatalogStale === true) facts.push("上次目录，本次未确认");
  return facts.join(" · ") || undefined;
}

export function tk1688ModelSearchText(model: Tk1688DisplayModel): string {
  return [model.id, model.name, tk1688RouteLabel(model), tk1688RouteSummary(model)]
    .filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase();
}
