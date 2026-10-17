import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentModelOption } from "../lib/agent-models";
import { createMemoryFixture, installMemoryRoutes } from "./helpers/p0-memory-fixture";
import { launchMemoryTarget } from "./helpers/p0-memory-launcher";
import { MemorySampler, observeNetwork } from "./helpers/p0-memory-metrics";
import { agentModelTrigger, openAgentModels } from "./helpers/agent-controls";

// Accelerated cleanup regression, not a replacement for the real-time P0 soak.
// Run explicitly with the isolated P0 configuration and P0_MEMORY_RETENTION=1.
const enabled = process.env.P0_MEMORY_RETENTION === "1";
const rounds = 40;
const responseBytes = 512 * 1024;
const maximumGrowthBytes = 8 * 1024 * 1024;

function agentBody(connectionId: string, modelName = "P0 retained model", bytes = responseBytes) {
  const item: AgentModelOption = {
    supplierId: "p0-supplier", supplierName: "P0 offline", group: "Fake",
    connectionId, connectionName: "P0 Fake", modelId: "p0-agent-model", modelName,
    protocol: "openai-chat-completions", available: true, source: "manual",
    capabilities: { text: true, imageInput: false, audioInput: false, videoInput: false,
      structuredOutput: false, toolCalling: false, nativeWebSearch: false, reasoning: false },
    // No credentials, endpoint or executable provider configuration is present.
    // This unused metadata field makes the parsed response identifiable in heaps.
    metadata: { p0PollingPayload: "" },
  };
  const overhead = Buffer.byteLength(JSON.stringify([item]));
  if (bytes < overhead) throw new Error("P0 response target is smaller than its model descriptor");
  item.metadata = { p0PollingPayload: "P0-queue-retention-fixture;".repeat(Math.ceil((bytes - overhead) / 27)).slice(0, bytes - overhead) };
  const body = JSON.stringify([item]);
  if (Buffer.byteLength(body) !== bytes) throw new Error("Unexpected P0 response size");
  return body;
}

/** Only scalar counts are stored in the renderer; response objects never escape. */
async function installJsonCounter(page: Page) {
  await page.addInitScript(() => {
    const counters = { agentJsonParsed: 0 };
    (window as typeof window & { __p0PollingCounts: typeof counters }).__p0PollingCounts = counters;
    const json = Response.prototype.json;
    Response.prototype.json = function (...args: Parameters<typeof json>) {
      const isAgent = new URL(this.url, location.href).pathname === "/api/agent/models";
      return json.apply(this, args).then(value => {
        if (isAgent) counters.agentJsonParsed++;
        return value;
      });
    };
  });
}

async function parsedResponses(page: Page) {
  return page.evaluate(() => (window as typeof window & {
    __p0PollingCounts?: { agentJsonParsed: number };
  }).__p0PollingCounts?.agentJsonParsed ?? 0);
}

async function finishResponses(page: Page, count: number) {
  await expect.poll(() => parsedResponses(page)).toBe(count);
  // The app's await agentRequest continuation runs after Response.json. An RPC
  // microtask barrier lets it finish without changing React state or retaining it.
  await page.evaluate(async () => { await Promise.resolve(); });
}

function postGcBytes(sampler: MemorySampler, label: string) {
  const row = sampler.rows.find(value => value.phase === label && value.kind === "post-gc");
  const heap = row?.jsHeap;
  if (!heap || typeof heap !== "object" || !("usedBytes" in heap) || typeof heap.usedBytes !== "number")
    throw new Error(`No post-GC heap sample for ${label}`);
  return heap.usedBytes;
}

type PollingContext = {
  page: Page;
  sampler: MemorySampler;
  output: string;
  state: {
    body: string; agentReads: number; fulfilled: number; responseBytes: number;
    nextHeldResponse: { body: string; gate: Promise<void> } | null;
  };
  details: Record<string, unknown>;
};

