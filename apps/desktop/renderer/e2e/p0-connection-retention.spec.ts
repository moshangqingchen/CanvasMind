import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { CanvasDocument } from "../components/types";
import { installMemoryRoutes, type createMemoryFixture } from "./helpers/p0-memory-fixture";
import { launchMemoryTarget } from "./helpers/p0-memory-launcher";
import { MemorySampler, observeNetwork } from "./helpers/p0-memory-metrics";

// Explicitly opt in with the isolated P0 config, and run separately from
// Agent retention / real-time performance samples.
// It does not assume the connection branch has the Agent branch's growth rate.
const enabled = process.env.P0_MEMORY_RETENTION === "1";
const rounds = 40;
const responseBytes = 512 * 1024;
const maximumGrowthBytes = 8 * 1024 * 1024;
const nodeId = "p0-connection-generator";
const modelId = "fake-image-v1";

function modelsBody() {
  const model: ModelDescriptor = {
    id: modelId, name: "P0 Fake image", operations: ["image.generate"],
    inputKinds: ["text"], outputKinds: ["image"], parameters: [],
    metadata: { canvasRunnable: true, p0ConnectionPollingPayload: "" },
  };
  const overhead = Buffer.byteLength(JSON.stringify([model]));
  const pattern = "P0-connection-pending-update;";
  model.metadata = { ...model.metadata, p0ConnectionPollingPayload:
    pattern.repeat(Math.ceil((responseBytes - overhead) / pattern.length)).slice(0, responseBytes - overhead) };
  const body = JSON.stringify([model]);
  if (Buffer.byteLength(body) !== responseBytes) throw new Error("Unexpected controlled model response size");
  return body;
}

async function fixtureForConnection(request: APIRequestContext) {
  const models = [{ id: modelId, name: "P0 Fake image", operations: ["image.generate"],
    inputKinds: ["text"], outputKinds: ["image"], parameters: [], metadata: { canvasRunnable: true } }];
  const createdProvider = await request.post("/api/providers", { data: {
    name: "P0 isolated Fake connection", provider: "fake", apiKey: "local-test-only",
    config: { usage: "canvas", defaultModel: modelId, connector: { auth: { type: "none" }, models } },
  } });
  expect(createdProvider.ok()).toBeTruthy();
  const provider = await createdProvider.json();
  await createdProvider.dispose();
  const graph: CanvasDocument = { schemaVersion: 1, edges: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [{
    id: nodeId, type: "workflow", position: { x: 120, y: 100 }, style: { width: 360, height: 260 },
    data: { nodeType: "image-generation", label: "P0 connection polling", provider: "fake", connectionId: provider.id,
      model: modelId, parameters: {}, parts: [], inputs: [{ id: "prompt", kind: "text", label: "Prompt" }],
      outputs: [{ id: "images", kind: "image", label: "Images" }] },
  }] };
  const createdCanvas = await request.post("/api/canvas", { data: { title: "P0 connection-only retention", graph } });
  expect(createdCanvas.ok()).toBeTruthy();
  const canvas = await createdCanvas.json() as { id: string };
  await createdCanvas.dispose();
  const fixture: Awaited<ReturnType<typeof createMemoryFixture>> = {
    canvas, provider, models, runs: [], at: new Date().toISOString(), imageIds: [], assets: [],
    evidence: { source: "One synthetic selected generator; Fake execution only; no media", nodes: 1, edges: 0, assets: 0, images: 0, catalogBinding: null, mockedRunCount: 0 },
    fixtureKind: "synthetic", settingsTarget: null, primaryNodeId: nodeId, originalSelectedNodeIds: [],
  };
  return fixture;
}

async function installCounter(page: Page, path: string) {
  await page.addInitScript(path => {
    const counters = { modelJsonParsed: 0 };
    (window as typeof window & { __p0ConnectionCounts: typeof counters }).__p0ConnectionCounts = counters;
    const json = Response.prototype.json;
    Response.prototype.json = function (...args: Parameters<typeof json>) {
      const matching = new URL(this.url, location.href).pathname === path;
      return json.apply(this, args).then(value => {
        if (matching) counters.modelJsonParsed++;
        return value;
      });
    };
  }, path);
}

async function parsed(page: Page) {
  return page.evaluate(() => (window as typeof window & {
    __p0ConnectionCounts?: { modelJsonParsed: number };
  }).__p0ConnectionCounts?.modelJsonParsed ?? 0);
}

function postGcBytes(sampler: MemorySampler, label: string) {
  const row = sampler.rows.find(value => value.phase === label && value.kind === "post-gc");
  const heap = row?.jsHeap;
  if (!heap || typeof heap !== "object" || !("usedBytes" in heap) || typeof heap.usedBytes !== "number")
    throw new Error(`No post-GC heap sample for ${label}`);
  return heap.usedBytes;
}

