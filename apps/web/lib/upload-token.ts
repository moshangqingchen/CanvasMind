import { createHmac, timingSafeEqual } from "node:crypto";
import { serverMasterKey } from "./master-key";

const TOKEN_TTL_SECONDS = 15 * 60;

function signingKey(): string {
  const masterKey = serverMasterKey();
  if (masterKey) return masterKey;
  if (process.env.NODE_ENV === "production") {
    throw new Error("MASTER_KEY is required for upload intent signing");
  }
  return "local-development-upload-intent-key";
}

function message(input: {
  id: string;
  storageKey: string;
  size: number;
  mimeType: string;
  expiresAt: number;
}): string {
  return [
    input.id,
    input.storageKey,
    String(input.size),
    input.mimeType,
    String(input.expiresAt),
  ].join("\n");
}

function digest(value: string): Buffer {
  return createHmac("sha256", signingKey()).update(value).digest();
}

export function createUploadToken(input: {
  id: string;
  storageKey: string;
  size: number;
  mimeType: string;
  expiresInSeconds?: number;
}): string {
  const expiresAt =
    Math.floor(Date.now() / 1000) +
    Math.min(
      Math.max(input.expiresInSeconds ?? TOKEN_TTL_SECONDS, 30),
      24 * 60 * 60,
    );
  const payload = `${expiresAt}.${digest(
    message({ ...input, expiresAt }),
  ).toString("base64url")}`;
  return payload;
}

export function verifyUploadToken(
  token: string,
  input: { id: string; storageKey: string; size: number; mimeType: string },
): boolean {
  const separator = token.indexOf(".");
  if (separator <= 0) return false;
  const expiresAt = Number(token.slice(0, separator));
  const suppliedText = token.slice(separator + 1);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < Math.floor(Date.now() / 1000) ||
    !/^[A-Za-z0-9_-]{40,}$/u.test(suppliedText)
  )
    return false;
  let supplied: Buffer;
  try {
    supplied = Buffer.from(suppliedText, "base64url");
  } catch {
    return false;
  }
  const expected = digest(message({ ...input, expiresAt }));
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
