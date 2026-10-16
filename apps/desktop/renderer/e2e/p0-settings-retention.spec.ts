import { expect, test, type Page, type Request } from "@playwright/test";
import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { freemem } from "node:os";
import { join } from "node:path";
import { installMemoryRoutes, restoreMemorySelection, setScenarioView, type createMemoryFixture } from "./helpers/p0-memory-fixture";
import { launchMemoryTarget } from "./helpers/p0-memory-launcher";
import { installMediaDiagnostics, MemorySampler, minimumAvailableBytes, observeNetwork, takeHeapSnapshot } from "./helpers/p0-memory-metrics";
import { createAgentModelsMemoryResponder, readAgentModelsMemoryBytes } from "./helpers/p0-memory-agent-models";
import { loadMemoryCatalogFixture } from "./helpers/p0-memory-catalog-fixture";
import { reclaimFixtureDriverMemory } from "./helpers/p0-memory-driver";
import { memoryCatalogManifestDigest, prepareMemoryFixtureInChild } from "./helpers/p0-memory-preparation";
import { installEdgeGlowMode, readEdgeGlowMode } from "./helpers/p0-edge-effects";

// Replaces the former Settings-only case; separate from formal long soaks.
const enabled = process.env.P0_SETTINGS_RETENTION === "1";
const scenes = ["settings-open", "task-center-open", "home", "fake-polling"] as const;
type Scene = typeof scenes[number];
type Fixture = Awaited<ReturnType<typeof createMemoryFixture>>;
const selected = new Set((process.env.P0_SETTINGS_RETENTION_SCENARIOS ?? scenes.join(",")).split(","));
if (enabled && [...selected].some(scene => !scenes.includes(scene as Scene))) throw new Error("Unknown P0_SETTINGS_RETENTION_SCENARIOS");
const comparisonBuildId = "S5cTzkUB3A9l1bBTXyM6m";
const relevantRead = (path: string) => /^\/api\/(?:providers(?:\/[^/]+\/models)?|suppliers(?:\/[^/]+(?:\/verification)?)?|runs(?:\/[^/]+)?|projects|assets)$/.test(path);
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

