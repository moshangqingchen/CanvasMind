import type { ModelDescriptor, StructuredModelPricing, ValidationIssue } from "./contracts.js";

/** One captured /api/pricing row explicitly enables both named groups. */
export const CYBER_SEEDANCE25_PRICE_GROUPS = ["图片视频模型综合分组", "特价seedance2.0"] as const;
export const CYBER_SEEDANCE25_PRICE_TIERS = ["480p", "720p"] as const;
export const CYBER_SEEDANCE25_PRICE_ROW_SHA256 = "c441466253e1d919d36f95977ecb94de89bd8b8ade68f564a9ad05010c269c51";

export function cyberafeiSeedance25OwnPriceTiers(model: ModelDescriptor | undefined, group: string): { tiers: string[]; source: Record<string, unknown> } {
  const initialDocumentationReadSnapshot = { url: "https://api.3365api.cn/api/pricing", checkedAt: "2026-10-11T03:36:35.347Z", sha256: CYBER_SEEDANCE25_PRICE_ROW_SHA256 };
  const official = model?.metadata?.officialCatalogPricing as StructuredModelPricing | undefined;
  const identity = model?.metadata?.supplierPriceGroup ?? model?.metadata?.modelGroup ?? model?.metadata?.catalogGroup;
  const pricing = identity === group ? official ?? model?.pricing : undefined;
  // Current same-group structured source replaces the initial documentation
  // snapshot, including added/deleted tariff tiers. Never use a sibling group.
  if (pricing?.sourceUrl === "https://api.3365api.cn/api/pricing" && pricing.kind === "tiered") {
    const tiers = [...new Set((pricing.tiers ?? []).flatMap(tier => tier.dimension === "resolution" && typeof tier.value === "string" ? [tier.value] : []))];
    return { tiers, source: { origin: "https://api.3365api.cn", group, fullModelId: "seedance2.5", url: pricing.sourceUrl,
      checkedAt: pricing.checkedAt, basis: "same-group-official-pricing", initialDocumentationReadSnapshot } };
  }
  return { tiers: [...CYBER_SEEDANCE25_PRICE_TIERS], source: { origin: "https://api.3365api.cn", group, fullModelId: "seedance2.5",
    basis: "initial-documentation-read", initialDocumentationReadSnapshot } };
}

export function isCyberafeiSeedance25PriceSizeContract(baseUrl: unknown, group: unknown, fullId: unknown, model?: ModelDescriptor): boolean {
  if (fullId !== "seedance2.5" || !CYBER_SEEDANCE25_PRICE_GROUPS.includes(group as typeof CYBER_SEEDANCE25_PRICE_GROUPS[number]) ||
      ["manual", "paid-test"].includes(String(model?.metadata?.source)) || model?.metadata?.protocolEvidence === "paid-test") return false;
  try {
    const url = new URL(String(baseUrl));
    return url.origin === "https://api.3365api.cn" && !url.username && !url.password &&
      ["", "/", "/v1", "/v1/"].includes(url.pathname) && !url.search && !url.hash;
  } catch { return false; }
}

/** These are application preferences. The endpoint receives only the given size. */
export function cyberafeiSeedance25SizePreferenceIssues(parameters: Readonly<Record<string, unknown>>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, code: "invalid_parameter", message });
  const selected = (value: unknown) => value !== undefined && value !== "" && value !== "auto";
  const ratioKeys = ["aspect_ratio", "aspectRatio", "ratio"] as const;
  const ratios = ratioKeys.filter(key => selected(parameters[key]));
  if (ratios.some(key => parameters[key] !== parameters[ratios[0]!]))
    add("parameters.aspect_ratio", "已保存的比例字段存在冲突，请修改为一致值；原参数已保留。");
  const ratio = ratios.length ? parameters[ratios[0]!] : undefined;
  const ratioMatch = typeof ratio === "string" ? /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/u.exec(ratio) : undefined;
  const validRatio = ratioMatch && [ratioMatch[1], ratioMatch[2]].every(value => Number.isFinite(Number(value)) && Number(value) > 0) &&
    Number.isFinite(Number(ratioMatch[1]) / Number(ratioMatch[2])) && Number(ratioMatch[1]) / Number(ratioMatch[2]) > 0;
  if (ratio !== undefined && !validRatio)
    add("parameters.aspect_ratio", "比例是应用偏好，由 size 的宽高表达；请输入正数宽高比或清除此偏好。");
  const size = parameters.size;
  const match = typeof size === "string" ? /^(\d+)x(\d+)$/u.exec(size) : undefined;
  const validSize = match && [match[1], match[2]].every(value => Number.isSafeInteger(Number(value)) && Number(value) > 0);
  if (selected(size) && !validSize)
    add("parameters.size", "size 必须是正整数宽x高；该完整型号没有公布像素上下限或步长，原输入已保留。");
  if ((selected(parameters.resolution) || ratio !== undefined) && !validSize)
    add("parameters.size", "计价档位和比例是应用偏好；请独立填写 size 的 W/H，接口只发送原像素尺寸，不自动补造档位像素。");
  if (validSize && validRatio) {
    const left = Number(match[1]) / Number(match[2]);
    const right = Number(ratioMatch[1]) / Number(ratioMatch[2]);
    // Numerical roundoff tolerance only; this is an application preference
    // consistency check, never a supplier pixel or aspect-ratio restriction.
    if (Math.abs(left - right) > Number.EPSILON * Math.max(Math.abs(left), Math.abs(right), 1) * 8)
      add("parameters.aspect_ratio", "所填 W/H 与已保存的比例偏好不一致，请修改其中一项；不会自动改变 size 或忽略比例。");
  }
  return issues;
}
