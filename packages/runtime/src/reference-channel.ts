import { readFileSync } from "node:fs";
import { createProviderAssetToken, providerFetch } from "@super-canvas/providers";

interface ChannelState { enabled: boolean; ready: boolean; baseUrl: string; updatedAt: number; instance: string }
/** An enabled private channel must never silently fall back to a public host. */
export function localReferenceChannelConfigured(): boolean {
  if (process.env.SUPERCANVAS_DESKTOP !== "true" || !process.env.SUPERCANVAS_REFERENCE_CHANNEL_FILE) return false;
  try { return JSON.parse(readFileSync(process.env.SUPERCANVAS_REFERENCE_CHANNEL_FILE, "utf8")).enabled === true; }
  catch { return false; }
}
export function localReferenceChannel(): ChannelState | null {
  if (process.env.SUPERCANVAS_DESKTOP !== "true" || !process.env.SUPERCANVAS_REFERENCE_CHANNEL_FILE) return null;
  try {
    const value = JSON.parse(readFileSync(process.env.SUPERCANVAS_REFERENCE_CHANNEL_FILE, "utf8")) as ChannelState;
    const url = new URL(value.baseUrl);
    if (!value.enabled || !value.ready || !Number.isFinite(value.updatedAt) || Date.now() - value.updatedAt > 90_000 ||
      value.updatedAt > Date.now() + 5000 || url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
      url.search || url.hash || !value.instance || !process.env.MASTER_KEY) return null;
    return value;
  } catch { return null; }
}

export async function localReferenceUrls(assetIds: readonly string[]): Promise<string[]> {
  const channel = localReferenceChannel();
  if (!channel) throw new Error("本机素材通道未连通，请在设置的“素材通道”中连接后重试；当前生成尚未提交。");
  const urlFor = (id: string, lifetime: number) => {
    const url = new URL(`/api/provider-assets/${encodeURIComponent(id)}`, channel.baseUrl);
    url.searchParams.set("token", createProviderAssetToken({ assetId: id, secret: process.env.MASTER_KEY!, expiresInSeconds: lifetime }));
    return url.href;
  };
  try {
    const response = await providerFetch(urlFor("_health", 30), { redirect: "error", signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!response.ok || (await response.text()) !== channel.instance) throw new Error("unreachable");
  } catch {
    throw new Error("本机素材通道暂时无法从公网访问，请检查网络后重试；当前生成尚未提交。");
  }
  return assetIds.map(id => urlFor(id, 3600));
}
