import { test } from "@playwright/test";
import { createMemoryFixture, memoryScenarios, type MemoryScenario } from "./helpers/p0-memory-fixture";
import { loadMemoryCatalogFixture } from "./helpers/p0-memory-catalog-fixture";
import { readPreparationRequest, writePreparedMemoryFixture } from "./helpers/p0-memory-preparation";

test("P0 API-only fixture preparation child", async ({ request }, testInfo) => {
  test.skip(process.env.P0_MEMORY_PREPARE_ACTIVE !== "1", "Owned preparation parent only");
  if (testInfo.config.globalSetup || testInfo.config.webServer) throw new Error("Preparation must not start any server or global setup");
  const baseURL = String(testInfo.project.use.baseURL);
  const { output, identity } = await readPreparationRequest(baseURL);
  if (!memoryScenarios.includes(identity.scenario as MemoryScenario)) throw new Error("Unknown preparation scene");
  const catalog = await loadMemoryCatalogFixture(output);
  let fixture: Awaited<ReturnType<typeof createMemoryFixture>>;
  try { fixture = await createMemoryFixture(request, identity.scenario, catalog); }
  finally { await request.dispose(); }
  await writePreparedMemoryFixture(output, identity, fixture, catalog?.manifest);
});
