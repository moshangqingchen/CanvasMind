import { fetchProviderBytes, providerFetch, type ModelDescriptor } from "@super-canvas/providers";

export type InterfaceDocument = { url: string; body: unknown; priority?: number };
const documents = new Map<string, { until: number; result: Promise<InterfaceDocument[]> }>();

function jsonDocuments(text: string): unknown[] {
  const decode = (value: string) => value.replace(/&quot;/gu, '"').replace(/&#39;|&apos;/gu, "'").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&");
  const values: unknown[] = [];
  const parse = (value: string) => { try { values.push(JSON.parse(decode(value))); } catch { /* Never execute prose or page code. */ } };
  parse(text);
  for (const match of text.matchAll(/<(?:script|pre|code)\b[^>]*>([\s\S]*?)<\/(?:script|pre|code)>/giu))
    parse(match[1]!.replace(/<[^>]+>/gu, ""));
  return values.filter(value => value && typeof value === "object" && /^(?:2|3)\./u.test(String((value as Record<string, unknown>).openapi ?? (value as Record<string, unknown>).swagger ?? "")));
}

/** Anonymous bounded reads of supplier-linked documentation; no Key or page execution. */
export async function readSupplierInterfaceDocuments(baseUrl: string, models: readonly ModelDescriptor[], siteUrl = baseUrl): Promise<InterfaceDocument[]> {
  let base: URL;
  try { base = new URL(baseUrl); } catch { return []; }
  if (base.protocol !== "https:" || base.username || base.password) return [];
  let site: URL;
  try { site = new URL(siteUrl); } catch { site = base; }
  if (site.protocol !== "https:" || site.username || site.password) site = base;
  const urls = new Map<string, number>();
  for (const model of models) {
    const raw = model.metadata?.documentationUrl ?? model.metadata?.docsUrl;
    if (typeof raw !== "string") continue;
    try {
      const url = new URL(raw, site);
      url.hash = "";
      if (url.protocol === "https:" && !url.username && !url.password && !url.search) urls.set(url.href, 0);
    } catch { /* Ignore malformed links. */ }
    if (urls.size >= 12) break;
  }
  const linked = [...urls];
  for (const origin of [site, base]) {
    const prefix = origin.pathname.replace(/\/(?:v1|v1beta)\/?$/u, "").replace(/\/$/u, "");
    for (const path of [prefix + "/openapi.json", prefix + "/swagger.json", origin.pathname.replace(/\/$/u, "") + "/openapi.json"])
      if (!urls.has(new URL(path, origin.origin).href)) urls.set(new URL(path, origin.origin).href, 1);
  }
  const key = JSON.stringify([...urls]);
  let cached = documents.get(key);
  if (!cached || cached.until <= Date.now()) {
    const result = (async () => {
      const visited = new Set<string>();
      const read = async (url: string, priority: number, follow = true): Promise<InterfaceDocument[]> => {
        if (visited.has(url) || visited.size >= 32) return [];
        visited.add(url);
        try {
          const response = await fetchProviderBytes(providerFetch, url, { phase: "connect", timeoutMs: 8000, maxResponseBytes: 1024 * 1024 });
          const text = new TextDecoder().decode(response.data);
          const found = jsonDocuments(text).map(body => ({ url, body, priority }));
          if (!follow) return found;
          // Read only literal schema links; Swagger initialization code remains inert.
          const links = [...text.matchAll(/(?:href\s*=|\burl\s*:)\s*["']([^"'\s<>]+\.json)["']/giu)]
            .flatMap(match => {
              try {
                const target = new URL(match[1]!, url);
                return target.origin === new URL(url).origin && !target.username && !target.password ? [target.href] : [];
              } catch { return []; }
            }).slice(0, 4);
          return [...found, ...(await Promise.all(links.map(link => read(link, priority, false)))).flat()];
        } catch { return []; }
      };
      const preferred = (await Promise.all(linked.map(([url, priority]) => read(url, priority)))).flat();
      const fallback = (await Promise.all([...urls].filter(([url]) => !linked.some(([link]) => link === url)).map(([url, priority]) => read(url, priority)))).flat();
      return [...preferred, ...fallback];
    })();
    if (documents.size >= 32) documents.delete(documents.keys().next().value!);
    cached = { until: Date.now() + 300000, result };
    documents.set(key, cached);
  }
  return cached.result;
}
