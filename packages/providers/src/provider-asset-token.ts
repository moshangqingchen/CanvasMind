import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

function message(assetId: string, expiresAt: number): string {
  return `${assetId}\n${expiresAt}`;
}

function digest(secret: string, assetId: string, expiresAt: number): Buffer {
  return createHmac("sha256", secret)
    .update(message(assetId, expiresAt))
    .digest();
}

export function createProviderAssetToken(input: {
  assetId: string;
  secret: string;
  expiresInSeconds?: number;
  nowSeconds?: number;
}): string {
  if (!input.assetId.trim()) throw new Error("Provider asset id is required");
  if (!input.secret)
    throw new Error("Provider asset signing secret is required");
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const expiresAt =
    now +
    Math.min(
      Math.max(input.expiresInSeconds ?? DEFAULT_TTL_SECONDS, 30),
      7 * 24 * 60 * 60,
    );
  return `${expiresAt}.${digest(input.secret, input.assetId, expiresAt).toString("base64url")}`;
}

export function verifyProviderAssetToken(input: {
  assetId: string;
  secret: string;
  token: string;
  nowSeconds?: number;
}): boolean {
  const separator = input.token.indexOf(".");
  if (separator <= 0 || !input.assetId.trim() || !input.secret) return false;
  const expiresAt = Number(input.token.slice(0, separator));
  const encoded = input.token.slice(separator + 1);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < now ||
    !/^[A-Za-z0-9_-]{40,}$/u.test(encoded)
  )
    return false;
  let supplied: Buffer;
  try {
    supplied = Buffer.from(encoded, "base64url");
  } catch {
    return false;
  }
  const expected = digest(input.secret, input.assetId, expiresAt);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