/** Weak request keys and scalar counters; no Response/body/DOM retention. */
function observeReads(page: Page) {
  const pending = new WeakSet<Request>();
  const counts = { started: 0, completed: 0, failed: 0, inFlight: 0 };
  const started = (request: Request) => { if (relevantRead(new URL(request.url()).pathname)) { pending.add(request); counts.started++; counts.inFlight++; } };
  const finished = (request: Request) => { if (pending.delete(request)) { counts.completed++; counts.inFlight--; } };
  const failed = (request: Request) => { if (pending.has(request)) counts.failed++; finished(request); };
  page.on("request", started); page.on("requestfinished", finished); page.on("requestfailed", failed);
  return { snapshot: () => ({ ...counts }), dispose: () => {
    page.off("request", started); page.off("requestfinished", finished); page.off("requestfailed", failed);
  } };
}
async function installJsonCounts(page: Page) {
  await page.addInitScript(() => {
    const counts = { pending: 0, completed: 0, failed: 0 };
    (window as typeof window & { __p0CycleJson: typeof counts }).__p0CycleJson = counts;
    const json = Response.prototype.json;
    Response.prototype.json = function (...args: Parameters<typeof json>) {
      if (!/^\/api\/(?:providers(?:\/[^/]+\/models)?|suppliers(?:\/[^/]+(?:\/verification)?)?|runs(?:\/[^/]+)?|projects|assets)$/.test(new URL(this.url, location.href).pathname)) return json.apply(this, args);
      counts.pending++;
      // Closures capture only counters; value is passed straight to the app.
      return json.apply(this, args).then(value => { counts.pending--; counts.completed++; return value; },
        error => { counts.pending--; counts.failed++; throw error; });
    };
  });
}
const jsonCounts = (page: Page) => page.evaluate(() => ({ ...(window as typeof window & {
  __p0CycleJson: { pending: number; completed: number; failed: number };
}).__p0CycleJson }));
async function settle(page: Page, reads: ReturnType<typeof observeReads>) {
  let previous = -1, quietSince = Date.now();
  await expect.poll(async () => {
    const state = reads.snapshot();
    if (state.inFlight || (await jsonCounts(page)).pending || state.completed !== previous) {
      previous = state.completed; quietSince = Date.now(); return false;
    }
    return Date.now() - quietSince >= 200;
  }, { timeout: 15_000, intervals: [50, 100, 100] }).toBe(true);
  await page.evaluate(async () => {
    await Promise.resolve();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}
const uiState = (page: Page) => page.evaluate(() => ({
  path: location.pathname,
  settingsOpen: Boolean(document.querySelector(".sm-settings-dialog")),
  tasksOpen: Boolean(document.querySelector('[role="dialog"][aria-label="运行历史"]')),
  dialogs: Array.from(document.querySelectorAll('[role="dialog"]'), dialog => dialog.getAttribute("aria-label") ?? dialog.getAttribute("aria-labelledby")),
  canvasSearch: document.querySelector<HTMLInputElement>('input[aria-label="搜索画布"]')?.value ?? null,
  canvasTransform: document.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform ?? null,
  selectedNodeIds: Array.from(document.querySelectorAll(".react-flow__node.selected"), node => node.getAttribute("data-id")),
  commandMenuOpen: Boolean(document.querySelector("[data-canvas-command-menu]")),
}));

/** Short ordinary controls, deliberately not the slower full soak gesture set. */
async function cycle(page: Page, scene: Scene, fixture: Fixture, logStep?: (name: string, started: number) => Promise<void>) {
  if (scene === "settings-open") {
    // DOM activation avoids Playwright's geometry/animation stability polling.
    // It still invokes the real React handler; readiness, genuine input, full
    // response parsing, unmount and GC are all awaited separately below.
    let started = Date.now();
    await page.getByRole("button", { name: "API 设置", exact: false }).evaluate(button => (button as HTMLButtonElement).click());
    await logStep?.("open-dom-activation", started);
    started = Date.now();
    const dialog = page.getByRole("dialog", { name: "供应商与模型设置", exact: true });
    const search = dialog.getByLabel("搜索供应商", { exact: true });
    await expect(dialog).toBeVisible(); await expect(search).toBeEditable();
    await logStep?.("panel-and-input-ready", started);
    started = Date.now();
    await search.fill(fixture.settingsTarget!.supplierName);
    await logStep?.("search-input", started);
    started = Date.now();
    await search.fill("");
    await logStep?.("search-clear", started);
    started = Date.now();
    await dialog.getByRole("button", { name: "关闭设置", exact: true }).evaluate(button => (button as HTMLButtonElement).click());
    await expect(dialog).toHaveCount(0);
    await logStep?.("close-and-unmount", started);
  } else if (scene === "home") {
    const search = page.getByRole("textbox", { name: "搜索画布", exact: true });
    await search.fill("P0"); await search.fill("");
    const list = page.getByRole("button", { name: "列表视图", exact: true });
    if (await list.isVisible()) { await list.click(); await page.getByRole("button", { name: "网格视图", exact: true }).click(); }
    // Exercise the actual Home/Aura unmount and router cleanup without opening
    // the separately covered heavyweight Settings directory. Link + existing
    // Back button preserve the document/JS context; no loop uses page.goto.
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await page.locator(`a[aria-label^="打开画布 "][href=${JSON.stringify(`/canvas/${fixture.canvas.id}`)}]`).evaluate(link => (link as HTMLAnchorElement).click());
    await expect(page.locator(".react-flow__node").first()).toBeAttached();
    const back = page.getByRole("button", { name: "返回主界面", exact: true });
    await expect(back).toBeEnabled();
    await back.evaluate(button => (button as HTMLButtonElement).click());
    await expect(page.getByRole("textbox", { name: "搜索画布", exact: true })).toBeVisible();
    expect(await page.evaluate(() => performance.timeOrigin), "Home routing must keep the same document/context").toBe(timeOrigin);
  } else {
    // Fake tasks continue ordinary SSE/polling; never submit/retry/cancel one.
    await setScenarioView(page, "task-center-open", fixture);
    const dialog = page.getByRole("dialog", { name: "运行历史", exact: true });
    const search = dialog.getByRole("textbox", { name: "搜索任务", exact: true });
    if (await search.isVisible()) { await search.fill("Fake"); await search.fill(""); }
    else {
      const status = dialog.getByRole("combobox", { name: "筛选任务状态", exact: true });
      await status.selectOption("succeeded"); await status.selectOption("all");
    }
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  }
  await expect(page.locator(".sm-settings-dialog")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "运行历史", exact: true })).toHaveCount(0);
}

