/** This exact official row declares video output, but its token placeholder
 * conflicts with the group price wording and no executable contract is public.
 * Keep this predicate dependency-free so clients do not load provider transports. */
export function isCyberAfeiUnpricedCatalogVideo(siteUrl: string | undefined, modelId: string): boolean {
  if (modelId !== "ya-sd25-30s") return false;
  try {
    const url = new URL(siteUrl ?? "");
    return url.origin === "https://api.3365api.cn" && !url.username && !url.password && !url.search && !url.hash &&
      ["/", "/v1", "/v1/", "/api/pricing"].includes(url.pathname);
  } catch { return false; }
}