test("P0 connection snapshot releases 40 identical minute-refresh responses", async ({ request }, testInfo) => {
  test.skip(!enabled, "Requires explicit P0_MEMORY_RETENTION=1 and the isolated P0 configuration");
  test.setTimeout(6 * 60_000);
  if (!/p0-memory-global-setup\.ts$/.test(testInfo.config.globalSetup ?? ""))
    throw new Error("Connection diagnostic requires the isolated P0 configuration");
  if (process.env.PLAYWRIGHT_BASE_URL || (process.env.P0_MEMORY_FIXTURE ?? "synthetic") !== "synthetic")
    throw new Error("Connection diagnostic refuses external servers and real-profile fixtures");
  const root = process.env.P0_MEMORY_OUTPUT_DIR;
  const expectedBuildId = process.env.P0_MEMORY_EXPECTED_BUILD_ID;
  if (!root || !expectedBuildId) throw new Error("Set P0_MEMORY_OUTPUT_DIR and P0_MEMORY_EXPECTED_BUILD_ID");
  const preflight = JSON.parse(await readFile(join(root, "server-preflight.json"), "utf8"));
  if (!preflight.valid || preflight.expectedRuntimeBuildId !== expectedBuildId)
    throw new Error("Connection diagnostic requires valid >=8 GiB preflight and the expected production runtime");
  const baseURL = String(testInfo.project.use.baseURL);
  if (new URL(baseURL).hostname !== "127.0.0.1") throw new Error("Connection diagnostic requires isolated loopback");
  const output = join(root, "connection-polling");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "run-owner.json"), JSON.stringify({ timestamp: new Date().toISOString(), workerPid: process.pid }), { flag: "wx" });
  const fixture = await fixtureForConnection(request);
  const target = await launchMemoryTarget(baseURL, output);
  const network = observeNetwork(target.page);
  const sampler = new MemorySampler(target.page, target.cdp, output, target.renderer, network);
  const path = `/api/providers/${fixture.provider.id}/models`;
  const body = modelsBody();
  const state = { providerReads: 0, modelReads: 0, fulfilled: 0, responseBytes: 0, agentReads: 0 };
  const details: Record<string, unknown> = {};
  let routes: Awaited<ReturnType<typeof installMemoryRoutes>> | null = null;
  let completed = false;
  let failure: string | null = null;
  let pageErrors = 0;
  const onError = () => { pageErrors++; };
  target.page.on("pageerror", onError);
  const sameOriginGet = (url: string, method: string) => new URL(url).origin === new URL(baseURL).origin && method === "GET";
  try {
    routes = await installMemoryRoutes(target.page, baseURL, fixture);
    await target.page.route("**/api/providers*", route => {
      if (!sameOriginGet(route.request().url(), route.request().method()) || new URL(route.request().url()).pathname !== "/api/providers")
        return route.fallback();
      state.providerReads++;
      return route.fulfill({ json: [{ ...fixture.provider, provider: "fake", apiKey: "", apiKeySet: true, apiKeyUsable: true,
        config: { ...fixture.provider.config, preset: "chentu", supplierKey: "chentu", supplierId: "p0-supplier",
          supplierName: "P0 offline", usage: "canvas", modelGroup: "fake", modelCatalogModels: fixture.models,
          scannedModelIds: [modelId], modelScanStatus: "live", modelScanCheckedAt: fixture.at, modelScanLastSuccessAt: fixture.at } }] });
    });
    await target.page.route("**/api/providers/*/models*", async route => {
      if (!sameOriginGet(route.request().url(), route.request().method()) || new URL(route.request().url()).pathname !== path)
        return route.fallback();
      state.modelReads++;
      await route.fulfill({ contentType: "application/json", body, headers: {
        "Cache-Control": "no-store", "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true",
      } });
      state.fulfilled++; state.responseBytes += Buffer.byteLength(body);
    });
    await target.page.route("**/api/agent/models", route => {
      if (!sameOriginGet(route.request().url(), route.request().method())) return route.fallback();
      state.agentReads++;
      return route.fulfill({ json: [] });
    });
    await target.page.route("**/api/agent/sessions**", route =>
      sameOriginGet(route.request().url(), route.request().method()) ? route.fulfill({ json: [] }) : route.fallback());
    await installCounter(target.page, path);
    await target.page.clock.install({ time: new Date("2026-10-15T08:00:00Z") });
    await sampler.initialize();
    await target.page.goto(new URL(`/canvas/${fixture.canvas.id}`, baseURL).href);
    const node = target.page.locator(`.react-flow__node[data-id="${nodeId}"]`);
    await expect(node).toBeVisible();
    // Persisted React Flow selected flags do not initialize CanvasApp.selectedId.
    // A real click exercises the production selection -> model-scan path.
    await node.locator(".node-title").click();
    const selectedNode = target.page.locator(`.react-flow__node.selected[data-id="${nodeId}"]`);
    await expect(selectedNode).toBeVisible();
    expect(state.providerReads, "The query-bearing providers request must receive the controlled chentu display config").toBeGreaterThanOrEqual(1);
    await expect.poll(() => state.modelReads).toBeGreaterThanOrEqual(1);
    await expect.poll(() => parsed(target.page)).toBe(state.modelReads);
    const now = await target.page.evaluate(() => Date.now());
    await target.page.clock.pauseAt(now + 50);
    await target.page.clock.runFor(300);
    const advanceOneMinute = async (expected: number) => {
      await target.page.clock.fastForward(60_000);
      await expect.poll(() => state.modelReads).toBe(expected);
      await expect.poll(() => parsed(target.page)).toBe(expected);
      await target.page.evaluate(async () => { await Promise.resolve(); });
    };
    // One real refresh warms the selected connection snapshot/cache before GC.
    await advanceOneMinute(state.modelReads + 1);
    await sampler.checkpoint("before-refreshes");
    const before = postGcBytes(sampler, "before-refreshes");
    const readBaseline = state.modelReads;
    const parsedBaseline = await parsed(target.page);
    for (let index = 0; index < rounds; index++) await advanceOneMinute(readBaseline + index + 1);
    await expect(selectedNode).toBeVisible();
    await sampler.checkpoint("after-40-refreshes");
    const after = postGcBytes(sampler, "after-40-refreshes");
    Object.assign(details, { rounds, actualModelReads: state.modelReads - readBaseline,
      actualParsedResponses: await parsed(target.page) - parsedBaseline,
      heapBeforeBytes: before, heapAfterBytes: after, heapGrowthBytes: after - before });
    // Capture normal selection-commit cleanup before reporting any threshold
    // failure. This does not run the node or alter provider/business data.
    await target.page.locator(".react-flow__pane").click({ position: { x: 800, y: 500 } });
    await expect(target.page.locator(".react-flow__node.selected")).toHaveCount(0);
    await sampler.checkpoint("after-selection-commit");
    details.heapAfterSelectionCommitBytes = postGcBytes(sampler, "after-selection-commit");
    await writeFile(join(output, "manifest.json"), JSON.stringify({
      timestamp: new Date().toISOString(), expectedBuildId, target: target.metadata, nodeId, modelId, rounds, responseBytes,
      fixture: "One selected synthetic generator, executable provider Fake; display-only preset/supplierKey chentu triggers minute refresh",
      agentResponse: "Always [] to exclude the confirmed Agent large-response branch",
      clock: "40 separate fastForward(60000) calls; each must produce one actual selected-connection models GET and JSON parse",
      payload: "Constant 512 KiB JSON; response arrays are parsed anew by production fetchModels/applyModels",
      marker: "metadata.p0ConnectionPollingPayload",
      retainedPathToInspect: "React hook queue.pending -> update.next/action -> updater closure/context -> items -> metadata.p0ConnectionPollingPayload",
      interpretation: "Minute refresh first changes modelScanRevision and may flush earlier updaters; passing this bound does not prove all pending closures are absent. Inspect strong retainers, not snapshot string matches.",
      limitation: "Accelerated single-branch diagnostic, not a real-time 20-30 minute soak; no product code is changed",
    }, null, 2));
    const mapping = await target.renderer();
    const surface: unknown = "surfaceState" in mapping ? mapping.surfaceState : undefined;
    if (typeof surface === "object" && surface !== null && "network" in surface &&
        typeof surface.network === "object" && surface.network !== null && "blockedExternalAttempts" in surface.network)
      expect(surface.network.blockedExternalAttempts).toBe(0);
    expect(routes.blockedExternal).toBe(0);
    expect(routes.blockedSubmissions).toBe(0);
    expect(pageErrors).toBe(0);
    expect([...sampler.invalidReasons]).toEqual([]);
    expect(details.actualModelReads).toBe(rounds);
    expect(details.actualParsedResponses).toBe(rounds);
    expect(after - before, "Identical selected-connection responses must stay within a bounded 8 MiB post-GC budget").toBeLessThan(maximumGrowthBytes);
    completed = true;
  } catch (error) {
    failure = String(error);
    throw error;
  } finally {
    target.page.off("pageerror", onError);
    network.dispose();
    try {
      await writeFile(join(output, "summary.json"), JSON.stringify({
        completed, failure, expectedBuildId, acceleratedDiagnosticOnly: true, details,
        invalidReasons: [...sampler.invalidReasons], requests: { ...state, inFlight: state.modelReads - state.fulfilled },
        routes, pageErrors, samples: sampler.rows,
        cleanup: "Owned launcher/server teardown verifies test PIDs, ephemeral profile and external request attempts",
      }, null, 2));
    } finally { await target.close(); }
  }
});
