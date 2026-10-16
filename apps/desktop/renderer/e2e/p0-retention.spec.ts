import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createMemoryFixture, installMemoryRoutes, setScenarioView } from "./helpers/p0-memory-fixture";
import { launchMemoryTarget } from "./helpers/p0-memory-launcher";
import { MemorySampler, observeNetwork } from "./helpers/p0-memory-metrics";

// Diagnostic evidence only: no product fix and no automatic leak/no-leak verdict.
// Use playwright.p0-memory.config.ts, P0_MEMORY_RETENTION=1, and select this file.
// The original installed/HEAD build lacks observedSizes; use the frozen repository build.
const enabled = process.env.P0_MEMORY_RETENTION === "1";
const cycles = 120;

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function probe(page: Page) {
  return page.evaluate(() => ({
    attachedMarkers: document.querySelectorAll("[data-p0-detached-tool]").length,
    panelOpen: Boolean(document.querySelector(".node-config-popover")),
    hidden: document.hidden,
  }));
}

async function cycleSyntheticTools(page: Page, matched: boolean) {
  // All DOM references are local to this evaluation, which completes before GC.
  // Never return element handles or keep node/WeakRef arrays on window/console.
  return page.evaluate(async ({ count, matched }) => {
    const host = document.querySelector(".canvas-wrap");
    if (!host || !document.querySelector(".node-config-popover")) throw new Error("Fixture parameter panel is not open");
    const frame = () => new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    let maxAttached = 0;
    let maxAfterRemove = 0;
    for (let index = 0; index < count; index++) {
      if (document.hidden || !document.querySelector(".node-config-popover")) throw new Error("Panel closed or renderer hidden during retention cycles");
      const tool = document.createElement("div");
      tool.className = matched ? "react-flow__controls" : "p0-unobserved-tool";
      tool.dataset.p0DetachedTool = `p0-retention-${matched ? "matched" : "control"}-${index}`;
      tool.setAttribute("aria-hidden", "true");
      tool.style.cssText = "position:absolute;left:8px;top:8px;width:24px;height:24px;pointer-events:none;visibility:hidden";
      try {
        host.append(tool);
        await frame(); // Allow mutation, placement rAF and initial resize delivery.
        maxAttached = Math.max(maxAttached, host.querySelectorAll("[data-p0-detached-tool]").length);
      } finally {
        tool.remove(); // Only remove the synthetic element created in this iteration.
      }
      await frame();
      maxAfterRemove = Math.max(maxAfterRemove, host.querySelectorAll("[data-p0-detached-tool]").length);
    }
    return { completedCycles: count, maxAttached, maxAfterRemove };
  }, { count: cycles, matched });
}

