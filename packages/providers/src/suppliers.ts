export interface ProviderSupplierProfile {
  key: string;
  label: string;
  websiteUrl?: string;
  errorDocsUrl?: string;
}

/**
 * Resolve the supplier namespace stored on a connection.  A supplier is the
 * product/account boundary shown in settings; the provider adapter is only
 * the transport used to call it. Keeping this resolver in the shared package
 * makes API routes and the browser use the same identity rules.
 */
export function providerSupplierKeyForConnection(input: {
  provider: string;
  config?: Readonly<Record<string, unknown>>;
}): string {
  const config = input.config ?? {};
  const preset = typeof config.preset === "string" ? config.preset : "";
  const presetSuppliers: Readonly<Record<string, string>> = {
    "cangyuan-gpt-image-2": "cangyuan",
    "cangyuan-gpt-image-2-4k": "cangyuan",
    "cyberafei-api": "cyberafei",
    "chentu-openai-images": "chentu",
    "frimodel-openai-images": "frimodel",
    "mikoto-pro": "mikoto",
    "miaowu-openai-videos": "miaowu",
  };
  const presetSupplier = presetSuppliers[preset];
  if (presetSupplier) return presetSupplier;
  const configured = config.supplierKey;
  if (typeof configured === "string" && configured.trim())
    return configured.trim();
  return input.provider.trim();
}

const supplierProfiles: Readonly<Record<string, ProviderSupplierProfile>> = {
  cangyuan: {
    key: "cangyuan",
    label: "沧元算力",
    websiteUrl: "https://ai.cangyuansuanli.cn/",
  },
  frimodel: {
    key: "frimodel",
    label: "FriModel",
    websiteUrl: "https://platform.frimodel.com/",
    errorDocsUrl: "https://ai-doc.apifox.cn",
  },
  chentu: {
    key: "chentu",
    label: "辰途 API",
    websiteUrl: "https://tu.988236.xyz/",
    errorDocsUrl: "https://tu.988236.xyz/docs/",
  },
  cyberafei: {
    key: "cyberafei",
    label: "赛博阿飞 API",
    websiteUrl: "https://api.3365api.cn/",
    errorDocsUrl: "https://api.3365api.cn/docs/",
  },
  mikoto: {
    key: "mikoto",
    label: "MikotoPro",
    websiteUrl: "https://api.mikoto.vip/",
  },
  miaowu: {
    key: "miaowu",
    label: "喵呜 API",
    websiteUrl: "https://api.miaowuai.store/pricing",
    errorDocsUrl: "https://api.miaowuai.store/docs/openai-videos",
  },
  weai: {
    key: "weai",
    label: "We-AI",
    websiteUrl: "https://asian-acc.we-token.cc/dashboard",
    errorDocsUrl: "https://docs.we-ai.cc/guides/image-generation.html",
  },
  openai: {
    key: "openai",
    label: "OpenAI",
    websiteUrl: "https://platform.openai.com/",
    errorDocsUrl:
      "https://platform.openai.com/docs/guides/error-codes/api-errors",
  },
  runway: {
    key: "runway",
    label: "Runway",
    websiteUrl: "https://dev.runwayml.com/",
    errorDocsUrl: "https://docs.dev.runwayml.com/errors/errors/",
  },
  rest: { key: "rest", label: "通用 REST" },
  fake: { key: "fake", label: "Fake（离线演示）" },
};

export const PROVIDER_SUPPLIER_PROFILES = Object.freeze(
  Object.values(supplierProfiles),
);

export function providerSupplierProfile(
  key: string | undefined,
): ProviderSupplierProfile | undefined {
  const normalized = key?.trim();
  return normalized ? supplierProfiles[normalized] : undefined;
}

export function providerSupplierLabel(key: string): string {
  return providerSupplierProfile(key)?.label ?? key;
}

export function providerSupplierWebsite(
  key: string | undefined,
): string | undefined {
  return providerSupplierProfile(key)?.websiteUrl;
}