async function pollingCase(
  request: APIRequestContext,
  testInfo: TestInfo,
  arm: string,
  run: (context: PollingContext) => Promise<void>,
) {
  if (!/p0-memory-global-setup\.ts$/.test(testInfo.config.globalSetup ?? ""))
    throw new Error("Polling regression requires playwright.p0-memory.config.ts and its isolated setup");
  if (process.env.PLAYWRIGHT_BASE_URL || (process.env.P0_MEMORY_FIXTURE ?? "synthetic") !== "synthetic")
    throw new Error("Polling regression refuses external servers and real-profile fixtures");
  const root = process.env.P0_MEMORY_OUTPUT_DIR;
  const expectedBuildId = process.env.P0_MEMORY_EXPECTED_BUILD_ID;
  if (!root || !expectedBuildId) throw new Error("Set P0_MEMORY_OUTPUT_DIR and P0_MEMORY_EXPECTED_BUILD_ID");
  const preflight = JSON.parse(await readFile(join(root, "server-preflight.json"), "utf8"));
  if (!preflight.valid || preflight.expectedRuntimeBuildId !== expectedBuildId)
    throw new Error("Polling regression requires a valid >=8 GiB P0 preflight and the expected production build");
  const baseURL = String(testInfo.project.use.baseURL);
  if (new URL(baseURL).hostname !== "127.0.0.1") throw new Error("P0 regression requires isolated loopback");
  const output = join(root, `polling-${arm}`);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "run-owner.json"), JSON.stringify({ timestamp: new Date().toISOString(), workerPid: process.pid, arm }), { flag: "wx" });
  const fixture = await createMemoryFixture(request, "canvas-idle");
  const target = await launchMemoryTarget(baseURL, output);
  const network = observeNetwork(target.page);
  const sampler = new MemorySampler(target.page, target.cdp, output, target.renderer, network);
  const state: PollingContext["state"] = {
    body: agentBody(fixture.provider.id), agentReads: 0, fulfilled: 0,
    responseBytes: 0, nextHeldResponse: null,
  };
  const details: Record<string, unknown> = {};
  let completed = false;
  let failure: string | null = null;
  let pageErrors = 0;
  const onError = () => { pageErrors++; };
  target.page.on("pageerror", onError);
  let routes: Awaited<ReturnType<typeof installMemoryRoutes>> | null = null;
  try {
    routes = await installMemoryRoutes(target.page, baseURL, fixture);
    // Last registered route wins; all traffic not matched here still traverses
    // the common loopback/submission guard and the server-level TCP guard.
    await target.page.route("**/api/agent/models**", async route => {
      if (new URL(route.request().url()).origin !== new URL(baseURL).origin || route.request().method() !== "GET")
        return route.fallback();
      state.agentReads++;
      const held = state.nextHeldResponse;
      state.nextHeldResponse = null;
      const body = held?.body ?? state.body;
      if (held) await held.gate;
      await route.fulfill({ contentType: "application/json", headers: { "Cache-Control": "no-store" }, body });
      state.fulfilled++; state.responseBytes += Buffer.byteLength(body);
    });
    await target.page.route("**/api/agent/sessions**", route =>
      new URL(route.request().url()).origin === new URL(baseURL).origin && route.request().method() === "GET"
        ? route.fulfill({ json: [] }) : route.fallback());
    await installJsonCounter(target.page);
    await target.page.clock.install({ time: new Date("2026-10-15T08:00:00Z") });
    await sampler.initialize();
    await target.page.goto(new URL(`/canvas/${fixture.canvas.id}`, baseURL).href);
    await expect(target.page.locator(".react-flow__node").first()).toBeAttached();
    const toggle = target.page.getByRole("button", { name: "智能体面板", exact: true });
    const panel = target.page.getByRole("region", { name: "通用创作智能体", exact: true });
    if (!await panel.isVisible()) await toggle.click();
    const displayedModel = panel.getByLabel("智能体模型", { exact: true }).locator("option").last()
      .or(agentModelTrigger(target.page).locator(":scope > span").first());
    await expect(displayedModel).toHaveText("P0 retained model");
    await expect.poll(() => state.agentReads).toBeGreaterThanOrEqual(1);
    await finishResponses(target.page, state.agentReads);
    const now = await target.page.evaluate(() => Date.now());
    await target.page.clock.pauseAt(now + 50);
    // Allow the deferred panel and any initial state commits to settle before
    // the baseline. Every subsequent round advances exactly one 5s interval.
    await target.page.clock.runFor(300);
    for (let index = 0; index < 2; index++) {
      const before = state.agentReads;
      await target.page.clock.fastForward(5000);
      await expect.poll(() => state.agentReads).toBe(before + 1);
      await finishResponses(target.page, before + 1);
    }
    await writeFile(join(output, "manifest.json"), JSON.stringify({
      timestamp: new Date().toISOString(), arm, expectedBuildId, target: target.metadata,
      fixture: "Synthetic P0 canvas, Fake execution only, no user profile", rounds, responseBytes,
      maximumGrowthBytes, clock: "40 separate fastForward(5000) calls; not one jump that coalesces intervals",
      payload: "Constant ASCII JSON body; independently parsed by each actual app fetch; one metadata.p0PollingPayload string",
      probeRetention: "Only numeric counters stored in the page. No response, DOM, updater or React fiber handles retained by test probes.",
      limitation: "Accelerated regression; separate real-time 20-30 minute soaks and snapshot retainers establish the root cause.",
    }, null, 2));
    await run({ page: target.page, sampler, output, state, details });
    const mapping = await target.renderer();
    const surface: unknown = "surfaceState" in mapping ? mapping.surfaceState : undefined;
    if (typeof surface === "object" && surface !== null && "network" in surface &&
        typeof surface.network === "object" && surface.network !== null &&
        "blockedExternalAttempts" in surface.network)
      expect(surface.network.blockedExternalAttempts, "Native browser must not attempt external requests").toBe(0);
    expect(routes.blockedExternal).toBe(0);
    expect(routes.blockedSubmissions).toBe(0);
    expect(pageErrors).toBe(0);
    expect([...sampler.invalidReasons], "Every sample must retain >=8 GiB free memory and its owned renderer").toEqual([]);
    completed = true;
  } catch (error) {
    failure = String(error);
    throw error;
  } finally {
    target.page.off("pageerror", onError);
    network.dispose();
    try {
      await writeFile(join(output, "summary.json"), JSON.stringify({
        arm, completed, failure, expectedBuildId, acceleratedRegressionOnly: true,
        invalidReasons: [...sampler.invalidReasons], requests: {
          agentReads: state.agentReads, fulfilled: state.fulfilled, responseBytes: state.responseBytes,
          inFlight: state.agentReads - state.fulfilled,
          unresolvedHeldResponse: state.nextHeldResponse !== null,
        }, routes, details, pageErrors, samples: sampler.rows,
        cleanup: "Owned launcher/server teardown files verify PIDs, ephemeral data removal and external attempt counts",
      }, null, 2));
    } finally { await target.close(); }
  }
}

