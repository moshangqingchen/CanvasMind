import { createHmac, timingSafeEqual } from "node:crypto";

function digest(secret: string, assetId: string, expiresAt: number): Buffer {
  return createHmac("sha256", secret).update(`supercanvas-reference-v1\n${assetId}\n${expiresAt}`).digest();
}

export function createProviderAssetToken(input: { assetId: string; secret: string; expiresInSeconds?: number; nowSeconds?: number }): string {
  if (!input.assetId || !input.secret) throw new Error("Missing reference signing credentials");
  const expiresAt = (input.nowSeconds ?? Math.floor(Date.now() / 1000)) + Math.min(3600, Math.max(30, input.expiresInSeconds ?? 3600));
  return `${expiresAt}.${digest(input.secret, input.assetId, expiresAt).toString("base64url")}`;
}

export function verifyProviderAssetToken(input: { assetId: string; secret: string; token: string; nowSeconds?: number }): boolean {
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(input.token);
  if (!match || !input.assetId || !input.secret) return false;
  const expiresAt = Number(match[1]);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 3600) return false;
  const supplied = Buffer.from(match[2]!, "base64url");
  const expected = digest(input.secret, input.assetId, expiresAt);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
