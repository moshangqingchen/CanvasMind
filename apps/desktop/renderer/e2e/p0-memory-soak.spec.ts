import { expect, test, type Request, type Response } from "@playwright/test";
import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createMemoryFixture, installMemoryRoutes, memoryScenarios, performMemoryOperation, restoreMemorySelection, setScenarioView } from "./helpers/p0-memory-fixture";
import { launchMemoryTarget } from "./helpers/p0-memory-launcher";
import { installAuraDiagnostics, installMediaDiagnostics, MemorySampler, observeNetwork, probeAuraActivity } from "./helpers/p0-memory-metrics";
import { installEdgeGlowMode, readEdgeGlowMode } from "./helpers/p0-edge-effects";
import { createAgentModelsMemoryResponder, readAgentModelsMemoryBytes } from "./helpers/p0-memory-agent-models";
import { loadMemoryCatalogFixture } from "./helpers/p0-memory-catalog-fixture";
import { reclaimFixtureDriverMemory } from "./helpers/p0-memory-driver";
import { memoryInputCountsChanged, readMemoryInputCounts, type MemoryInputCounts } from "./helpers/p0-memory-idle-input";
import { memoryCatalogManifestDigest, prepareMemoryFixtureInChild, readPreparationChildMode } from "./helpers/p0-memory-preparation";
import { NativeMemoryTrace, readNativeMemoryTraceMode } from "./helpers/p0-memory-native-trace";
import { validateMemorySnapshotReference } from "./helpers/p0-memory-reference";

const enabled = process.env.P0_MEMORY_SOAK === "1";
const selected = new Set((process.env.P0_MEMORY_SCENARIOS ?? memoryScenarios.join(",")).split(","));
if (enabled && [...selected].some(name => !memoryScenarios.includes(name as typeof memoryScenarios[number]))) throw new Error("Unknown P0_MEMORY_SCENARIOS value");