for (const collapsed of [true, false]) {
  const arm = collapsed ? "collapsed" : "expanded";
  test(`P0 ${arm} agent releases 40 identical polling responses`, async ({ request }, testInfo) => {
    test.skip(!enabled, "Requires explicit P0_MEMORY_RETENTION=1 and the isolated P0 configuration");
    test.setTimeout(6 * 60_000);
    await pollingCase(request, testInfo, arm, async ({ page, sampler, state, details }) => {
      const panel = page.getByRole("region", { name: "通用创作智能体", exact: true });
      const toggle = page.getByRole("button", { name: "智能体面板", exact: true });
      if (collapsed) await toggle.click();
      // Hidden inspector content stays mounted in the current product. Keep this
      // exact user scenario observable without querying/retaining React internals.
      await expect(page.locator(".agent-panel")).toHaveCount(1);
      if (collapsed) await expect(panel).toBeHidden(); else await expect(panel).toBeVisible();
      await sampler.checkpoint("before-polls");
      const before = postGcBytes(sampler, "before-polls");
      const readBaseline = state.agentReads;
      const parsedBaseline = await parsedResponses(page);
      for (let index = 0; index < rounds; index++) {
        await page.clock.fastForward(5000);
        await expect.poll(() => state.agentReads).toBe(readBaseline + index + 1);
        await finishResponses(page, parsedBaseline + index + 1);
      }
      await sampler.checkpoint("after-40-polls");
      const after = postGcBytes(sampler, "after-40-polls");
      Object.assign(details, { collapsed, rounds, actualReads: state.agentReads - readBaseline,
        actualParsedResponses: await parsedResponses(page) - parsedBaseline,
        heapBeforeBytes: before, heapAfterBytes: after, heapGrowthBytes: after - before });
      // Take release evidence even when the old implementation exceeds the
      // threshold. A normal input edit schedules a genuine React commit.
      if (collapsed) await toggle.click();
      await panel.getByLabel("创作任务要求", { exact: true }).fill("P0 release probe");
      await panel.getByLabel("创作任务要求", { exact: true }).fill("");
      await sampler.checkpoint("after-input-commit");
      details.heapAfterInputCommitBytes = postGcBytes(sampler, "after-input-commit");
      expect(details.actualReads).toBe(rounds);
      expect(details.actualParsedResponses).toBe(rounds);
      expect(after - before, "Equal-response updater closures must not accumulate in React's pending update queue").toBeLessThan(maximumGrowthBytes);
    });
  });
}

