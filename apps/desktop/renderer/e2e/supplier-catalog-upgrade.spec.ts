import { expect, test } from "@playwright/test";

test("desktop startup refreshes catalogs in the background and notifies the canvas without submitting generation", async ({ page }) => {
  let starts = 0;
  let polls = 0;
  let generations = 0;
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
  await page.route("**/api/suppliers/catalog-upgrade", async route => {
    const starting = route.request().method() === "POST";
    if (starting) starts++; else polls++;
    await route.fulfill({ status: starting ? 202 : 200, contentType: "application/json", body: JSON.stringify({
      revision: "2026-10-07", phase: starting ? "running" : "complete", total: 1,
      refreshed: starting ? 0 : 1, unavailable: 0, failed: 0, updatedConnectionIds: starting ? [] : ["existing-connection"],
    }) });
  });
  await page.route("**/api/runs", async route => {
    if (route.request().method() === "POST") generations++;
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /从一个想法，\s*开始创作。/u })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { catalogUpgradeNotifications: number }).catalogUpgradeNotifications)).toBe(1);
  expect(starts).toBeGreaterThan(0);
  expect(polls).toBeGreaterThan(0);
  expect(generations).toBe(0);
});
