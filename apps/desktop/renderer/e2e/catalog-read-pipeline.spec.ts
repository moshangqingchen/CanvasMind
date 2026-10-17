import { expect, test } from "@playwright/test";

test("slice-2 read pipeline is gated before body validation and leaves the normal catalog checker untouched", async ({ request }) => {
  const before = await request.get("/api/suppliers/catalog-upgrade?summary=1");
  expect(before.ok()).toBe(true);
  const snapshot = await before.json();
  for (const data of [{ connectionId: "slice2-synthetic-key" }, {}, { connectionId: "x".repeat(300) }]) {
    const disabled = await request.post("/api/suppliers/catalog-upgrade?readPipeline=1", { data });
    // Empty 404 proves the gate rejected before any connection lookup/body
    // validation; unknown connections and invalid bodies otherwise return JSON.
    expect(disabled.status()).toBe(404);
    expect(await disabled.text()).toBe("");
  }
  const after = await request.get("/api/suppliers/catalog-upgrade?summary=1");
  expect(after.ok()).toBe(true);
  const result = await after.json();
  expect(result.phase).toBe(snapshot.phase);
  expect(result.refreshed).toBe(snapshot.refreshed);
  expect(result.failed).toBe(snapshot.failed);
  expect(result.updatedConnectionIds).toEqual(snapshot.updatedConnectionIds);
});
