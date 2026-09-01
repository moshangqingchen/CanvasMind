import { describe, expect, it } from "vitest";
import { providerPriceUnit } from "./provider-pricing-unit";

describe("providerPriceUnit", () => {
  it("prioritizes the nested video pricing unit", () => {
    expect(
      providerPriceUnit({
        billing_mode: "per_request",
        video_api: { pricing: { unit: "per_second" } },
      }),
    ).toBe("second");
  });

  it("reads the structured units used by the provider catalogs", () => {
    expect(providerPriceUnit({ billing_mode: "per_second" })).toBe("second");
    expect(providerPriceUnit({ request_unit: "generation" })).toBe("request");
    expect(
      providerPriceUnit({ video_api: { pricing: { unit: "per_call" } } }),
    ).toBe("request");
  });

  it("falls back to tags and descriptions", () => {
    expect(providerPriceUnit({ tags: ["视频", "按秒"] })).toBe("second");
    expect(providerPriceUnit({ description: "此线路按次计费" })).toBe(
      "request",
    );
  });
});
