import { createHash } from "node:crypto";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import type { CatalogApplyScope, CatalogAuthScope, CatalogEvidenceRole, CatalogReadItemSpec } from "./catalog-read-contracts";
import { mikotoNativeImageCatalogUrl, monsterNativeImageCatalogUrl } from "./monster-native-image-catalog";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const CATALOG_READ_PARSER_VERSION = "catalog-read-slice1-v1";

/** This internal gate cannot be enabled in a normal installed profile. */
export function catalogReadPreviewEnabled(environment: Record<string, string | undefined>): boolean {
  return environment.SUPERCANVAS_CATALOG_READ_PREVIEW === "1" && environment.USE_MEMORY_STORE === "ephemeral";
}

export function catalogReadSourceKey(input: Omit<CatalogReadItemSpec, "sourceKey" | "applyScope">): string {
  return digest([input.entryId, input.sourceUrl, input.parserVersion, input.authScope, input.role, input.requiredForMembership]);
}
export function catalogSafeSourceUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
    [...url.searchParams.keys()].some(key => /key|token|secret|password|cookie|auth/iu.test(key))) throw new Error("Invalid catalog source URL");
  return url.href;
}
export function catalogReadItem(entryId: string, sourceUrl: string, role: CatalogEvidenceRole, authScope: CatalogAuthScope,
  applyScope: CatalogApplyScope, requiredForMembership = false): CatalogReadItemSpec {
  const entry = { entryId, sourceUrl: catalogSafeSourceUrl(sourceUrl), role, authScope,
    parserVersion: CATALOG_READ_PARSER_VERSION, requiredForMembership };
  return { ...entry, sourceKey: catalogReadSourceKey(entry), applyScope: structuredClone(applyScope) };
}

export function catalogConnectionScopes(connection: ProviderConnectionRecord, supplier?: SupplierRecord): {
  apply: CatalogApplyScope; anonymous: CatalogAuthScope; key: CatalogAuthScope; account: CatalogAuthScope;
} {
  const origin = new URL(String(connection.config.baseUrl)).origin;
  const sourceId = supplier?.state?.sourceId ?? String(connection.config.supplierSourceId ?? `legacy:${origin}`);
  const supplierId = supplier?.id ?? `connection:${connection.id}`;
  const group = connection.config.accountKeyGroupId !== undefined ? `site-id:${String(connection.config.accountKeyGroupId)}`
    : `name:${String(connection.config.accountKeyGroup ?? connection.config.modelGroup ?? "")}`;
  return { apply: { supplierId, supplierSourceId: sourceId, connectionIds: [connection.id], groupIdentity: group },
    anonymous: { kind: "anonymous", principalRef: sourceId, credentialEpoch: digest([sourceId, supplier?.siteUrl ?? origin]) },
    key: { kind: "connection-key", principalRef: connection.id, credentialEpoch: digest([sourceId, connection.encryptedSecret,
      connection.config.baseUrl, group, connection.config.directorProtocol, connection.config.protocol]) },
    account: { kind: "site-account", principalRef: supplierId, credentialEpoch: digest([sourceId, supplier?.siteUrl, supplier?.state?.siteLogin]) } };
}

