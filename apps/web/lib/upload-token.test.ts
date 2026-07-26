import { afterEach, describe, expect, it, vi } from "vitest";
import { createUploadToken, verifyUploadToken } from "./upload-token";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("upload intent tokens", () => {
  const intent = {
    id: "asset-1",
    storageKey: "assets/asset-1/original.png",
    size: 42,
    mimeType: "image/png",
  };

  it("binds the token to every upload declaration field", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MASTER_KEY", "upload-signing-test-key");
    const token = createUploadToken(intent);

    expect(verifyUploadToken(token, intent)).toBe(true);
    expect(verifyUploadToken(token, { ...intent, size: 43 })).toBe(false);
    expect(
      verifyUploadToken(token, { ...intent, mimeType: "image/jpeg" }),
    ).toBe(false);
  });

  it("rejects expired or tampered tokens", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MASTER_KEY", "upload-signing-test-key");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createUploadToken({ ...intent, expiresInSeconds: 30 });
    vi.advanceTimersByTime(31_000);

    expect(verifyUploadToken(token, intent)).toBe(false);
    expect(verifyUploadToken(`${token}x`, intent)).toBe(false);
  });

  it("refuses a public fallback key in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MASTER_KEY", "");

    expect(() => createUploadToken(intent)).toThrow(
      "MASTER_KEY is required for upload intent signing",
    );
  });
});
