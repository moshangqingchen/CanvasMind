import assert from "node:assert/strict";
import test from "node:test";
import { checkCatalogs, inspectCatalogPayload } from "./check-provider-catalogs.mjs";

test("accepts a pricing payload with models and group metadata", () => {
  const result = inspectCatalogPayload({
    data: [
      { model_name: "image-a", enable_groups: ["default"], model_price: 1 },
      { model_name: "image-b", enable_groups: ["default"], model_price: 2 },
    ],
    group_ratio: { default: 1 },
  });
  assert.equal(result.status, "ok");
  assert.equal(result.modelCount, 2);
});
test("reports empty and schema-invalid payloads as errors", () => {
  assert.equal(inspectCatalogPayload({ data: [] }).status, "error");
  assert.equal(inspectCatalogPayload({ data: [{ price: 1 }] }).status, "error");
  assert.match(inspectCatalogPayload({ data: [] }).errors[0], /empty/);
});

test("detects count drift against the previous report", () => {
  const result = inspectCatalogPayload(
    { data: [{ model_name: "only-one" }], usable_group: {} },
    { previousModelCount: 10 },
  );
  assert.equal(result.status, "warning");
  assert.match(result.warnings.join(" "), /changed/);
});

test("checks catalogs concurrently and preserves provider ids", async () => {
  const calls = [];
  const report = await checkCatalogs({
    catalogs: [
      { id: "one", url: "https://one.test/pricing" },
      { id: "two", url: "https://two.test/pricing" },
    ],
    fetchImpl: async (url) => {
      calls.push(url);
      return Response.json({
        data: [{ model_name: url.includes("one") ? "one-model" : "two-model" }],
        group_ratio: {},
      });
    },
  });
  assert.equal(report.ok, true);
  assert.deepEqual(calls.sort(), [
    "https://one.test/pricing",
    "https://two.test/pricing",
  ]);
  assert.deepEqual(report.catalogs.map((item) => item.id), ["one", "two"]);
});
