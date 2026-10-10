import type { ModelDescriptor, NormalizedRequest, StructuredModelPricing, StructuredPriceTier, ValidationIssue } from "./contracts.js";
import type { RestConnectorConfig, RestModelConnectorOverride } from "./rest.js";
import { cangyuanDocumentedImageModel, cangyuanDocumentedImageTransport, cangyuanDocumentedImageIssues, hasCangyuanImageDocument } from "./cangyuan-image-contract.js";

export const isCangyuanCurrentModel = (id: string | undefined): boolean => hasCangyuanImageDocument(id ?? "");
export function isCangyuanCurrentRequest(id: string | undefined, baseUrl?: string): boolean {
  if (!isCangyuanCurrentModel(id)) return false;
  try { return /(^|\.)cangyuansuanli\.cn$/u.test(new URL(baseUrl ?? "").hostname); } catch { return false; }
}
export const cangyuanCurrentModel = (model: ModelDescriptor): ModelDescriptor => cangyuanDocumentedImageModel(model);
export const cangyuanCurrentTransport = (id: string, parameters?: Readonly<Record<string, unknown>>): RestModelConnectorOverride | undefined => cangyuanDocumentedImageTransport(id, parameters);
export function cangyuanCurrentRequestIssues(request: NormalizedRequest, baseUrl?: string): ValidationIssue[] {
  return isCangyuanCurrentRequest(request.model, baseUrl) ? cangyuanDocumentedImageIssues(request) : [];
}
/** Preserve the requested shape; never substitute a generic K-to-pixel table. */
export const withCangyuanCurrentRequestParameters = (request: NormalizedRequest, _baseUrl?: string): NormalizedRequest => request;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Shared by the renderer and adapter; never import the server transport to inspect a contract. */
export function managesCangyuanCurrentTransport(settings: Readonly<Record<string, unknown>>, baseUrl: string | undefined, config: RestConnectorConfig, model?: string): boolean {
  if (!isCangyuanCurrentRequest(model, baseUrl)) return false;
  if ((Array.isArray(settings.manualModels) && settings.manualModels.some(row => isRecord(row) && row.id === model)) ||
      (isRecord(settings.autoModelInterfaces) && settings.autoModelInterfaces[model!])) return false;
  const override = config.modelOverrides?.[model!];
  if (JSON.stringify(override) === JSON.stringify(cangyuanCurrentTransport(model!))) return true;
  if (!["cangyuan-gpt-image-2", "cangyuan-gpt-image-2-4k"].includes(String(settings.preset))) return false;
  const definition = override?.submit ?? config.submit;
  if (definition.path !== "/v1/images/generations" || definition.bodyMode !== "json" || !definition.mappings?.length) return false;
  if (definition.template && (!isRecord(definition.template) || Object.keys(definition.template).some(k => !["async", "n"].includes(k)))) return false;
  const expected: Record<string, readonly string[]> = { "/model": ["$.model"], "/prompt": ["$.prompt"], "/size": ["$.parameters.size", "$.parameters.aspect_ratio"],
    "/quality": ["$.parameters.quality"], "/background": ["$.parameters.background"], "/n": ["$.parameters.n"], "/aspect_ratio": ["$.parameters.aspect_ratio"] };
  return definition.mappings.every(mapping => !mapping.when && (
    mapping.source.kind === "request" && expected[mapping.target]?.includes(mapping.source.path) ||
    mapping.target === "/response_format" && mapping.source.kind === "literal" && mapping.source.value === "url" ||
    mapping.target === "/images" && mapping.source.kind === "assets" && mapping.source.assetKind === "image"
  ));
}

export function canApplyCangyuanCurrentContract(settings: Readonly<Record<string, unknown>>, baseUrl: string | undefined, model?: string): boolean {
  const connector = settings.connector;
  return isRecord(connector) && isRecord(connector.submit) && managesCangyuanCurrentTransport(settings, baseUrl, connector as unknown as RestConnectorConfig, model);
}

