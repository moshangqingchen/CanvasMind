import type { Repository } from "@super-canvas/db";
import { assetToBlob, decryptSecret, loginSupplierSite, providerFetch, supplierDirectoryBase,
  type FetchImplementation, type ProviderAssetInput, type ProviderConnectionResolver } from "@super-canvas/providers";

/** Website uploads use the encrypted login tied to the frozen supplier source. */
export function langframeReferenceUploader(repository: Repository, resolver: ProviderConnectionResolver, masterKey: () => string | undefined,
  fetchImpl: FetchImplementation = providerFetch) {
  return async (connectionId: string, asset: ProviderAssetInput): Promise<string> => {
    const connection = await resolver.resolve(connectionId), config = connection.settings ?? {};
    const supplier = typeof config.supplierId === "string" ? await repository.getSupplier(config.supplierId) : null;
    const base = supplierDirectoryBase(connection.baseUrl ?? ""), login = supplier?.state?.siteLogin;
    if (connection.provider !== "langframe" || !supplier || !["https://vipprompt.cn", "https://www.vipprompt.cn"].includes(base ?? "") ||
      supplier.state?.visibility === "deleted" || supplier.state?.sourceId !== config.supplierSourceId ||
      supplierDirectoryBase(supplier.apiUrl) !== base || supplierDirectoryBase(supplier.siteUrl) !== base || login?.siteUrl !== base)
      throw new Error("狼帧素材上传缺少同一供应商来源的有效站点登录；生成尚未提交");
    const key = masterKey();
    if (!key) throw new Error("缺少 MASTER_KEY，无法解密狼帧站点登录；生成尚未提交");
    const blob = await assetToBlob(asset, fetchImpl);
    const credentials = login.authMode === "access-token"
      ? { accessToken: decryptSecret(login.encryptedAccessToken, key) }
      : { username: login.username, password: decryptSecret(login.encryptedPassword, key) };
    const session = await loginSupplierSite({ siteUrl: base!, kind: "langframe", credentials }, fetchImpl, { allowLangframeMediaUpload: true });
    const name = asset.filename || `reference-${asset.id}`;
    const response = await session.fetch(`${base}/api/canvas/media-upload`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(180_000),
      headers: { "Content-Type": "application/octet-stream", "X-Media-Kind": asset.kind, "X-File-Name": encodeURIComponent(name) },
      body: new Uint8Array(await blob.arrayBuffer()) });
    const data: unknown = await response.json().catch(() => undefined);
    if (!response.ok || !data || typeof data !== "object" || !("ok" in data) || data.ok !== true || !("url" in data) || typeof data.url !== "string")
      throw new Error(`狼帧素材上传失败（HTTP ${response.status}）；生成尚未提交`);
    let url: URL;
    try { url = new URL(data.url, `${base}/`); } catch { throw new Error("狼帧素材上传返回无效 URL；生成尚未提交"); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
      throw new Error("狼帧素材上传返回非公开 HTTP(S) URL；生成尚未提交");
    return url.href;
  };
}
