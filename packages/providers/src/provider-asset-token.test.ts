import { describe, it, expect } from "vitest";
import { createProviderAssetToken, verifyProviderAssetToken } from "./provider-asset-token.js";
describe("desktop reference links", () => {
  it("binds access to one asset and signing key and rejects the expiration boundary", () => {
    const input = { assetId: "reference-1", secret: "test-secret", nowSeconds: 1000 };
    const token = createProviderAssetToken(input);
    expect(verifyProviderAssetToken({ ...input, token })).toBe(true);
    expect(verifyProviderAssetToken({ ...input, token, assetId: "reference-2" })).toBe(false);
    expect(verifyProviderAssetToken({ ...input, token, secret: "another" })).toBe(false);
    expect(verifyProviderAssetToken({ ...input, token, nowSeconds: 4600 })).toBe(false);
    expect(verifyProviderAssetToken({ ...input, token: token + "extra" })).toBe(false);
  });
});
