import { describe, expect, it } from "vitest";
import { supplierKeyForConnection } from "./supplier-identity";

describe("supplier identity", () => {
  it("treats built-in presets as isolated supplier namespaces", () => {
    expect(
      supplierKeyForConnection({
        provider: "rest",
        config: { preset: "cangyuan-gpt-image-2", supplierKey: "other" },
      }),
    ).toBe("cangyuan");
    expect(
      supplierKeyForConnection({
        provider: "openai",
        config: { supplierKey: "my-gateway" },
      }),
    ).toBe("my-gateway");
  });
});