/** Parse only the two published exact billing shapes; never execute supplier expressions. */
export function cangyuanCurrentPricing(id: string, expression: unknown, multiplier: number, checkedAt: string): StructuredModelPricing | undefined {
  if (id === "gemini-nano-banana-2.1") {
    const expected = 'has(param("quality"), "4k") || has(param("quality"), "4K") ? tier("4k", n * 0.10) : has(param("quality"), "2k") || has(param("quality"), "2K") ? tier("2k", n * 0.08) : tier("1k", n * 0.06)';
    const canonical = (s: string) => s.replace(/\s/gu, "").replace(/n\*(\d+(?:\.\d+)?)/gu, (_, v: string) => `n*${Number(v)}`);
    if (typeof expression !== "string" || canonical(expression) !== canonical(expected) || !Number.isFinite(multiplier) || multiplier < 0) return undefined;
    return { kind: "tiered", currency: "CNY", billingUnit: "image", sourceUrl: "https://ai.cangyuansuanli.cn/api/pricing", checkedAt, confidence: "exact",
      tiers: ["4k", "2k"].map<StructuredPriceTier>((value, i) => ({ id: value, label: value, price: Number(((i === 0 ? 0.1 : 0.08) * multiplier).toPrecision(12)),
        conditions: [{ parameter: "quality", operator: "contains" as const, value }], conditionMode: "all" as const })).concat([{ id: "1k", label: "1k", price: Number((0.06 * multiplier).toPrecision(12)), otherwise: true } as StructuredPriceTier]) };
  }
  if (!id.endsWith("-x") || typeof expression !== "string" || expression.length > 4096) return undefined;
  const rates = new Map([...expression.matchAll(/tier\("([^"\\]+)",\s*n\s*\*\s*(\d+(?:\.\d+)?)\)/gu)].map(m => [m[1]!, Number(m[2])]));
  const clean = expression.replace(/\s/gu, "");
  const tier = (label: string) => `tier("${label}",n*${rates.get(label)})`;
  let expected: string;
  const tiers: StructuredPriceTier[] = [];
  const condition = (parameter: string, value: string) => ({ parameter, operator: "equals" as const, value });
  const push = (label: string, conditions?: StructuredPriceTier["conditions"]) => {
    const raw = rates.get(label); if (raw === undefined) return;
    tiers.push({ id: `${label}-${tiers.length}`, label, price: Number((raw * multiplier).toPrecision(12)),
      ...(conditions ? { conditions, conditionMode: "all" as const } : { otherwise: true }) });
  };
  if (id === "gpt-image-2-x") {
    expected = ["4k", "2k", "1k"].map(k => `param("tier")=="${k}"?${tier(k)}:`).join("") + tier("web");
    for (const k of ["4k", "2k", "1k"]) push(k, [condition("tier", k)]);
    push("web");
  } else if (id === "gpt-image-2.5-x") {
    const branch = (series: string) => ["4k", "2k", "1k"].map(k => `param("tier")=="${k}"?((param("quality")=="xhigh"||param("quality")=="max")?${tier(`${series} ${k} xhigh`)}:${tier(`${series} ${k}`)}):`).join("") + tier(`${series} web`);
    expected = `param("series")=="flare"?(${branch("flare")}):(${branch("sunburst")})`;
    for (const series of ["flare", "sunburst"]) {
      for (const k of ["4k", "2k", "1k"]) {
        for (const quality of ["xhigh", "max"]) push(`${series} ${k} xhigh`, [condition("series", series), condition("tier", k), condition("quality", quality)]);
        push(`${series} ${k}`, [condition("series", series), condition("tier", k)]);
      }
      push(`${series} web`, [condition("series", series)]);
    }
  } else return undefined;
  // Numeric literals such as 0.40 and 0.4 are equivalent. Preserve all syntax around them.
  const canonical = (s: string) => s.replace(/\s/gu, "").replace(/n\*(\d+(?:\.\d+)?)/gu, (_, v: string) => `n*${Number(v)}`);
  if (canonical(clean) !== canonical(expected) || !Number.isFinite(multiplier) || multiplier < 0) return undefined;
  return { kind: "tiered", currency: "CNY", billingUnit: "image", tiers, checkedAt,
    sourceUrl: "https://ai.cangyuansuanli.cn/api/pricing", confidence: "exact" };
}