for (const scene of scenes) test(`P0 cycles ${scene}: 10/30 checkpoints, diagnostic only`, async ({ request }, testInfo) => {
  test.skip(!enabled || !selected.has(scene), "Explicit P0_SETTINGS_RETENTION=1 and scene selection required");
  if (!/p0-settings-retention-global-setup\.ts$/.test(testInfo.config.globalSetup ?? "")) throw new Error("Use the independent retention config");
  if (process.env.PLAYWRIGHT_BASE_URL || !process.env.P0_MEMORY_RUNTIME_DIR || process.env.P0_MEMORY_EXPECTED_BUILD_ID !== comparisonBuildId ||
      process.env.P0_MEMORY_FIXTURE !== "real" || process.env.P0_MEMORY_CATALOG !== "real-sanitized" || process.env.P0_MEMORY_BROWSER !== "electron" ||
      process.env.P0_MEMORY_SURFACE !== "native-windowed" || process.env.P0_MEMORY_PRELOAD !== "mock" || process.env.P0_MEMORY_SELECTION !== "original" ||
      readAgentModelsMemoryBytes() !== 512 * 1024) throw new Error("Requires owned S5, real/fullsafe, native Electron/mock preload, original selection, 512 KiB Agent");
  if (![undefined, "0", "1"].includes(process.env.P0_SETTINGS_RETENTION_SNAPSHOTS)) throw new Error("Invalid snapshot opt-in");
  const snapshotsEnabled = process.env.P0_SETTINGS_RETENTION_SNAPSHOTS === "1";
  const root = process.env.P0_MEMORY_OUTPUT_DIR;
  if (!root) throw new Error("P0_MEMORY_OUTPUT_DIR required");
  const preflight = JSON.parse(await readFile(join(root, "server-preflight.json"), "utf8"));
  if (!preflight.valid || preflight.expectedRuntimeBuildId !== comparisonBuildId) throw new Error("Requires valid >=6 GiB preflight and S5");
  const output = join(root, scene);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "run-owner.json"), JSON.stringify({ timestamp: new Date().toISOString(), workerPid: process.pid, scene, diagnosticOnly: true }), { flag: "wx" });
  const sceneStarted = Date.now(), baseURL = String(testInfo.project.use.baseURL);
  const preparation = await prepareMemoryFixtureInChild(baseURL, root, output, scene);
  const catalog = await loadMemoryCatalogFixture(output);
  if (!catalog?.settingsTarget || memoryCatalogManifestDigest(catalog.manifest) !== preparation.catalogManifestSha256) throw new Error("Prepared/renderer fullsafe catalog mismatch");
  const fixture = preparation.fixture;
  const agentModels = createAgentModelsMemoryResponder(512 * 1024, fixture.provider.id, output);
  await request.dispose();
  const driverPreparation = await reclaimFixtureDriverMemory(output);
  const target = await launchMemoryTarget(baseURL, output);
  const network = observeNetwork(target.page), reads = observeReads(target.page);
  const sampler = new MemorySampler(target.page, target.cdp, output, target.renderer, network);
  let routes: Awaited<ReturnType<typeof installMemoryRoutes>> | undefined;
  let completed = false, pageErrors = 0, serverExternalAttempts = 0, electronExternalAttempts = 0;
  let failure: string | null = null;
  const errors: string[] = [];
  target.page.on("pageerror", error => { pageErrors++; if (errors.length < 20) errors.push(error.message); });
  const boundaries: Array<{ round: number; phase: string; ui: Awaited<ReturnType<typeof uiState>>; raw: Awaited<ReturnType<MemorySampler["sample"]>>; postGc: Awaited<ReturnType<MemorySampler["sample"]>>; requests: ReturnType<typeof reads.snapshot>; json: Awaited<ReturnType<typeof jsonCounts>> }> = [];
  const snapshots: Array<Awaited<ReturnType<typeof takeHeapSnapshot>> & { round: number }> = [];
  let baselineUi: Awaited<ReturnType<typeof uiState>> | undefined;
  const gate = async (phase: string) => {
    const availableMemoryBytes = freemem();
    await appendFile(join(output, "environment-gates.jsonl"), `${JSON.stringify({ timestamp: new Date().toISOString(), phase, availableMemoryBytes, minimumAvailableBytes })}\n`);
    if (availableMemoryBytes < minimumAvailableBytes) sampler.invalidReasons.add("available-memory-below-6-GiB");
    if (await access(join(root, "STOP")).then(() => true).catch(() => false)) sampler.invalidReasons.add("stopped-by-evidence-sentinel");
    // Reserve cleanup time; never silently run fewer than thirty rounds.
    if (Date.now() - sceneStarted > 270_000) sampler.invalidReasons.add("five-minute-scene-budget-exceeded");
    if (sampler.invalidReasons.size) throw new Error([...sampler.invalidReasons].join(", "));
  };
  const checkpoint = async (round: number) => {
    const phase = round ? `round-${round}-closed` : "baseline-closed";
    await settle(target.page, reads); await gate(`${phase}-before`);
    const raw = await sampler.sample(phase);
    await target.cdp.send("HeapProfiler.collectGarbage");
    const postGc = await sampler.sample(phase, "post-gc");
    const ui = await uiState(target.page);
    if (baselineUi) expect(ui, `Same closed UI after round ${round}`).toEqual(baselineUi); else baselineUi = ui;
    const boundary = { round, phase, ui, raw, postGc, requests: reads.snapshot(), json: await jsonCounts(target.page) };
    boundaries.push(boundary);
    await appendFile(join(output, "boundaries.jsonl"), `${JSON.stringify(boundary)}\n`);
    if (snapshotsEnabled && (round === 10 || round === 30)) {
      const snapshot = await takeHeapSnapshot(target.cdp, join(output, `${phase}.post-gc.heapsnapshot`));
      snapshots.push({ round, ...snapshot });
      await appendFile(join(output, "snapshots.jsonl"), `${JSON.stringify({ round, ...snapshot })}\n`);
    }
    await gate(`${phase}-after`);
    if (round === 10 || round === 30) console.log(`P0 cycles ${scene} ${round}: JS ${(postGc.jsHeap.usedBytes / 1024 ** 2).toFixed(2)} MiB, private ${(postGc.renderer.privateBytes / 1024 ** 2).toFixed(2)} MiB`);
  };
  try {
    routes = await installMemoryRoutes(target.page, baseURL, fixture, agentModels, catalog);
    await installMediaDiagnostics(target.page); await installJsonCounts(target.page);
    await installEdgeGlowMode(target.page, readEdgeGlowMode()); await sampler.initialize(); await gate("before-navigation");
    await target.page.goto(new URL(scene === "home" ? "/" : `/canvas/${fixture.canvas.id}`, baseURL).href);
    if (scene === "home") await expect(target.page.getByRole("textbox", { name: "搜索画布", exact: true })).toBeVisible();
    else { await expect(target.page.locator(".react-flow__node").first()).toBeAttached(); await restoreMemorySelection(target.page, fixture); await setScenarioView(target.page, "canvas-idle", fixture); }
    await target.setInputBlocked(true);
    await writeFile(join(output, "manifest.json"), JSON.stringify({
      scene, runtimeBuildId: comparisonBuildId, diagnosticOnly: true, formalEvidenceValid: false,
      groups: "One continuous document/profile: checkpoint A after 10 cycles, checkpoint B after 30; shared warm state, not independent samples or twenty-minute evidence",
      maximumSceneMs: 300_000, cycles: 30, perRoundGc: true, snapshotsEnabled,
      target: target.metadata, driverPreparation, preparation: preparation.evidence, fixture: fixture.evidence,
      catalog: catalog.manifest, agentModelPayload: agentModels.manifest,
      operation: scene === "home" ? "Home search/view controls, existing fixture card Link to Canvas, existing Back button to Home; same document/timeOrigin, Home/Aura unmount/remount, no per-round Settings" : scene === "settings-open" ? "One largest-group warm-up before baseline; direct existing-button DOM activation, await real panel/input readiness, genuine supplier search/clear, DOM close and full unmount; still reads full providers/suppliers; separate scalar step timings" : "Task Center open, search/status filter reset, close; Fake polling keeps background SSE/read timers",
      instrumentation: "Scalar counters and weak Request keys only. Raw/post-GC JS/private/DOM and PID/start time per round; >=6 GiB before/after each cycle/sample. No forced clock or thirty-second wait. Default no snapshots; explicit second diagnostic may take two heaps at 10/30 after clear growth.",
    }, null, 2));
    if (scene === "settings-open") {
      // Establish the original largest-group cache scope once, before the
      // closed-state baseline. Other scenes and their currently running loop
      // branches are unchanged.
      await target.setInputBlocked(false);
      try {
        await setScenarioView(target.page, "settings-open", fixture);
        await settle(target.page, reads);
        await target.page.getByRole("button", { name: "关闭设置", exact: true }).click();
      } finally { await target.setInputBlocked(true); }
    }
    await checkpoint(0);
    for (let round = 1; round <= 30; round++) {
      await gate(`round-${round}-before`);
      const started = Date.now(); await target.setInputBlocked(false);
      try {
        await cycle(target.page, scene, fixture, scene === "settings-open" ? async (name, stepStarted) => {
          await appendFile(join(output, "action-steps.jsonl"), `${JSON.stringify({ round, name, timestamp: new Date(stepStarted).toISOString(), durationMs: Date.now() - stepStarted })}\n`);
        } : undefined);
      } finally { await target.setInputBlocked(true); }
      await appendFile(join(output, "actions.jsonl"), `${JSON.stringify({ round, timestamp: new Date(started).toISOString(), durationMs: Date.now() - started })}\n`);
      await checkpoint(round);
    }
    expect(pageErrors).toBe(0); expect(routes.blockedSubmissions).toBe(0); expect(routes.blockedExternal).toBe(0);
    expect(reads.snapshot().failed).toBe(0); expect((await jsonCounts(target.page)).failed).toBe(0);
    expect(catalog.snapshot().failed).toBe(0); expect(catalog.snapshot().categories.unknownCatalog.count).toBe(0);
    if (scene === "fake-polling") { expect(routes.runReads).toBeGreaterThan(1); expect(routes.eventReads).toBeGreaterThan(0); }
    expect([...sampler.invalidReasons]).toEqual([]); completed = true;
  } catch (error) { failure = String(error); throw error; }
  finally {
    network.dispose(); reads.dispose();
    if (!completed) sampler.invalidReasons.add("incomplete-diagnostic");
    if (pageErrors) sampler.invalidReasons.add("page-errors");
    try {
      serverExternalAttempts = (await readFile(join(root, "server-external-attempts.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean).length;
      const nativeNetwork = object(object(object(await target.renderer()).surfaceState).network);
      if (typeof nativeNetwork.blockedExternalAttempts !== "number") throw new Error("Missing native Electron guard counters");
      electronExternalAttempts = nativeNetwork.blockedExternalAttempts;
    } catch (error) { sampler.invalidReasons.add(`network-counter-read-failed:${String(error).slice(0, 120)}`); }
    if (routes?.blockedExternal || serverExternalAttempts || electronExternalAttempts) sampler.invalidReasons.add("external-network-attempt");
    if (routes?.blockedSubmissions) sampler.invalidReasons.add("unexpected-submission-attempt");
    try {
      await agentModels.flush(); await catalog.flush();
      const at = (round: number) => boundaries.find(boundary => boundary.round === round)?.postGc;
      const first = at(0), ten = at(10), thirty = at(30);
      const delta = (a: typeof first, b: typeof first) => a && b ? { jsBytes: b.jsHeap.usedBytes - a.jsHeap.usedBytes, privateBytes: b.renderer.privateBytes - a.renderer.privateBytes, domNodes: b.dom.nodes - a.dom.nodes } : null;
      await writeFile(join(output, "summary.json"), JSON.stringify({
        scene, completed, diagnosticOnly: true, formalEvidenceValid: false,
        diagnosticEvidenceValid: completed && sampler.invalidReasons.size === 0,
        invalidReasons: [...sampler.invalidReasons], failure, elapsedMs: Date.now() - sceneStarted,
        runtimeBuildId: comparisonBuildId, cyclesCompleted: boundaries.filter(boundary => boundary.round > 0).length,
        groupDefinition: "Same continuous page: first 10 and first 30 cycles, shared warm state; not independent profiles",
        deltas: { baselineTo10: delta(first, ten), tenTo30: delta(ten, thirty), baselineTo30: delta(first, thirty) },
        pageErrors, errors, routes, serverExternalAttempts, electronExternalAttempts, successfulExternalConnections: 0,
        agentModelResponses: agentModels.snapshot(), catalogResponses: catalog.snapshot(), boundaries, samples: sampler.rows, snapshots,
        interpretation: "Repeated closed-state GC curve only; not automatic plateau/no-leak evidence. Default no snapshots. Guards enforce isolated loopback only, not system-wide packet capture.",
        cleanupEvidence: ["browser-teardown.json", "../server-teardown.json"],
      }, null, 2));
    } finally { await target.close(); }
    if (sampler.invalidReasons.size && !failure) throw new Error(`Invalid diagnostic: ${[...sampler.invalidReasons].join(", ")}`);
  }
});
