import { expect, test } from "@playwright/test";
import { installNeuralFixture } from "./helpers/neural-fixture";
import type { CatalogUpgradeStatus } from "../lib/supplier-catalog-contracts";

test("desktop startup refreshes catalogs in the background and notifies the canvas without submitting generation", async ({ page }) => {
  let starts = 0;
  let polls = 0;
  let generations = 0;
  const data = await installNeuralFixture(page, { motion: false });
  await page.addInitScript(() => {
    const cleanup = () => () => {};
    Object.assign(window, {
      catalogUpgradeNotifications: 0,
      superCanvasDesktop: {
        getUpdate: async () => ({ desktop: true, phase: "idle", currentVersion: "0.2.62", enabled: true }),
        onUpdate: cleanup, onOpenUpdate: cleanup, onPrepareExit: cleanup, onDraining: cleanup,
        completePrepareExit: () => {}, cancelExit: async () => {},
      },
    });
    window.addEventListener("supplier-catalog-upgraded", () => {
      const state = window as unknown as { catalogUpgradeNotifications: number };
      state.catalogUpgradeNotifications++;
    });
  });
  await page.route("**/api/suppliers/catalog-upgrade*", async route => {
    const starting = route.request().method() === "POST";
    if (starting) starts++; else polls++;
    const complete = starts > 0 && !starting;
    const result: CatalogUpgradeStatus = {
      revision: "2026-10-17-fixture", mode: "daily", phase: complete ? "complete" : starts ? "running" : "idle", total: 1,
      refreshed: complete ? 1 : 0, unavailable: 0, failed: 0,
      updatedConnectionIds: complete ? ["existing-connection"] : [],
      manualConnectionIds: [], changedConnectionIds: [], priceChangedSupplierIds: [],
      nextCheckAt: complete ? new Date(Date.now() + 86_400_000).toISOString() : new Date(Date.now() - 1).toISOString(),
      connections: [], history: [], noticeId: null,
    };
    await route.fulfill({ status: starting ? 202 : 200, json: result });
  });
  await page.route("**/api/runs", async route => {
    if (route.request().method() === "POST") generations++;
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByTestId("neural-workspace")).toBeVisible();
  expect(starts).toBe(0); // Starting the UI first reads local scheduling metadata.
  await expect.poll(() => page.evaluate(() => (window as unknown as { catalogUpgradeNotifications: number }).catalogUpgradeNotifications)).toBe(1);
  expect(starts).toBe(1);
  expect(polls).toBeGreaterThanOrEqual(2);
  expect(generations).toBe(0);
  data.assertSafe();
});
