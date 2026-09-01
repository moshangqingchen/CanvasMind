import { describe, expect, it } from "vitest";
import {
  createProviderAssetToken,
  verifyProviderAssetToken,
} from "./provider-asset-token.js";

describe("provider asset tokens", () => {
  it("signs one asset id with an expiry", () => {
    const token = createProviderAssetToken({
      assetId: "asset-1",
      secret: "test-secret",
      expiresInSeconds: 60,
      nowSeconds: 1_000,
    });
    expect(
      verifyProviderAssetToken({
        assetId: "asset-1",
        secret: "test-secret",
        token,
        nowSeconds: 1_059,
      }),
    ).toBe(true);
    expect(
      verifyProviderAssetToken({
        assetId: "asset-2",
        secret: "test-secret",
        token,
        nowSeconds: 1_059,
      }),
    ).toBe(false);
    expect(
      verifyProviderAssetToken({
        assetId: "asset-1",
        secret: "test-secret",
        token,
        nowSeconds: 1_061,
      }),
    ).toBe(false);
  });
});