for (const matched of [true, false]) {
  const arm = matched ? "matched" : "control";
  test(`P0 observedSizes retention ${arm}`, async ({ request }, testInfo) => {
    test.skip(!enabled, "Requires explicit P0_MEMORY_RETENTION=1 and the isolated P0 configuration");
    test.setTimeout(6 * 60_000);
    if (!/p0-memory-global-setup\.ts$/.test(testInfo.config.globalSetup ?? "")) {
      throw new Error("Retention diagnostic requires playwright.p0-memory.config.ts and its isolated global setup");
    }
    if (process.env.PLAYWRIGHT_BASE_URL || process.env.P0_MEMORY_RUNTIME_DIR) {
      throw new Error("Retention diagnostic refuses external servers and installed-runtime copies; observedSizes belongs to the repository frozen build");
    }
    const root = process.env.P0_MEMORY_OUTPUT_DIR;
    const expectedBuildId = process.env.P0_MEMORY_EXPECTED_BUILD_ID;
    if (!root || !expectedBuildId) throw new Error("Set P0_MEMORY_OUTPUT_DIR and P0_MEMORY_EXPECTED_BUILD_ID");
    const buildId = (await readFile(new URL("../.next-desktop/BUILD_ID", import.meta.url), "utf8")).trim();
    if (buildId !== expectedBuildId) throw new Error("Frozen repository build changed");
    const preflight = JSON.parse(await readFile(join(root, "server-preflight.json"), "utf8"));
    if (preflight.repositoryBuildId !== buildId || preflight.expectedRuntimeBuildId !== buildId) throw new Error("P0 server preflight/build mismatch");
    if (!preflight.valid && process.env.P0_MEMORY_ALLOW_INVALID_DIAGNOSTIC !== "1") throw new Error("P0 preflight is invalid");
    const baseURL = String(testInfo.project.use.baseURL);
    if (new URL(baseURL).hostname !== "127.0.0.1") throw new Error("P0 diagnostic requires isolated loopback server");
    const output = join(root, `retention-${arm}`);
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "run-owner.json"), JSON.stringify({ started: new Date().toISOString(), workerPid: process.pid, arm }), { flag: "wx" });

    // This existing helper writes only into the ephemeral server from P0 global setup.
    // No real provider connection/profile is imported and generation is never submitted.
    const fixture = await createMemoryFixture(request, "canvas-idle");
    const target = await launchMemoryTarget(baseURL, output);
    const network = observeNetwork(target.page);
    const sampler = new MemorySampler(target.page, target.cdp, output, target.renderer, network);
    const phases: Array<{ label: string; attachedMarkers: number; panelOpen: boolean; hidden: boolean }> = [];
    const errors: string[] = [];
    let pageErrorCount = 0;
    const onError = (error: Error) => { pageErrorCount++; if (errors.length < 20) errors.push(error.message); };
    target.page.on("pageerror", onError);
    let state = { blockedSubmissions: 0, blockedExternal: 0, runReads: 0, eventReads: 0 };
    let cycleResult: Awaited<ReturnType<typeof cycleSyntheticTools>> | null = null;
    let completed = false;
    let failure: string | null = null;
    const checkpoint = async (label: string, panelOpen: boolean) => {
      await settle(target.page);
      const value = await probe(target.page);
      phases.push({ label, ...value });
      await writeFile(join(output, "marker-counts.json"), JSON.stringify(phases, null, 2));
      expect(value.attachedMarkers, "Synthetic nodes must be detached before snapshot").toBe(0);
      expect(value.panelOpen).toBe(panelOpen);
      expect(value.hidden).toBe(false);
      await sampler.checkpoint(label);
    };
    try {
      if (!preflight.valid) sampler.invalidReasons.add("server-preflight-invalid");
      state = await installMemoryRoutes(target.page, baseURL, fixture);
      await sampler.initialize();
      await target.page.goto(new URL(`/canvas/${fixture.canvas.id}`, baseURL).href);
      await setScenarioView(target.page, "canvas-idle");
      await target.page.getByRole("button", { name: "打开 图像生成 1 模型与参数", exact: true }).click();
      const panel = target.page.getByRole("dialog", { name: "图像生成 1 模型与参数", exact: true });
      await expect(panel).toBeVisible();
      await settle(target.page);
      await target.page.screenshot({ path: join(output, "start-screen.png"), animations: "allow" });
      await writeFile(join(output, "manifest.json"), JSON.stringify({
        timestamp: new Date().toISOString(), arm, cycles, buildId, target: target.metadata,
        firstBaselineBuildId: "JxcG8ieoQ3MFX6yPtgfWX", fixtureCanvasId: fixture.canvas.id,
        scene: "Existing P0 canvas-idle fixture; node ui-perf-1 parameter panel open",
        intervention: matched ? "append/remove our synthetic .react-flow__controls child" : "append/remove our synthetic nonmatching .p0-unobserved-tool child",
        markerAttribute: "data-p0-detached-tool", markerPrefix: `p0-retention-${arm}-`,
        objectRetention: "No DOM handles or arrays retained by probes; only scalar counts leave page.evaluate",
        evidence: "start, 120-cycles, closed post-GC heap snapshots; marker counts are connected DOM only, not detached-node leak counts",
      }, null, 2));
      await checkpoint("start", true);
      cycleResult = await cycleSyntheticTools(target.page, matched);
      expect(cycleResult.completedCycles).toBe(cycles);
      expect(cycleResult.maxAttached).toBe(1);
      expect(cycleResult.maxAfterRemove).toBe(0);
      await checkpoint("120-cycles", true);
      await panel.getByRole("button", { name: "关闭模型与参数面板", exact: true }).click();
      await expect(panel).toBeHidden();
      await checkpoint("closed", false);
      expect(state.blockedSubmissions, "No generation or supplier mutation may be attempted").toBe(0);
      expect(pageErrorCount).toBe(0);
      completed = true;
    } catch (error) {
      failure = String(error);
      throw error;
    } finally {
      target.page.off("pageerror", onError);
      network.dispose();
      if (pageErrorCount) sampler.invalidReasons.add("page-errors");
      if (state.blockedSubmissions) sampler.invalidReasons.add("unexpected-submission-attempt");
      if (!completed) sampler.invalidReasons.add("incomplete-retention-diagnostic");
      try {
        const finalBuildId = (await readFile(new URL("../.next-desktop/BUILD_ID", import.meta.url), "utf8")).trim();
        if (finalBuildId !== buildId) sampler.invalidReasons.add("build-changed-during-diagnostic");
        await writeFile(join(output, "summary.json"), JSON.stringify({
          arm, completed, diagnosticOnly: true, evidenceValid: completed && sampler.invalidReasons.size === 0,
          invalidReasons: [...sampler.invalidReasons], failure, buildId, finalBuildId, cycles: cycleResult,
          phases, state, pageErrorCount, errors, samples: sampler.rows,
          interpretation: "Inspect marker-tagged detached div retainers via observedSizes Map -> live effect/observer/store subscription. Require matched/control comparison and release after panel close. Snapshot string matches or passing this diagnostic alone do not prove a leak, and this current-only candidate does not explain historical HEAD OOM.",
          cleanup: "P0 launcher writes browser-teardown.json and verifies owned PIDs; P0 global setup owns server teardown and ephemeral data cleanup",
        }, null, 2));
      } finally {
        await target.close();
      }
    }
  });
}