test("P0 changed agent list publishes and a late older request cannot replace the newest list", async ({ request }, testInfo) => {
  test.skip(!enabled, "Requires explicit P0_MEMORY_RETENTION=1 and the isolated P0 configuration");
  test.setTimeout(6 * 60_000);
  await pollingCase(request, testInfo, "changed-and-race", async ({ page, sampler, state, details }) => {
    const panel = page.getByRole("region", { name: "通用创作智能体", exact: true });
    const displayedModel = panel.getByLabel("智能体模型", { exact: true }).locator("option").last()
      .or(agentModelTrigger(page).locator(":scope > span").first());
    state.body = state.body.replace("P0 retained model", "P0 changed model");
    let before = state.agentReads;
    await page.clock.fastForward(5000);
    await expect.poll(() => state.agentReads).toBe(before + 1);
    await finishResponses(page, before + 1);
    await expect(displayedModel).toHaveText("P0 changed model");
    await sampler.sample("changed-list");

    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    state.nextHeldResponse = { body: state.body.replace("P0 changed model", "P0 stale model"), gate };
    before = state.agentReads;
    const parsedBefore = await parsedResponses(page);
    try {
      await page.clock.fastForward(5000);
      await expect.poll(() => state.agentReads).toBe(before + 1);
      expect(await parsedResponses(page)).toBe(parsedBefore);
      state.body = state.body.replace("P0 changed model", "P0 newest model");
      // A manual refresh can overlap the interval request. It must win even
      // when the older response finishes later; no generation is submitted.
      if (await agentModelTrigger(page).count()) await openAgentModels(page);
      await page.getByRole("button", { name: "重新读取缓存", exact: true }).click();
      await expect.poll(() => state.agentReads).toBe(before + 2);
      await finishResponses(page, parsedBefore + 1);
      await expect(displayedModel).toHaveText("P0 newest model");
    } finally { release?.(); }
    await finishResponses(page, parsedBefore + 2);
    await expect(displayedModel).toHaveText("P0 newest model");
    await sampler.sample("newest-list-survives-late-response");
    Object.assign(details, { changedListPublished: true, lateOlderResponseIgnored: true,
      overlappingReads: state.agentReads - before, parsedResponses: await parsedResponses(page) - parsedBefore });
  });
});