export function catalogSourcePlan(connection: ProviderConnectionRecord, supplier?: SupplierRecord): CatalogReadItemSpec[] {
  const scopes = catalogConnectionScopes(connection, supplier), base = catalogSafeSourceUrl(String(connection.config.baseUrl)).replace(/\/$/u, "");
  const parsedBase = new URL(base), host = parsedBase.hostname, plan: CatalogReadItemSpec[] = [];
  if (parsedBase.search) throw new Error("Catalog base URL cannot contain a query");
  const officialRoot = !parsedBase.port && /^\/(?:v1|v1beta)?\/?$/u.test(parsedBase.pathname);
  const add = (id: string, url: string, role: CatalogEvidenceRole, auth = scopes.anonymous, required = false) =>
    plan.push(catalogReadItem(id, url, role, auth, scopes.apply, required));
  add("key-models", `${base}/models`, "key-membership", scopes.key, true);
  const native = officialRoot ? monsterNativeImageCatalogUrl(connection.config) ?? mikotoNativeImageCatalogUrl(connection.config) : undefined;
  if (native) add("native-key-models", native, "key-membership", scopes.key, true);
  if (officialRoot && host === "ai.cangyuansuanli.cn") {
    add("cangyuan-homepage", "https://ai.cangyuansuanli.cn/", "health");
    add("cangyuan-documentation", "https://ai.cangyuansuanli.cn/docs/api", "schema");
    add("cangyuan-pricing", "https://ai.cangyuansuanli.cn/api/pricing", "catalog-offer");
  } else if (officialRoot && host === "tu.988236.xyz") {
    add("chentu-pricing", "https://tu.988236.xyz/api/pricing", "catalog-offer");
    add("chentu-image-capabilities", "https://tu.988236.xyz/v1/image/model-capabilities", "schema", scopes.key);
  } else if (officialRoot && host === "api.3365api.cn") add("cyberafei-pricing", "https://api.3365api.cn/api/pricing", "catalog-offer");
  else if (officialRoot && host === "api.miaowuai.store") {
    add("miaowu-pricing", "https://api.miaowuai.store/api/pricing", "catalog-offer");
    add("miaowu-media", "https://api.miaowuai.store/v1/dream/model_list", "key-membership", scopes.key, true);
  } else if (officialRoot && ["asian-acc.we-token.cc", "us-la.we-token.cc", "sub2api.we-token.cc", "video.we-token.cc"].includes(host)) {
    add("weai-model-plaza", `${new URL(base).origin}/api/v1/model-plaza`, "catalog-offer");
    if (host === "asian-acc.we-token.cc") add("weai-official-docs", "https://docs.we-ai.cc/guides/image-generation-service.html", "price");
  } else if (officialRoot && ["api.tk1688.com", "tk1688.com", "ai.tk1688.com"].includes(host)) {
    add("tk1688-marketplace", "https://tk1688.com/api/marketplace/listings", "catalog-offer");
    add("tk1688-status", "https://tk1688.com/api/status", "price");
    add("tk1688-account-models", "https://tk1688.com/api/user/models", "catalog-offer", scopes.account);
  }
  if (supplier) {
    const site = catalogSafeSourceUrl(supplier.siteUrl).replace(/\/$/u, "");
    const entry = (id: string, path: string, role: CatalogEvidenceRole, auth = scopes.anonymous) => {
      const url = `${site}${path}`;
      if (!plan.some(spec => spec.sourceUrl === url && spec.authScope.kind === auth.kind)) add(`supplier:${id}:${auth.kind}`, url, role, auth);
    };
    if (["auto", "newapi"].includes(supplier.kind)) {
      entry("pricing", "/api/pricing", "catalog-offer");
      if (supplier.state?.siteLogin) entry("pricing", "/api/pricing", "catalog-offer", scopes.account);
      entry("newapi-groups", "/api/user/self/groups", "catalog-offer", scopes.account);
    }
    if (["auto", "sub2api"].includes(supplier.kind)) {
      entry("plaza", "/api/v1/model-plaza", "catalog-offer");
      if (supplier.state?.siteLogin) entry("plaza", "/api/v1/model-plaza", "catalog-offer", scopes.account);
      entry("sub2api-groups", "/api/v1/groups/available", "catalog-offer", scopes.account);
      entry("pricing-channels", "/api/v1/pricing/channels", "price", scopes.account);
      if (["https://asian-acc.we-token.cc", "https://api.mikoto.vip", "https://api.eaheng.com", "https://tu.988236.xyz",
        "https://api.hangzhale.com", "https://synoralink.com", "https://vapi.chuangxiangai.asia", "https://ai.whyshy.cn", "https://token.secure-skill.com"].includes(site))
        entry("available-channels", "/api/v1/channels/available", "price", scopes.account);
    }
    entry("status", "/api/status", "health");
  }
  const site = supplier?.siteUrl.replace(/\/$/u, "") ?? parsedBase.origin;
  if (officialRoot && site === "https://synoralink.com" && parsedBase.origin === site) {
    add("supplement:synora-usage", `${site}/api/v1/usage?page=1&page_size=100`, "price", scopes.account);
    add("supplement:synora-announcements", `${site}/api/v1/announcements`, "price", scopes.account);
  }
  if (officialRoot && parsedBase.origin === "https://asian-acc.we-token.cc" && site === parsedBase.origin)
    add("supplement:weai-legacy-index", `${site}/api/v1/model-plaza-legacy/models`, "catalog-offer", scopes.account);
  if (officialRoot && parsedBase.origin === "https://api.hangzhale.com" && site === parsedBase.origin)
    add("supplement:hang-pricing", "https://price.hangzhale.com/api/provider/pricing", "price");
  if (officialRoot && parsedBase.origin === "https://ai.jiasuapi.com" && site === parsedBase.origin)
    add("supplement:jiasu-index", `${site}/`, "schema");
  if (officialRoot && parsedBase.origin === "https://api.eaheng.com" && site === parsedBase.origin) {
    add("supplement:monster-categories", `${site}/api/v1/plaza/categories`, "health", scopes.account);
    for (const range of ["90m", "24h", "7d", "30d"])
      add(`supplement:monster-range:${range}`, `${site}/api/v1/plaza?range=${range}`, "health", scopes.account);
  }
  return plan;
}
