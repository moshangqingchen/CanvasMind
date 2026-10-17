import { test as base, type Route } from "@playwright/test";
import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { modelDescriptorsFromConnectionConfig } from "../../lib/model-parameters";
import { mergeManualProviderModels } from "../../lib/manual-provider-models";

export * from "@playwright/test";

/**
 * Legacy canvas UI cases seed synthetic connectors, not authenticated scans.
 * Their shared runtime can retain earlier cases' connections. Serve those
 * existing fixture descriptors in memory rather than asking upstream catalogs.
 * A case's own later route takes priority; refresh/test/scan are never mocked.
 * This fixture is enabled only by the isolated canvas regression configuration,
 * never by homepage acceptance (where an unexpected scan must still fail).
 */
export const test = base.extend<{ offlineCanvasInventory: void }>({
  offlineCanvasInventory: [async ({ page }, runTest, testInfo) => {
    if (testInfo.config.metadata.offlineCanvasInventories !== true) {
      await runTest();
      return;
    }
    const repository = fileURLToPath(new URL("../../../../..", import.meta.url));
    const evidence = resolve(repository, process.env.NEURAL_EVIDENCE_DIR ?? ".codex-logs/2026-10-16-redesign-v2/out");
    await mkdir(evidence, { recursive: true });
    let ending = false;
    const pending = new Set<Promise<void>>();
    const failures: unknown[] = [];
    const serve = async (route: Route) => {
      if (ending || page.isClosed()) return;
      const request = route.request();
      const url = new URL(request.url());
      const match = /^\/api\/providers\/([^/]+)\/models$/u.exec(url.pathname);
      // fetchModels adds fresh=Date.now() only as a browser cache-buster;
      // refresh=1 is the distinct, explicit upstream refresh operation.
      const fresh = url.searchParams.get("fresh");
      const ordinaryCacheBuster = fresh !== null && /^\d{13}$/u.test(fresh) && Math.abs(Date.now() - Number(fresh)) < 300_000;
      if (request.method() !== "GET" || !match || fresh !== null && !ordinaryCacheBuster || ["refresh", "test", "scan", "sync", "clearUnavailable"].some(key => url.searchParams.has(key))) {
        await route.fallback();
        return;
      }
      const response = await page.request.get("/api/providers");
      if (ending || page.isClosed()) return;
      if (!response.ok()) throw new Error("Cannot read isolated canvas fixture connections");
      const connections = await response.json() as Array<{ id: string; provider: string; config: Record<string, unknown> }>;
      if (ending || page.isClosed()) return;
      const connection = connections.find(item => item.id === decodeURIComponent(match[1]!));
      if (!connection) {
        await route.fulfill({ status: 404, json: { error: "Isolated fixture connection was deleted" } });
        return;
      }
      // Local fake/CLI adapters and stored denials already have an offline
      // server path; keep those original API semantics under test.
      if (["fake", "cli"].includes(connection.provider) || ["empty", "unauthorized"].includes(String(connection.config.modelScanStatus))) {
        await route.fallback();
        return;
      }
      const models = mergeManualProviderModels(connection, modelDescriptorsFromConnectionConfig(connection.config));
      await appendFile(resolve(evidence, "canvas-offline-model-inventory.jsonl"), `${JSON.stringify({
        at: new Date().toISOString(), test: testInfo.title, connectionId: connection.id,
        modelCount: models.length, source: "isolated-saved-connector", upstreamRequestSent: false,
      })}\n`);
      await route.fulfill({ json: models, headers: { "X-Model-Scan-Source": "isolated-saved-connector", "X-Model-Scan-Status": String(connection.config.modelScanStatus ?? "unscanned"), "Cache-Control": "no-store" } });
    };
    await page.route("**/api/providers/*/models*", async route => {
      const work = serve(route);
      pending.add(work);
      try {
        await work;
      } catch (error) {
        if ((ending || page.isClosed()) && error instanceof Error && /has been disposed|has been closed|Target closed/iu.test(error.message)) {
          await appendFile(resolve(evidence, "canvas-offline-lifecycle.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), test: testInfo.title, phase: "page-teardown", cancelledFixtureRead: true })}\n`);
          return;
        }
        failures.push(error);
        throw error;
      } finally {
        pending.delete(work);
      }
    });
    try {
      await runTest();
    } finally {
      // Own these background callbacks until the page has stopped requesting
      // inventories. Never let them read a disposed APIRequestContext later.
      ending = true;
      if (!page.isClosed()) await page.close();
      await Promise.allSettled([...pending]);
      if (failures.length) throw new AggregateError(failures, "Isolated canvas inventory fixture failed");
    }
  }, { auto: true }],
});
