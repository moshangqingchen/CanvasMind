import { describe, expect, it } from "vitest";

import {
  PROVIDER_SUPPLIER_PROFILES,
  providerSupplierLabel,
  providerSupplierProfile,
  providerSupplierWebsite,
  providerSupplierKeyForConnection,
} from "./suppliers";

describe("provider supplier profiles", () => {
  it("keeps every remote built-in supplier linked to an HTTPS website", () => {
    const remoteKeys = [
      "cangyuan",
      "frimodel",
      "chentu",
      "cyberafei",
      "mikoto",
      "miaowu",
      "weai",
      "openai",
      "runway",
    ];

    for (const key of remoteKeys) {
      const profile = providerSupplierProfile(key);
      expect(profile?.label).toBeTruthy();
      expect(profile?.websiteUrl).toMatch(/^https:\/\//u);
    }
  });

  it("provides stable labels and leaves unknown suppliers extensible", () => {
    expect(providerSupplierLabel("cangyuan")).toBe("沧元算力");
    expect(providerSupplierLabel("frimodel")).toBe("FriModel");
    expect(providerSupplierWebsite("weai")).toBe(
      "https://asian-acc.we-token.cc/dashboard",
    );
    expect(providerSupplierLabel("custom-supplier")).toBe("custom-supplier");
    expect(providerSupplierWebsite("custom-supplier")).toBeUndefined();
    expect(PROVIDER_SUPPLIER_PROFILES.length).toBeGreaterThanOrEqual(9);
  });

  it("keeps preset suppliers authoritative over a reused transport adapter", () => {
    expect(
      providerSupplierKeyForConnection({
        provider: "rest",
        config: { preset: "cangyuan-gpt-image-2", supplierKey: "other" },
      }),
    ).toBe("cangyuan");
    expect(
      providerSupplierKeyForConnection({
        provider: "openai",
        config: { supplierKey: "private-gateway" },
      }),
    ).toBe("private-gateway");
  });
});
