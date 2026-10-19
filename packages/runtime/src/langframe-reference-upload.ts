import type { Repository } from "@super-canvas/db";
import { assetToBlob, decryptSecret, loginSupplierSite, MaterialPreparationError, prepareMaterial, ProviderHttpError, providerFetch, supplierDirectoryBase, verifyReferenceOriginal,
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
      throw new MaterialPreparationError("initialize", { detail: "狼帧素材上传缺少同一供应商来源的有效站点登录" });
    const key = masterKey();
    if (!key) throw new MaterialPreparationError("initialize", { detail: "缺少 MASTER_KEY，无法解密狼帧站点登录" });
    const blob = await prepareMaterial("read", () => assetToBlob(asset, fetchImpl));
    const credentials = await prepareMaterial("initialize", async () => login.authMode === "access-token"
      ? { accessToken: decryptSecret(login.encryptedAccessToken, key) }
      : { username: login.username, password: decryptSecret(login.encryptedPassword, key) });
    const session = await prepareMaterial("initialize", () => loginSupplierSite({ siteUrl: base!, kind: "langframe", credentials }, fetchImpl, { allowLangframeMediaUpload: true }));
    const name = asset.filename || `reference-${asset.id}`;
    const bytes = new Uint8Array(await prepareMaterial("read", () => blob.arrayBuffer()));
    const response = await prepareMaterial("upload", () => session.fetch(`${base}/api/canvas/media-upload`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(180_000),
      headers: { "Content-Type": "application/octet-stream", "X-Media-Kind": asset.kind, "X-File-Name": encodeURIComponent(name) },
      body: bytes }));
    const data: unknown = await response.json().catch(() => undefined);
    if (!response.ok || !data || typeof data !== "object" || !("ok" in data) || data.ok !== true || !("url" in data) || typeof data.url !== "string")
      throw new MaterialPreparationError("upload", { detail: `狼帧素材上传失败（HTTP ${response.status}）`, cause: new ProviderHttpError("狼帧素材上传失败", {
        kind: "provider", phase: "prepare", status: response.status, retryable: false, submissionMayHaveOccurred: false,
      }) });
    let url: URL;
    try { url = new URL(data.url, `${base}/`); } catch { throw new MaterialPreparationError("upload", { detail: "狼帧素材上传返回无效 URL" }); }
    if (url.protocol !== "https:" || url.username || url.password)
      throw new MaterialPreparationError("upload", { detail: "狼帧素材上传返回非公开 HTTPS URL" });
    await verifyReferenceOriginal(url.href, { id: asset.id, mimeType: blob.type || asset.mimeType, data: bytes }, 0, { fetch: fetchImpl, timeoutMs: 180_000 });
    return url.href;
  };
}