function seconds(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}`);
  return value;
}

for (const scenario of memoryScenarios) test(`P0 memory ${scenario}`, async ({ request }, testInfo) => {
  test.skip(!enabled || !selected.has(scenario), "Explicit P0_MEMORY_SOAK=1 and scene selection required");
  const idleSeconds = seconds("P0_MEMORY_IDLE_SECONDS", 1200);
  const operationSeconds = seconds("P0_MEMORY_OPERATION_SECONDS", 300);
  const sampleSeconds = seconds("P0_MEMORY_SAMPLE_SECONDS", 45);
  const aura = process.env.P0_MEMORY_AURA ?? "running";
  if (!["running", "paused"].includes(aura)) throw new Error("P0_MEMORY_AURA must be running or paused");
  const nativeTraceEnabled = readNativeMemoryTraceMode();
  const diagnosticOnly = idleSeconds < 1200 || idleSeconds > 1800 || operationSeconds < 300 || sampleSeconds < 30 || sampleSeconds > 60 ||
    nativeTraceEnabled || ["offscreen", "hidden-unthrottled"].includes(process.env.P0_MEMORY_SURFACE ?? "");
  if (sampleSeconds < 1) throw new Error("Sampling interval must be at least one second");
  const snapshots = process.env.P0_MEMORY_HEAP_SNAPSHOTS !== "0";
  // Full retained-object evidence has already been collected for the same
  // immutable build. Additional surfaces can collect complete GC/private-memory
  // curves without repeatedly allocating hundreds of MB for Inspector snapshots.
  // This does not relax duration, input, network or available-memory gates.
  const snapshotReference = !snapshots && !diagnosticOnly
    ? await validateMemorySnapshotReference(process.env.P0_MEMORY_SNAPSHOT_REFERENCE, process.env.P0_MEMORY_EXPECTED_BUILD_ID)
    : null;
  test.setTimeout((idleSeconds + operationSeconds) * 1000 + 360_000);
  const root = process.env.P0_MEMORY_OUTPUT_DIR!;
  const output = join(root, scenario);
  await mkdir(output, { recursive: true });
  // Refuse accidental overwrites of baseline/evidence from another invocation.
  await writeFile(join(output, "run-owner.json"), JSON.stringify({ started: new Date().toISOString(), workerPid: process.pid }), { flag: "wx" });
  const baseURL = String(testInfo.project.use.baseURL);
  const preparation = readPreparationChildMode() ? await prepareMemoryFixtureInChild(baseURL, root, output, scenario) : undefined;
  // The measurement worker loads display catalog data only after preparation's
  // API-only worker exits. It never uploads original media in the child arm.
  const catalog = await loadMemoryCatalogFixture(output);
  if (preparation && preparation.catalogManifestSha256 !== memoryCatalogManifestDigest(catalog?.manifest))
    throw new Error("Prepared fixture and measurement worker catalog identities differ");
  const fixture = preparation?.fixture ?? await createMemoryFixture(request, scenario, catalog);
  const agentBytes = readAgentModelsMemoryBytes();
  const agentModels = agentBytes ? createAgentModelsMemoryResponder(agentBytes, fixture.provider.id, output) : undefined;
  // A real fixture uploads hundreds of MB. Release the driver's request/response
  // buffers before measuring the renderer and before the ≥ 6 GiB sample gate.
  await request.dispose();
  const driverPreparation = await reclaimFixtureDriverMemory(output);
  const target = await launchMemoryTarget(baseURL, output);
  const network = observeNetwork(target.page);
  let state = { blockedSubmissions: 0, blockedExternal: 0, runReads: 0, eventReads: 0,
    mockedCatalogCalls: 0, mockedCatalogPostCalls: 0, mockedCatalogGetCalls: 0 };
  const errors: string[] = [];
  let pageErrorCount = 0;
  target.page.on("pageerror", error => { pageErrorCount++; if (errors.length < 50) errors.push(error.message); });
  const sampler = new MemorySampler(target.page, target.cdp, output, target.renderer, network);
  let nativeTrace: NativeMemoryTrace | undefined;
  const actions: Array<{ timestamp: string; index: number; durationMs: number; phase: string }> = [];
  let completed = false;
  let failure: string | null = null;
  let measuredIdleMs = 0;
  let measuredOperationMs = 0;
  let idleHeapGrowthBytes: number | null = null;
  let idleInputComparison: { start: MemoryInputCounts | null; end: MemoryInputCounts | null; changed: boolean | null } | null = null;
  let agentWarmup: {
    enabled: true; outsideMeasuredPeriods: true; completed: boolean;
    startedAt: string; finishedAt: string | null; requestsBefore: number; requestsAfter: number;
    requests: number; responsesOk: number; responsesOther: number; finished: number; failed: number;
    mountedAfterClose: number; restoredCanvasIdle: boolean;
  } | null = null;
  const maximumIdleHeapGrowthBytes = 16 * 1024 * 1024;
  let serverExternalAttempts = 0;
  let electronExternalAttempts = 0;
  const viewState = () => target.page.evaluate(() => ({
    transform: document.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform ?? null,
    selectedNodeIds: Array.from(document.querySelectorAll(".react-flow__node.selected"), node => node.getAttribute("data-id")),
    selectedEdges: document.querySelectorAll(".react-flow__edge.selected").length,
  }));
  const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
  const checkpoint = async (label: "start" | "idle-end" | "operations-end") => {
    if (snapshots) await sampler.checkpoint(label);
    else { await sampler.sample(label); await target.cdp.send("HeapProfiler.collectGarbage"); await sampler.sample(label, "post-gc"); }
    if (catalog) await appendFile(join(output, "catalog-samples.jsonl"), `${JSON.stringify({ timestamp: new Date().toISOString(), phase: label, ...catalog.snapshot() })}\n`);
    if (nativeTrace) await nativeTrace.dump(label, sampler.rows.find(row => row.phase === label && row.kind === "post-gc"));
  };
  const runPeriod = async (phase: "idle" | "operations", durationSeconds: number) => {
    const started = Date.now(); const until = started + durationSeconds * 1000;
    let nextSample = started;
    let nextOperation = started;
    let index = 0;
    while (Date.now() < until) {
      if (await access(join(root, "STOP")).then(() => true).catch(() => false)) throw new Error("Stopped by evidence-directory STOP sentinel");
      if (phase === "operations" && Date.now() >= nextOperation) {
        const actionStarted = Date.now();
        await target.setInputBlocked(false);
        try {
          await performMemoryOperation(target.page, scenario, index, fixture);
          if (scenario !== "home") await restoreMemorySelection(target.page, fixture);
        } finally { await target.setInputBlocked(true); }
        const row = { timestamp: new Date(actionStarted).toISOString(), index: index++, durationMs: Date.now() - actionStarted, phase };
        actions.push(row); await appendFile(join(output, "actions.jsonl"), `${JSON.stringify(row)}\n`);
        nextOperation = actionStarted + 30_000;
      }
      if (Date.now() >= nextSample) {
        await sampler.sample(phase);
        if (catalog) await appendFile(join(output, "catalog-samples.jsonl"), `${JSON.stringify({ timestamp: new Date().toISOString(), phase, ...catalog.snapshot() })}\n`);
        nextSample += sampleSeconds * 1000;
        console.log(`P0 memory ${scenario}: ${phase} ${Math.round((Date.now() - started) / 1000)}s/${durationSeconds}s`);
        // A contaminated formal run cannot become valid again. Preserve the
        // partial evidence and release its owned processes immediately.
        if (!diagnosticOnly && sampler.invalidReasons.size)
          throw new Error(`Invalid formal memory sample: ${[...sampler.invalidReasons].join(", ")}`);
      }
      await wait(Math.max(1, Math.min(1000, until - Date.now())));
    }
    return Date.now() - started;
  };
  try {
    state = await installMemoryRoutes(target.page, baseURL, fixture, agentModels, catalog);
    await installMediaDiagnostics(target.page);
    await installEdgeGlowMode(target.page, readEdgeGlowMode());
    if (scenario === "home") await installAuraDiagnostics(target.page);
    await sampler.initialize();
    await target.page.goto(new URL(scenario === "home" ? "/" : `/canvas/${fixture.canvas.id}`, baseURL).href);
    if (scenario !== "home") await expect(target.page.locator(".react-flow__node").first()).toBeAttached();
    const originalViewState = await viewState();
    if (scenario !== "home") await restoreMemorySelection(target.page, fixture);
    await setScenarioView(target.page, scenario, fixture);
    if (scenario === "home") {
      const toggle = target.page.getByRole("button", { name: aura === "paused" ? "暂停动效" : "开启动效", exact: true });
      if (await toggle.isVisible()) await toggle.click();
      await expect(target.page.getByRole("button", { name: aura === "paused" ? "开启动效" : "暂停动效", exact: true })).toBeVisible();
    }
    if (process.env.P0_MEMORY_WARMUP_OPERATIONS !== "0") {
      await performMemoryOperation(target.page, scenario, -1, fixture);
      await setScenarioView(target.page, scenario, fixture);
      if (scenario !== "home") await restoreMemorySelection(target.page, fixture);
    }
    if (scenario === "canvas-idle" && process.env.P0_MEMORY_WARM_AGENT === "1") {
      // Lazy Agent must have mounted once for the original hidden five-second
      // model polling path to be exercised. This is explicit UI preparation,
      // before native input isolation and every measured/GC boundary.
      agentWarmup = { enabled: true, outsideMeasuredPeriods: true, completed: false,
        startedAt: new Date().toISOString(), finishedAt: null,
        requestsBefore: network.snapshot().byEndpoint["GET /api/agent/models"] ?? 0, requestsAfter: 0,
        requests: 0, responsesOk: 0, responsesOther: 0, finished: 0, failed: 0,
        mountedAfterClose: 0, restoredCanvasIdle: false };
      const warmup = agentWarmup;
      // A WeakSet identifies only requests started during warmup. Counters and
      // timestamps are retained; no Request, Response, body or model payload is.
      const pending = new WeakSet<Request>();
      const onRequest = (request: Request) => {
        if (request.method() === "GET" && new URL(request.url()).pathname === "/api/agent/models") {
          pending.add(request); warmup.requests++;
        }
      };
      const onResponse = (response: Response) => {
        if (!pending.has(response.request())) return;
        if (response.ok()) warmup.responsesOk++; else warmup.responsesOther++;
      };
      const onFinished = (request: Request) => { if (pending.delete(request)) warmup.finished++; };
      const onFailed = (request: Request) => { if (pending.delete(request)) warmup.failed++; };
      target.page.on("request", onRequest); target.page.on("response", onResponse);
      target.page.on("requestfinished", onFinished); target.page.on("requestfailed", onFailed);
      try {
        await setScenarioView(target.page, "agent-open", fixture);
        await expect(target.page.getByRole("textbox", { name: "创作任务要求", exact: true })).toBeEditable();
        await expect.poll(() => warmup.finished, { timeout: 30_000,
          message: "Warm Agent must finish a real mocked model-list read before idle" }).toBeGreaterThan(0);
        await expect.poll(() => warmup.requests - warmup.finished - warmup.failed).toBe(0);
        expect(warmup.responsesOk).toBeGreaterThan(0);
        expect(warmup.responsesOther).toBe(0); expect(warmup.failed).toBe(0);
        // Let ordinary fetch parsing and the resulting UI commit finish; never
        // parse/retain another copy of the large response in the test driver.
        await target.page.evaluate(() => new Promise<void>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await setScenarioView(target.page, "canvas-idle", fixture);
        await restoreMemorySelection(target.page, fixture);
        await expect(target.page.getByRole("button", { name: "智能体面板", exact: true })).toHaveAttribute("aria-expanded", "false");
        await expect(target.page.getByRole("textbox", { name: "创作任务要求", exact: true })).toBeHidden();
        warmup.mountedAfterClose = await target.page.locator(".agent-panel").count();
        expect(warmup.mountedAfterClose).toBeGreaterThan(0);
        warmup.restoredCanvasIdle = true; warmup.completed = true;
      } finally {
        target.page.off("request", onRequest); target.page.off("response", onResponse);
        target.page.off("requestfinished", onFinished); target.page.off("requestfailed", onFailed);
        warmup.requestsAfter = network.snapshot().byEndpoint["GET /api/agent/models"] ?? 0;
        warmup.finishedAt = new Date().toISOString();
        await writeFile(join(output, "agent-warmup.json"), JSON.stringify(warmup, null, 2));
      }
    }
    await target.setInputBlocked(true);
    if (process.env.P0_MEMORY_BROWSER === "electron") {
      const before = await target.page.evaluate(() => JSON.stringify((window as typeof window & { __p0InputCounters?: unknown }).__p0InputCounters));
      // Exercise the native gate before measuring. A broken gate fails here,
      // never after spending twenty minutes on a contaminated idle period.
      await target.page.mouse.click(4, 4);
      await target.page.mouse.wheel(0, 120);
      await target.page.keyboard.press("Escape");
      await target.page.waitForTimeout(150);
      const after = await target.page.evaluate(() => JSON.stringify((window as typeof window & { __p0InputCounters?: unknown }).__p0InputCounters));
      expect(after, "Native idle input gate must prevent page input").toBe(before);
    }
    await wait(seconds("P0_MEMORY_SETTLE_SECONDS", 10) * 1000);
    await target.page.screenshot({ path: join(output, "start-screen.png"), animations: "allow" });
    if (scenario === "home") {
      const activity = await probeAuraActivity(target.page);
      await writeFile(join(output, "aura-probe.json"), JSON.stringify({ requested: aura, ...activity }, null, 2));
      const expectedMotion = aura === "paused" ? activity.dataAnimating === "false" && activity.clearDelta === 0 : activity.dataAnimating === "true" && activity.clearDelta >= 3;
      if (activity.hidden || !expectedMotion || !activity.intersection.isIntersecting || (activity.intersection.ratio ?? 0) < 0.05) {
        sampler.invalidReasons.add(aura === "paused" ? "aura-not-paused" : "aura-inactive");
        throw new Error(`Home aura did not demonstrate requested ${aura} state; see aura-probe.json.`);
      }
    }
    const startupPreparationGc = process.env.P0_MEMORY_PRIME_RENDERER_GC === "1";
    if (startupPreparationGc) {
      // Fixture loading and first image decoding precede this steady-state
      // soak. Reclaim their temporary allocations before its first boundary;
      // never clear invalid samples or collect inside a measured idle period.
      await target.cdp.send("HeapProfiler.collectGarbage");
      await wait(500);
    }
    const repoBuildId = (await readFile(new URL("../.next-desktop/BUILD_ID", import.meta.url), "utf8")).trim();
    await writeFile(join(output, "manifest.json"), JSON.stringify({
      timestamp: new Date().toISOString(), scenario, aura, auraControl: "Existing home motion button; also affects other home motion effects, not exclusively Canvas aura", diagnosticOnly, idleSeconds, operationSeconds, sampleSeconds, snapshots, snapshotReference,
      phase: process.env.P0_MEMORY_PHASE ?? "unlabelled", repositoryBuildId: repoBuildId, runtimeBuildId: process.env.P0_MEMORY_EXPECTED_BUILD_ID,
      target: target.metadata, baseURL, workerPid: process.pid,
      startupPreparation: { rendererGc: startupPreparationGc, outsideMeasuredPeriods: true },
      viewport: await target.page.evaluate(() => ({ innerWidth, innerHeight, outerWidth, outerHeight, devicePixelRatio })),
      fixture: { ...fixture.evidence, fixtureKind: fixture.fixtureKind, canvasId: fixture.canvas.id,
        visibleSceneNodes: scenario === "home" ? 0 : fixture.evidence.nodes, runs: fixture.runs.length,
        models: catalog ? catalog.manifest.models.reduce((total, item) => total + item.models, 0) : 1,
        supplierAccounts: catalog ? `${catalog.manifest.suppliers} safe display-only supplier records; no account credentials` : "one synthetic .invalid account",
        runNetwork: "mock only; native EventSource reconnection + ordinary application polling", submissionsAllowed: false },
      controlledSelection: process.env.P0_MEMORY_SELECTION ?? "original", warmupEnabled: process.env.P0_MEMORY_WARMUP_OPERATIONS !== "0",
      ...(agentWarmup ? { agentWarmup } : {}),
      controlledLegacyEdgeGlow: readEdgeGlowMode(),
      agentModelPayload: agentModels?.manifest ?? null,
      catalogPayload: catalog?.manifest ?? null,
      originalViewState, measuredStartViewState: await viewState(),
      instrumentation: { gc: "only checkpoint boundaries", snapshot: snapshots ? "post explicit collectGarbage; raw pre-GC metrics saved separately" : "curve-only: raw/post-GC checkpoints; retained-object evidence is the explicit same-build snapshotReference", nativeMemory: "Windows renderer PrivateMemorySize64, independent of JS heap", network: "bounded counters, no retained Request/DOM references",
        driverPreparation: { status: driverPreparation.status, gcCalls: driverPreparation.gcCalls, workerPid: driverPreparation.process.pid,
          evidence: "driver-preparation-memory.json; optional worker-only GC after request disposal, before renderer launch" },
        preparationChild: preparation?.evidence ?? null,
        nativeTrace: { enabled: nativeTraceEnabled, diagnosticOnly: nativeTraceEnabled,
          evidence: nativeTraceEnabled ? ["native-memory-trace.json", "native-memory-infra.trace.json"] : [],
          addedGcCalls: 0, periodicDumps: false, note: "Optional memory-infra diagnostic only; successful dumps still require allocator attribution, not an automatic no-leak verdict" },
        idleInput: "Fixed scalar counters at start/idle-end; changes invalidate formal idle without changing application behavior",
        idleInputIsolation: "Isolated Electron window only: native before-input-event/before-mouse-event prevent delivery during idle; ordinary scripted operations temporarily restore native input. Rendering, compositor and product timers remain active.",
        desktopBridge: process.env.P0_MEMORY_PRELOAD === "mock" ? "Repository real preload with mocked read-only IPC; product main/profile not loaded; installed preload identity not verified" : "not injected; product preload/profile not loaded",
        catalogUpgrade: process.env.P0_MEMORY_CATALOG_POLL === "1" ? "mock running with empty IDs; only renderer 3-second polling" : "mock complete with empty IDs; no server catalog work" },
    }, null, 2));
    if (nativeTraceEnabled) {
      // Resolve Chrome's trace-based PID mapper before opening our trace session.
      // Subsequent samples reuse that mapping; Electron maps its native PID.
      const mapping = await target.renderer();
      nativeTrace = new NativeMemoryTrace(target.cdp, output, mapping.pid);
      await nativeTrace.start();
    }
    await checkpoint("start");
    measuredIdleMs = await runPeriod("idle", idleSeconds);
    await checkpoint("idle-end");
    const startInput = readMemoryInputCounts(sampler.rows.find(row => row.phase === "start" && row.kind === "post-gc"));
    const endInput = readMemoryInputCounts(sampler.rows.find(row => row.phase === "idle-end" && row.kind === "post-gc"));
    idleInputComparison = { start: startInput, end: endInput,
      changed: startInput && endInput ? memoryInputCountsChanged(startInput, endInput) : null };
    if (idleInputComparison.changed) sampler.invalidReasons.add("unexpected-input-during-idle");
    if (idleInputComparison.changed === null) sampler.invalidReasons.add("missing-idle-input-counters");
    const postGcHeap = (phase: string) => {
      const heap = sampler.rows.find(row => row.phase === phase && row.kind === "post-gc")?.jsHeap;
      if (typeof heap !== "object" || heap === null || !("usedBytes" in heap) || typeof heap.usedBytes !== "number")
        throw new Error(`Missing post-GC heap boundary: ${phase}`);
      return heap.usedBytes;
    };
    idleHeapGrowthBytes = postGcHeap("idle-end") - postGcHeap("start");
    measuredOperationMs = await runPeriod("operations", operationSeconds);
    await checkpoint("operations-end");
    if (!diagnosticOnly)
      expect(idleHeapGrowthBytes, "Twenty-minute idle must not retain more than 16 MiB of new JS heap").toBeLessThanOrEqual(maximumIdleHeapGrowthBytes);
    expect(state.blockedSubmissions, "No generation, agent turn, supplier scan or other mutation may be attempted").toBe(0);
    expect(state.blockedExternal, "No external browser request may even be attempted").toBe(0);
    serverExternalAttempts = (await readFile(join(root, "server-external-attempts.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean).length;
    expect(serverExternalAttempts, "No external server TCP connection may even be attempted").toBe(0);
    const finalTarget = await target.renderer();
    if ("surfaceState" in finalTarget && typeof finalTarget.surfaceState === "object" && finalTarget.surfaceState !== null &&
        "network" in finalTarget.surfaceState && typeof finalTarget.surfaceState.network === "object" && finalTarget.surfaceState.network !== null &&
        "blockedExternalAttempts" in finalTarget.surfaceState.network && typeof finalTarget.surfaceState.network.blockedExternalAttempts === "number")
      electronExternalAttempts = finalTarget.surfaceState.network.blockedExternalAttempts;
    expect(electronExternalAttempts, "Electron request guard must observe zero external attempts").toBe(0);
    if (process.env.P0_MEMORY_PRELOAD === "mock") {
      expect(state.mockedCatalogPostCalls, "Real preload should activate the mocked DesktopBridge catalog startup").toBeGreaterThan(0);
      if (process.env.P0_MEMORY_CATALOG_POLL === "1" && idleSeconds >= 10) expect(state.mockedCatalogGetCalls).toBeGreaterThan(1);
    }
    if (scenario === "fake-polling") {
      expect(state.runReads).toBeGreaterThan(1); expect(state.eventReads).toBeGreaterThan(0);
    }
    if (agentModels) {
      const agentResponses = agentModels.snapshot();
      if (scenario !== "home") expect(agentResponses.responses, "The normal Agent model read must exercise the local response").toBeGreaterThan(0);
      expect(agentResponses.failed).toBe(0);
      expect(agentResponses.responseBytes).toBe(agentResponses.responses * agentResponses.payloadBytes);
    }
    if (catalog) {
      const catalogResponses = catalog.snapshot();
      expect(catalogResponses.categories.providers.count, "Full catalog arm must be read by the renderer").toBeGreaterThan(0);
      expect(catalogResponses.categories.unknownCatalog.count, "Catalog requests must all have explicit local fixture responses").toBe(0);
      expect(catalogResponses.failed).toBe(0);
    }
    expect(pageErrorCount).toBe(0);
    if (!diagnosticOnly) {
      const preflight = JSON.parse(await readFile(join(root, "server-preflight.json"), "utf8"));
      if (!preflight.valid) sampler.invalidReasons.add("server-preflight-invalid");
      expect([...sampler.invalidReasons], "A formal soak must pass every sample gate, including available RAM >= 6 GiB").toEqual([]);
    }
    completed = true;
  } catch (error) { failure = String(error); throw error; }
  finally {
    network.dispose();
    if (pageErrorCount) sampler.invalidReasons.add("page-errors");
    if (state.blockedSubmissions) sampler.invalidReasons.add("unexpected-submission-attempt");
    if (state.blockedExternal || serverExternalAttempts || electronExternalAttempts) sampler.invalidReasons.add("external-network-attempt");
    if (!completed) sampler.invalidReasons.add("incomplete-scenario");
    try {
      await agentModels?.flush();
      await catalog?.flush();
      const nativeTraceEvidence = await nativeTrace?.stop();
      if (nativeTraceEvidence && !nativeTraceEvidence.valid) sampler.invalidReasons.add("native-memory-trace-incomplete");
      const serverPreflight = JSON.parse(await readFile(join(root, "server-preflight.json"), "utf8"));
      if (!serverPreflight.valid) sampler.invalidReasons.add("server-preflight-invalid");
      await writeFile(join(output, "summary.json"), JSON.stringify({
        scenario, aura, completed, diagnosticOnly, formalEvidenceValid: completed && !diagnosticOnly && sampler.invalidReasons.size === 0,
        invalidReasons: [...sampler.invalidReasons], failure, measuredIdleMs, measuredOperationMs,
        idleHeapGrowthBytes, maximumIdleHeapGrowthBytes, idleInputComparison, driverPreparation, nativeTrace: nativeTraceEvidence ?? null, snapshots, snapshotReference,
        ...(agentWarmup ? { agentWarmup } : {}),
        pageErrorCount, errors, state, serverExternalAttempts, electronExternalAttempts, successfulExternalConnections: 0,
        agentModelResponses: agentModels?.snapshot() ?? null,
        catalogResponses: catalog?.snapshot() ?? null,
        networkEvidence: "Browser route plus Electron webRequest plus server Socket.connect guard allow isolated loopback only; successfulExternalConnections=0 is enforced by the guards, not claimed as packet capture. Every observed external attempt must also be zero.",
        actions, samples: sampler.rows,
        interpretation: "Observed metrics and post-GC snapshots are evidence, not an automatic no-leak verdict. Heap shallow bytes do not represent Windows renderer private bytes. Check retention paths and native/GPU allocations separately.",
      }, null, 2));
    } finally { await target.close(); }
  }
});
