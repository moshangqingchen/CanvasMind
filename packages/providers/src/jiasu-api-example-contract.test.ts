import { describe, expect, it } from "vitest";
import { jiasuVideoApiExampleContract, latestJiasuVideoApiExampleContract } from "./jiasu-api-example-contract.js";
import { jiasuVideoModel } from "./jiasu-video-contract.js";
import { jiasuCatalogRecord } from "./jiasu-catalog-pricing.js";

const id = "dola-sd-2.5";
const snapshot = jiasuVideoApiExampleContract(id)!;
const first = { ...snapshot, sourceStatus: "live" as const, checkedAt: "2026-10-12T01:00:00.000Z" };
const latest = { ...first, checkedAt: "2026-10-12T02:00:00.000Z" };

describe("Jiasu exact public example evidence selection", () => {
  it("prefers valid live evidence, then the newer sample, preserving its actual timestamp", () => {
    expect(latestJiasuVideoApiExampleContract(id, snapshot, first)).toBe(first);
    expect(latestJiasuVideoApiExampleContract(id, latest, first, { ...snapshot, checkedAt: "2026-10-13T01:00:00.000Z" })).toBe(latest);
    expect(latestJiasuVideoApiExampleContract(id, latest, { ...latest })).toBe(latest);
    expect(latestJiasuVideoApiExampleContract("dola-sd-2.0", latest)).toBeUndefined();
  });

  it("does not let a flat snapshot hide this full model's newer nested live record", () => {
    const model = jiasuVideoModel(id, { id, name: id, operations: [], metadata: {
      jiasuApiExampleContract: snapshot, jiasuCatalogRecord: { ...jiasuCatalogRecord({ model_name: id, supported_endpoint_types: ["openai-video"] }), apiExampleContract: latest },
      jiasuApiExampleScanStatus: "partial", jiasuApiExampleCheckedAt: "2026-10-12T03:00:00.000Z",
    } })!;
    expect(model.metadata?.jiasuApiExampleContract).toBe(latest);
    expect(model.metadata?.jiasuApiExampleScanStatus).toBe("partial");
    expect(model.parameters?.find(parameter => parameter.key === "resolution")).toMatchObject({ control: "text", allowCustomValue: true });
  });

  it.each([
    { values: undefined }, { values: [] }, { values: { ...first.values, duration: 0 } },
    { values: { ...first.values, duration: 3.5 } }, { values: { ...first.values, duration: "5" } },
    { values: { ...first.values, resolution: null } }, { values: { ...first.values, ratio: "" } },
    { fields: undefined }, { fields: [] }, { fields: [42] }, { fields: ["invalid-field"] },
    { sourceSha256: null }, { checkedAt: null }, { checkedAt: "not-a-date" },
    { sourceUrl: "https://other.invalid/static/js/index.123.js" },
    { sourceUrl: "https://ai.jiasuapi.com/static/js/index.123.js?account=untrusted" },
    { submitPath: "/v1/video/generations?override=untrusted" }, { submitMethod: "GET" },
  ])("ignores malformed or differently scoped stored evidence: %j", patch => {
    const bad = { ...first, ...patch };
    expect(() => latestJiasuVideoApiExampleContract(id, bad)).not.toThrow();
    expect(latestJiasuVideoApiExampleContract(id, bad)).toBeUndefined();
    expect(latestJiasuVideoApiExampleContract(id, bad, snapshot)).toBe(snapshot);
  });
});
