import { expect, test } from "@playwright/test";

test("source collector preview stays disabled in the normal desktop route and does not start legacy refresh", async ({ request }) => {
  const before = await request.get("/api/suppliers/catalog-upgrade?summary=1");
  expect(before.ok()).toBe(true);
  const snapshot = await before.json();
  const preview = await request.post("/api/suppliers/catalog-upgrade?readPreview=1", {
    data: { connectionId: "slice1-synthetic-connection" },
  });
  expect(preview.status()).toBe(404);
  // A disabled gate returns an empty 404. An enabled preview with an unknown
  // connection returns JSON, so status alone would not prove the gate closed.
  expect(await preview.text()).toBe("");
  const after = await request.get("/api/suppliers/catalog-upgrade?summary=1");
  const result = await after.json();
  expect(result.phase).toBe(snapshot.phase);
  expect(result.refreshed).toBe(snapshot.refreshed);
  expect(result.failed).toBe(snapshot.failed);
  expect(result.updatedConnectionIds).toEqual(snapshot.updatedConnectionIds);
});
