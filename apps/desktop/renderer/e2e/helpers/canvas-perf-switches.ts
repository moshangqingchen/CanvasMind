import { expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { freemem, totalmem } from "node:os";
import { promisify } from "node:util";
import { minimumAvailableMemoryBytes } from "./performance-environment";
import { CANVAS_NODE_SELECTOR_MIGRATIONS } from "../../lib/canvas-node-selector-metadata";

/** Test-injected diagnostics only. No product setting, stored preference or build branch. */
export const canvasPerfEffects = ["promotion", "shadow", "ports", "status", "edge-style", "dash", "background", "interaction-class", "selectors", "resize-observer"] as const;
export const canvasPerfCandidates = ["group-nodes", "viewport-contain", "node-contain", "pan-hit-test", "stroke-alpha", "panel-motion", "occlusion-inheritance", "culling", "grid-compositor", "wheel-capture", "edge-gradient", "aurora-color", "frosted"] as const;
export type CanvasPerfEffect = typeof canvasPerfEffects[number] | typeof canvasPerfCandidates[number];
type PerfSwitch = { effect: CanvasPerfEffect; arm: "A" | "B" };
type Counters = { roCallbacks: number; roEntries: number; nodeRoEntries: number; suppressedNodeRoEntries: number; roCallbackMs: number; interactionAttempts: number; interactionMutations: number; suppressedInteractionMutations: number };
type DiagnosticWindow = Window & {
  __uiPerf?: unknown;
  __canvasPerfSwitch?: PerfSwitch;
  __canvasPerfCounters?: Counters;
  __canvasPerfResetCounters?: () => void;
  __canvasPerfFlushObservers?: () => void;
  __canvasPerfLegacyGridRenderer?: (surface: HTMLDivElement, flow: { getTransform: () => readonly number[]; subscribe: (listener: () => void) => () => void }) => () => void;
};

// Surface roots only. Do not disable status/progress animations inside panels,
// nodes or the viewport, and do not force an opacity/transform terminal value.
const panelMotionClasses = ["node-config-popover-portal", "node-model-select-options", "sm-settings-backdrop", "sm-settings-dialog", "inspector", "inspector-agent-content", "agent-panel", "modal-backdrop", "modal-window", "sidebar", "project-sidebar"];
const panelMotionSelector = panelMotionClasses.map(name => `.canvas-editor .${name}`).join(", ");

export function requestedCanvasPerfSwitch(): PerfSwitch | null {
  const effect = process.env.UI_PERF_EFFECT;
  if (!effect) return null;
  if (![...canvasPerfEffects, ...canvasPerfCandidates].includes(effect as CanvasPerfEffect)) throw new Error(`Unknown UI_PERF_EFFECT: ${effect}`);
  const arm = process.env.UI_PERF_ARM;
  if (arm !== "A" && arm !== "B") throw new Error("UI_PERF_ARM must be A or B");
  return { effect: effect as CanvasPerfEffect, arm };
}

/** Runs before fixture setup/throttling, never inside a capture. No command lines are persisted. */
export async function collectCanvasPerfHostState() {
  const basic = { timestamp: new Date().toISOString(), workerPid: process.pid, availableMemoryBytes: freemem(), totalMemoryBytes: totalmem(), minimumAvailableMemoryBytes };
  if (process.platform !== "win32") return basic;
  const script = `$items = @(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='chrome.exe' OR Name='powershell.exe' OR Name='cmd.exe'");
    $byId = @{}; foreach ($item in $items) { $byId[[int]$item.ProcessId] = $item };
    $cursor = ${process.pid}; $testRoot = ${process.pid}; $seen = @{};
    while ($byId.ContainsKey($cursor) -and !$seen.ContainsKey($cursor)) { $seen[$cursor] = $true; $item = $byId[$cursor]; if ($item.Name -eq 'node.exe' -and $item.CommandLine -match '@playwright[\\/]test[\\/]cli[.]js.*canvas-ui-performance') { $testRoot = $cursor; break }; $cursor = [int]$item.ParentProcessId };
    $owned = @{}; $owned[$testRoot] = $true; for ($round = 0; $round -lt 8; $round++) { foreach ($item in $items) { if ($owned.ContainsKey([int]$item.ParentProcessId)) { $owned[[int]$item.ProcessId] = $true } } };
    $otherChecks = @($items | Where-Object { $_.Name -eq 'node.exe' -and !$owned.ContainsKey([int]$_.ProcessId) -and $_.CommandLine -match '(vitest|typescript[\\/]bin[\\/]tsc|@playwright[\\/]test[\\/]cli[.]js.*test|next[\\/]dist[\\/]bin[\\/]next.*build)' });
    $firstCpu = @{}; foreach ($process in Get-Process -Name node,chrome,SuperCanvasDesktop,SuperCanvas -ErrorAction SilentlyContinue) { try { $firstCpu[$process.Id] = @{ cpu=[double]$process.TotalProcessorTime.TotalSeconds; ticks=[Diagnostics.Stopwatch]::GetTimestamp() } } catch {} }; Start-Sleep -Milliseconds 250;
    $coreCount = [Environment]::ProcessorCount; $deltaRows = @();
    foreach ($process in Get-Process -Name node,chrome,SuperCanvasDesktop,SuperCanvas -ErrorAction SilentlyContinue) { if ($firstCpu.ContainsKey($process.Id)) { try { $cpu = [double]$process.TotalProcessorTime.TotalSeconds; $seconds = ([Diagnostics.Stopwatch]::GetTimestamp() - $firstCpu[$process.Id].ticks) / [double][Diagnostics.Stopwatch]::Frequency; $delta=[Math]::Max([double]0, [double]($cpu - $firstCpu[$process.Id].cpu)); $deltaRows += @{ pid=$process.Id; name=$process.ProcessName; ownTest=$owned.ContainsKey([int]$process.Id); cpuSeconds=$delta; sampleSeconds=$seconds; normalizedPercent=100 * $delta / $seconds / $coreCount } } catch {} } };
    $cpuDeltas = @($deltaRows | Sort-Object { $_.cpuSeconds } -Descending | Select-Object -First 8);
    $memoryRows = @(foreach ($process in Get-Process) { try { @{ pid=$process.Id; name=$process.ProcessName; ownTest=$owned.ContainsKey([int]$process.Id); workingSetMB=[Math]::Round($process.WorkingSet64 / 1MB, 1); privateMemoryMB=[Math]::Round($process.PrivateMemorySize64 / 1MB, 1) } } catch {} });
    $topWorkingSets = @($memoryRows | Sort-Object { $_.workingSetMB } -Descending | Select-Object -First 8);
    $topPrivateMemory = @($memoryRows | Sort-Object { $_.privateMemoryMB } -Descending | Select-Object -First 8);
    $ownedMemory = @($memoryRows | Where-Object { $_.ownTest });
    $processor = Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'" -ErrorAction SilentlyContinue;
    @{ nodeCount=@($items | Where-Object Name -eq 'node.exe').Count; chromeCount=@($items | Where-Object Name -eq 'chrome.exe').Count; testRootPid=$testRoot;
      ownNodeCount=@($items | Where-Object { $_.Name -eq 'node.exe' -and $owned.ContainsKey([int]$_.ProcessId) }).Count;
      ownChromeCount=@($items | Where-Object { $_.Name -eq 'chrome.exe' -and $owned.ContainsKey([int]$_.ProcessId) }).Count;
      otherBuildOrTestPids=@($otherChecks | ForEach-Object { [int]$_.ProcessId }); cpuProbeVersion=2; cpuProbeProcessNames=@('node','chrome','SuperCanvasDesktop','SuperCanvas'); logicalCores=$coreCount; topCpuDeltas=$cpuDeltas; topWorkingSets=$topWorkingSets; topPrivateMemory=$topPrivateMemory; ownProcessMemory=$ownedMemory;
      totalCpuPercent=$processor.PercentProcessorTime; processorPerformancePercent=$processor.PercentProcessorPerformance; processorFrequencyMHz=$processor.ProcessorFrequency; maximumFrequencyPercent=$processor.PercentofMaximumFrequency } | ConvertTo-Json -Depth 5 -Compress`;
  try {
    const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, timeout: 8_000, maxBuffer: 128_000 });
    return { ...basic, processes: JSON.parse(stdout) as Record<string, unknown> };
  } catch (error) { return { ...basic, probeError: String(error) }; }
}

export async function installCanvasPerfSwitch(page: Page) {
  const config = requestedCanvasPerfSwitch();
  if (!config) return;
  await page.addInitScript((config: PerfSwitch) => {
    const w = window as DiagnosticWindow;
    w.__canvasPerfSwitch = config;
    if (config.effect === "grid-compositor" && config.arm === "A") {
      let sequence = 0;
      w.__canvasPerfLegacyGridRenderer = (surface, flow) => {
        const ns = "http://www.w3.org/2000/svg", id = `perf-legacy-grid-${++sequence}`;
        const svg = document.createElementNS(ns, "svg");
        const pattern = document.createElementNS(ns, "pattern");
        const circle = document.createElementNS(ns, "circle");
        const rect = document.createElementNS(ns, "rect");
        svg.setAttribute("aria-hidden", "true");
        svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
        pattern.id = id; pattern.setAttribute("patternUnits", "userSpaceOnUse");
        circle.setAttribute("fill", "rgba(255,255,255,.06)"); pattern.append(circle);
        rect.setAttribute("width", "100%"); rect.setAttribute("height", "100%"); rect.setAttribute("fill", `url(#${id})`);
        svg.append(pattern, rect); surface.append(svg);
        surface.style.backgroundImage = "none"; surface.style.willChange = "auto";
        surface.style.width = "100%"; surface.style.height = "100%";
        let previous: readonly number[] = [];
        const update = () => {
          const transform = flow.getTransform(), [x, y, zoom] = transform;
          if (transform.every((value, index) => value === previous[index])) return;
          const gap = 20 * zoom;
          if (zoom !== previous[2]) {
            pattern.setAttribute("width", String(gap)); pattern.setAttribute("height", String(gap));
            pattern.setAttribute("patternTransform", `translate(${-1 - gap / 2},${-1 - gap / 2})`);
            for (const name of ["r", "cx", "cy"]) circle.setAttribute(name, String(.4 * zoom));
            surface.style.opacity = String(Math.max(0, Math.min(1, (zoom - .15) / .55)));
          }
          pattern.setAttribute("x", String(x % gap)); pattern.setAttribute("y", String(y % gap));
          previous = [...transform];
        };
        update(); const unsubscribe = flow.subscribe(update);
        return () => { unsubscribe(); svg.remove(); };
      };
    }
    w.__canvasPerfResetCounters = () => {
      w.__canvasPerfCounters = { roCallbacks: 0, roEntries: 0, nodeRoEntries: 0, suppressedNodeRoEntries: 0, roCallbackMs: 0, interactionAttempts: 0, interactionMutations: 0, suppressedInteractionMutations: 0 };
    };
    w.__canvasPerfResetCounters();
    // Preserve every initial measurement. Only capture-time node callbacks are
    // withheld in B, and they are replayed after capture before another action.
    const NativeResizeObserver = window.ResizeObserver;
    const pending = new Map<ResizeObserver, { entries: Map<Element, ResizeObserverEntry>; callback: ResizeObserverCallback }>();
    window.ResizeObserver = class extends NativeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          const capture = Boolean(w.__uiPerf);
          let delivered = entries;
          if (capture) {
            const counters = w.__canvasPerfCounters!;
            counters.roCallbacks++;
            counters.roEntries += entries.length;
            const nodeEntries = entries.filter(entry => entry.target.matches(".react-flow__node"));
            counters.nodeRoEntries += nodeEntries.length;
            if (config.effect === "resize-observer" && config.arm === "B") {
              counters.suppressedNodeRoEntries += nodeEntries.length;
              delivered = entries.filter(entry => !entry.target.matches(".react-flow__node"));
              if (nodeEntries.length) {
                const deferred = pending.get(observer) ?? { entries: new Map<Element, ResizeObserverEntry>(), callback };
                for (const entry of nodeEntries) deferred.entries.set(entry.target, entry);
                pending.set(observer, deferred);
              }
            }
          }
          if (!delivered.length) return;
          const started = capture ? performance.now() : 0;
          callback(delivered, observer);
          if (capture) w.__canvasPerfCounters!.roCallbackMs += performance.now() - started;
        });
      }
      disconnect() { pending.delete(this); super.disconnect(); }
      unobserve(target: Element) { pending.get(this)?.entries.delete(target); super.unobserve(target); }
    };
    w.__canvasPerfFlushObservers = () => {
      const callbacks = [...pending];
      pending.clear();
      for (const [observer, deferred] of callbacks) {
        const entries = [...deferred.entries.values()].filter(entry => entry.target.isConnected);
        if (entries.length) deferred.callback(entries, observer);
      }
    };
    const originalToggle = DOMTokenList.prototype.toggle;
    DOMTokenList.prototype.toggle = function(token: string, force?: boolean) {
      const isInteraction = token === "is-interacting" && this.contains("canvas-wrap");
      if (isInteraction) {
        const current = this.contains(token);
        const next = force ?? !current;
        if (w.__uiPerf) w.__canvasPerfCounters!.interactionAttempts++;
        if (config.effect === "interaction-class" && config.arm === "B") {
          if (w.__uiPerf && next !== current) w.__canvasPerfCounters!.suppressedInteractionMutations++;
          return current;
        }
        if (w.__uiPerf && next !== current) w.__canvasPerfCounters!.interactionMutations++;
      }
      return force === undefined ? originalToggle.call(this, token) : originalToggle.call(this, token, force);
    };
    if (config.effect === "pan-hit-test" && config.arm === "B") {
      let pressed = false, wheeling = false, timer = 0;
      const refresh = () => { document.documentElement.dataset.canvasPerfPanning = String(pressed || wheeling); };
      window.addEventListener("pointerdown", event => { if (event.button === 1 && event.target instanceof Element && event.target.closest(".react-flow")) { pressed = true; refresh(); } }, true);
      window.addEventListener("pointerup", () => { pressed = false; refresh(); }, true);
      window.addEventListener("pointercancel", () => { pressed = false; refresh(); }, true);
      window.addEventListener("wheel", event => { if (!(event.target instanceof Element) || !event.target.closest(".react-flow")) return; wheeling = true; refresh(); clearTimeout(timer); timer = window.setTimeout(() => { wheeling = false; refresh(); }, 160); }, { passive: true, capture: true });
    }
  }, config);
}

const effectStyles: Partial<Record<CanvasPerfEffect, string>> = {
  promotion: ".canvas-editor .react-flow__node { will-change:auto !important; translate:none !important; }",
  shadow: ".canvas-editor .node-card, .canvas-editor .node-card *, .canvas-editor .node-card::before, .canvas-editor .node-card::after { box-shadow:none !important; text-shadow:none !important; }",
  // Preserve node rectangles/handles. This diagnostic removes the label paint
  // and its reserved text gutter, not the ports themselves or their hit area.
  ports: ".canvas-editor .port-label { visibility:hidden !important; } .canvas-editor .node-card { --node-inset-left:12px !important; --node-inset-right:12px !important; }",
  status: ".canvas-editor .node-status, .canvas-editor .node-progress-fill, .canvas-editor .node-complete-flash { animation:none !important; transition:none !important; } .canvas-editor .node-complete-flash { opacity:0 !important; }",
  "edge-style": ".canvas-editor .studio-edge .react-flow__edge-path { stroke:#94a3b8 !important; opacity:1 !important; stroke-opacity:1 !important; filter:none !important; } .canvas-editor .studio-edge { opacity:1 !important; filter:none !important; }",
  // Change only the path's alpha mechanism. Preserve current idle/focused
  // alpha, colors, widths, parent opacity, filters and the static path geometry.
  // The earlier stylesheet still gives preview/error paths distinct idle alpha.
  "stroke-alpha": ".canvas-editor .studio-edge .react-flow__edge-path { opacity:1 !important; stroke-opacity:.45 !important; } .canvas-editor .studio-edge.is-error .react-flow__edge-path { stroke-opacity:.8 !important; } .canvas-editor .studio-edge.is-preview .react-flow__edge-path { stroke-opacity:.6 !important; } .canvas-editor .studio-edge:is(:hover, .is-focused, .is-selected) .react-flow__edge-path { stroke-opacity:.9 !important; }",
  "panel-motion": `${panelMotionSelector} { animation:none !important; transition:none !important; }`,
  "occlusion-inheritance": ".canvas-editor .react-flow__viewport { --canvas-occluded-right:0px; }",
  dash: ".canvas-editor .studio-edge-motion { display:none !important; }",
  background: ".canvas-editor .react-flow__background { visibility:hidden !important; }",
  "group-nodes": ".canvas-editor .react-flow__nodes { width:100%; height:100%; will-change:transform !important; } .canvas-editor .react-flow__node { will-change:auto !important; } .canvas-editor .react-flow__node.selected, .canvas-editor .react-flow__node.dragging { will-change:transform !important; }",
  "viewport-contain": ".canvas-editor .react-flow__viewport { contain:layout style; }",
  "node-contain": ".canvas-editor .react-flow__node { contain:layout style; }",
  "pan-hit-test": "html[data-canvas-perf-panning=\"true\"] .canvas-editor .react-flow__node { pointer-events:none !important; }",
  // Keep all paths, glow paths and existing on-demand paint-server definitions.
  // Only replace the paint server with its existing source-type color.
  "edge-gradient": ".canvas-editor .studio-edge .react-flow__edge-path, .canvas-editor .studio-edge .studio-edge-glow { stroke:var(--edge-color) !important; }",
  // Static decoration only: preserve geometry, layers, shadows, outlines,
  // progress/failure state feedback, image scrims and alpha checkerboards.
  // Solid custom properties also reach module-scoped add/type/action buttons.
  // Selected cards need explicit background longhands because their normal
  // two-image shorthand cannot accept a solid color in its first layer.
  "aurora-color": `.canvas-editor {
    --aurora-primary:#8B5CF6 !important; --aurora-action:#7843D9 !important; --aurora-node:#181823 !important;
    --aurora-type-text:#A78BFA !important; --aurora-type-image:#2DD4BF !important;
    --aurora-type-video:#F5A524 !important; --aurora-type-audio:#F472B6 !important;
    --aurora-type-asset:#5EA8F5 !important; --aurora-type-result:#94A3B8 !important;
  }
  .canvas-editor .canvas-aurora { background-image:none !important; }
  .canvas-editor .node-card:not(.generated-result-node):not([data-node-status="failed"]) {
    background-color:var(--surface-node) !important; background-image:none !important;
  }`,
};

export async function canvasPerfGeometry(page: Page) {
  return page.evaluate(() => {
    const round = (value: number) => Math.round(value * 1000) / 1000;
    const box = (element: Element) => { const bounds = element.getBoundingClientRect(); return [bounds.x, bounds.y, bounds.width, bounds.height].map(round); };
    return {
      viewport: getComputedStyle(document.querySelector(".react-flow__viewport")!).transform,
      canvas: box(document.querySelector(".react-flow")!),
      nodes: [...document.querySelectorAll(".react-flow__node")].map(element => ({ id: element.getAttribute("data-id"), box: box(element), handles: [...element.querySelectorAll(".react-flow__handle")].map(handle => ({ id: handle.getAttribute("data-handleid"), type: handle.classList.contains("source") ? "source" : "target", box: box(handle) })) })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
      edges: [...document.querySelectorAll(".react-flow__edge")].map(element => ({ id: element.getAttribute("data-id"), d: element.querySelector(".react-flow__edge-path")?.getAttribute("d"), transform: element.querySelector("g")?.getAttribute("transform") })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    };
  });
}

export async function applyCanvasPerfSwitch(page: Page) {
  const config = requestedCanvasPerfSwitch();
  if (!config) return null;
  // Settle the normal inspector opening before checking the switch itself.
  await page.waitForTimeout(250);
  const before = await canvasPerfGeometry(page);
  await page.evaluate(config => { document.documentElement.dataset.canvasPerfEffect = config.effect; document.documentElement.dataset.canvasPerfArm = config.arm; }, config);
  if (config.effect === "frosted") await page.evaluate(arm => { document.documentElement.dataset.frosted = arm === "A" ? "on" : "off"; }, config.arm);
  // Derive the shared static degradation from every actual interaction rule,
  // including its exceptions/at-rules. Keep an evidence inventory: a future
  // theme rule must not silently turn this into an animation/paint comparison.
  const interactionNormalization = config.effect === "interaction-class"
    ? await normalizeCanvasInteractionStyles(page) : null;
  const panelMotionInventory = config.effect === "panel-motion"
    ? await inventoryPanelMotionStyles(page) : null;
  if (config.effect === "promotion" && config.arm === "A")
    await page.addStyleTag({ content: ".canvas-editor .react-flow__node { will-change:transform !important; }" });
  if (config.arm === "B" && effectStyles[config.effect]) await page.addStyleTag({ content: effectStyles[config.effect]! });
  if (config.effect === "wheel-capture" && config.arm === "B") await page.evaluate(() => {
    const canvas = document.querySelector(".canvas-editor .canvas-wrap");
    if (!canvas) throw new Error("Wheel capture candidate needs the mounted canvas");
    let pressed = false, wheeling = false, timer = 0;
    const refresh = () => canvas.classList.toggle("is-interacting", pressed || wheeling);
    const reset = () => { clearTimeout(timer); pressed = false; wheeling = false; refresh(); };
    canvas.addEventListener("pointerdown", () => { pressed = true; }, true);
    window.addEventListener("pointerup", () => { pressed = false; refresh(); });
    canvas.addEventListener("wheel", () => {
      wheeling = true; refresh(); clearTimeout(timer);
      timer = window.setTimeout(() => { wheeling = false; refresh(); }, 160);
    }, { passive: true, capture: true });
    window.addEventListener("pointercancel", reset); window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", () => { if (document.hidden) reset(); });
  });
  let selectorReport: unknown = null;
  if (config.effect === "selectors") selectorReport = await restoreCanvasNodeSelectors(page, config.arm);
  if (config.effect === "status" && config.arm === "B") await page.evaluate(() => {
    for (const element of document.querySelectorAll(".node-status, .node-progress-fill, .node-complete-flash")) for (const animation of element.getAnimations()) animation.pause();
  });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const after = await canvasPerfGeometry(page);
  expect(after, "Effect switch must preserve mounted node/edge IDs, rectangles, handles, path geometry and viewport").toEqual(before);
  expect(after.nodes).toHaveLength(120);
  expect(after.edges).toHaveLength(80);
  return { config, geometry: after, selectorReport, interactionNormalization, panelMotionInventory, state: await canvasPerfState(page) };
}

async function inventoryPanelMotionStyles(page: Page) {
  return page.evaluate(({ classes, selector }) => {
    const rules: Array<{ selector: string; declarations: Array<[string, string, string]>; atRules: string[] }> = [];
    const targetClass = new RegExp(`\\.(?:${classes.join("|")})(?![\\w-])`, "u");
    const walk = (list: CSSRuleList, atRules: string[] = []) => {
      for (const rule of list) {
        if (rule instanceof CSSStyleRule) {
          if (!targetClass.test(rule.selectorText)) continue;
          const declarations = Array.from(rule.style).filter(property => /^(?:animation|transition)(?:-|$)/u.test(property))
            .map(property => [property, rule.style.getPropertyValue(property), rule.style.getPropertyPriority(property)] as [string, string, string]);
          if (declarations.length) rules.push({ selector: rule.selectorText, declarations, atRules });
        } else if ("cssRules" in rule) {
          const header = rule.cssText.slice(0, rule.cssText.indexOf("{")).trim();
          walk((rule as CSSGroupingRule).cssRules, [...atRules, header]);
        }
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); }
      catch (error) { throw new Error(`Cannot inventory panel-motion stylesheet: ${String(error)}`); }
    }
    return { selector, roots: classes, rules,
      note: "Inventory of animation/transition rules naming the targeted surface classes, before B injection. Model-menu/agent roots may have no own animation; ancestor motion is recorded separately. No descendant, opacity, transform or viewport override." };
  }, { classes: panelMotionClasses, selector: panelMotionSelector });
}

async function normalizeCanvasInteractionStyles(page: Page) {
  const report = await page.evaluate(() => {
    const replacements: Array<{ before: string; after: string; declarations: string; atRules: string[] }> = [];
    const unsupported: string[] = [];
    const rules: string[] = [];
    const walk = (list: CSSRuleList, atRules: string[] = []) => {
      for (const rule of list) {
        if (rule instanceof CSSStyleRule && /\.is-interacting\b/u.test(rule.selectorText)) {
          // Current rules positively select the interacting canvas ancestor.
          // Inverted/root-independent forms need a deliberate normalization;
          // skipping them would make the two arms visually incomparable.
          if (!rule.selectorText.includes("canvas-editor") ||
              /:not\([^)]*\.is-interacting\b/u.test(rule.selectorText)) {
            unsupported.push(rule.selectorText);
            continue;
          }
          const after = rule.selectorText.replace(/\.is-interacting\b/gu, ".canvas-wrap");
          const declarations = Array.from(rule.style)
            .map(property => `${property}:${rule.style.getPropertyValue(property)} !important;`).join(" ");
          replacements.push({ before: rule.selectorText, after, declarations, atRules });
          let css = `${after} { ${declarations} }`;
          for (const header of [...atRules].reverse()) css = `${header} { ${css} }`;
          rules.push(css);
        } else if ("cssRules" in rule) {
          const header = rule.cssText.slice(0, rule.cssText.indexOf("{")).trim();
          walk((rule as CSSGroupingRule).cssRules, [...atRules, header]);
        }
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); }
      catch (error) { throw new Error(`Cannot inventory interaction stylesheet: ${String(error)}`); }
    }
    return { replacements, unsupported, css: rules.join("\n") };
  });
  expect(report.unsupported, "Every interaction rule must have an explicit shared-arm normalization").toEqual([]);
  expect(report.replacements.length, "Interaction invalidation diagnostic requires actual degradation rules").toBeGreaterThan(0);
  await page.addStyleTag({ content: report.css });
  const computedParity = await page.evaluate(replacements => {
    const canvas = document.querySelector(".canvas-editor .canvas-wrap");
    if (!canvas) throw new Error("Interaction normalization requires the actual canvas root");
    const hadClass = canvas.classList.contains("is-interacting");
    const propertiesByTarget = new Map<Element, Set<string>>();
    for (const replacement of replacements) {
      const declaration = document.createElement("span").style;
      declaration.cssText = replacement.declarations;
      for (const target of document.querySelectorAll(replacement.after)) {
        const properties = propertiesByTarget.get(target) ?? new Set<string>();
        for (const property of Array.from(declaration)) properties.add(property);
        propertiesByTarget.set(target, properties);
      }
    }
    const targets = [...propertiesByTarget];
    const snapshot = () => targets.map(([target, properties]) => {
      const style = getComputedStyle(target);
      return [...properties].map(property => [property, style.getPropertyValue(property)] as const);
    });
    try {
      // add/remove bypass the B arm's toggle suppression. This preflight runs
      // before capture and restores the real interaction state in both arms.
      canvas.classList.remove("is-interacting");
      const idle = snapshot();
      canvas.classList.add("is-interacting");
      const interacting = snapshot();
      const mismatches = targets.flatMap(([target], index) =>
        JSON.stringify(idle[index]) === JSON.stringify(interacting[index]) ? [] : [{
          className: target.getAttribute("class"), idle: idle[index], interacting: interacting[index],
        }]);
      return { targets: targets.length, checkedDeclarations: idle.reduce((sum, values) => sum + values.length, 0), mismatches };
    } finally {
      if (hadClass) canvas.classList.add("is-interacting");
      else canvas.classList.remove("is-interacting");
    }
  }, report.replacements);
  expect(computedParity.targets, "Shared degradation must actually cover rendered canvas descendants").toBeGreaterThan(0);
  expect(computedParity.mismatches, "Normalized interaction declarations must be identical with the root class on/off").toEqual([]);
  return { replacements: report.replacements, unsupported: report.unsupported, computedParity,
    note: "All positive .is-interacting rules are cloned onto the always-present .canvas-wrap ancestor, with original exceptions and at-rule conditions; B alone suppresses the actual class mutation." };
}

export async function canvasPerfState(page: Page) {
  return page.evaluate(panelSelector => {
    const animations = document.getAnimations().map(animation => {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      return { playState: animation.playState, target: target instanceof Element ? target.getAttribute("class") : null, animationName: animation instanceof CSSAnimation ? animation.animationName : null };
    });
    return { theme: document.documentElement.dataset.theme, frosted: document.documentElement.dataset.frosted,
      islandPaint: [...document.querySelectorAll('[data-canvas-island],.editor-rail,.canvas-toolbar,.react-flow__controls')].map(element => {
        const style = getComputedStyle(element);
        return { island: element.getAttribute("data-canvas-island"), className: element.getAttribute("class"), backdropFilter: style.backdropFilter, background: style.backgroundColor };
      }), activeAnimations: animations.filter(animation => animation.playState === "running"), animations,
      statusCounts: Object.fromEntries(["idle", "queued", "running", "succeeded", "failed"].map(status => [status, document.querySelectorAll(`.node-card[data-node-status="${status}"]`).length])),
      promotion: [...new Set([...document.querySelectorAll(".react-flow__node")].map(node => getComputedStyle(node).willChange))],
      edgePaint: [...new Set([...document.querySelectorAll(".studio-edge .react-flow__edge-path")].map(path => {
        const style = getComputedStyle(path);
        return JSON.stringify({ opacity: style.opacity, strokeOpacity: style.strokeOpacity, stroke: style.stroke, filter: style.filter });
      }))].map(value => JSON.parse(value) as { opacity: string; strokeOpacity: string; stroke: string; filter: string }),
      ...(["edge-gradient", "aurora-color"].includes((window as DiagnosticWindow).__canvasPerfSwitch?.effect ?? "") ? {
        themePaint: {
          gradientDefinitions: document.querySelectorAll(".canvas-edge-palette linearGradient").length,
          gradientMainPaths: [...document.querySelectorAll(".studio-edge .react-flow__edge-path")].filter(path => getComputedStyle(path).stroke.includes("url(")).length,
          gradientGlowPaths: [...document.querySelectorAll(".studio-edge .studio-edge-glow")].filter(path => getComputedStyle(path).stroke.includes("url(")).length,
          auroraBackgrounds: [...document.querySelectorAll(".canvas-aurora")].map(element => getComputedStyle(element).backgroundImage),
          nodeBackgrounds: [...new Set([...document.querySelectorAll(".node-card:not(.generated-result-node)")].map(element => getComputedStyle(element).backgroundImage))],
          typeBackgrounds: [...new Set([...document.querySelectorAll(".node-title .node-icon, [data-canvas-add-node-menu] [data-node-color] > span")].map(element => getComputedStyle(element).backgroundImage))],
          actionBackgrounds: [...new Set([...document.querySelectorAll('.canvas-editor .button.primary, .canvas-editor button[aria-label="添加节点"], .canvas-editor .canvas-toolbar button[aria-pressed="true"]')].map(element => getComputedStyle(element).backgroundImage))],
        },
      } : {}),
      ...((window as DiagnosticWindow).__canvasPerfSwitch?.effect === "panel-motion" ? {
        panelMotion: [...document.querySelectorAll(panelSelector)].map(element => {
          const style = getComputedStyle(element);
          return { className: element.getAttribute("class"), visible: element.getClientRects().length > 0,
            animationName: style.animationName, animationDuration: style.animationDuration, animationDelay: style.animationDelay,
            animationFillMode: style.animationFillMode, transitionProperty: style.transitionProperty, transitionDuration: style.transitionDuration,
            opacity: style.opacity, transform: style.transform };
        }),
      } : {}),
      ...((window as DiagnosticWindow).__canvasPerfSwitch?.effect === "occlusion-inheritance" ? {
        occlusionInheritance: Object.fromEntries(([
          ["root", ".canvas-editor"],
          ["viewport", ".canvas-editor .react-flow__viewport"],
          ["toolbar", ".canvas-editor .canvas-toolbar"],
          ["minimap", ".canvas-editor .react-flow__minimap"],
        ] as const).map(([name, selector]) => {
          const element = document.querySelector(selector);
          return [name, element ? getComputedStyle(element).getPropertyValue("--canvas-occluded-right").trim() : null];
        })),
      } : {}),
      dashLayers: document.querySelectorAll(".studio-edge-motion").length,
      visibleDashLayers: [...document.querySelectorAll(".studio-edge-motion")].filter(element => getComputedStyle(element).display !== "none").length,
      counters: (window as DiagnosticWindow).__canvasPerfCounters ?? null };
  }, panelMotionSelector);
}

export async function resetCanvasPerfCounters(page: Page) {
  if (!requestedCanvasPerfSwitch()) return;
  await page.evaluate(() => (window as DiagnosticWindow).__canvasPerfResetCounters?.());
}

export async function flushCanvasPerfObservers(page: Page) {
  if (!requestedCanvasPerfSwitch()) return;
  await page.evaluate(() => (window as DiagnosticWindow).__canvasPerfFlushObservers?.());
}

/** Candidate-only snapshot gate. It never runs in the original 100 A/B arms. */
export async function probeCanvasPerfHitTesting(page: Page) {
  const edgePoint = await page.evaluate(() => {
    for (const edge of document.querySelectorAll(".react-flow__edge")) {
      const path = edge.querySelector<SVGPathElement>(".react-flow__edge-path");
      const matrix = path?.getScreenCTM();
      if (!path || !matrix) continue;
      for (const fraction of [.5, .25, .75]) {
        const local = path.getPointAtLength(path.getTotalLength() * fraction);
        const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
        if (document.elementFromPoint(point.x, point.y)?.closest(".react-flow__edge") === edge) return { id: edge.getAttribute("data-id")!, x: point.x, y: point.y };
      }
    }
    return null;
  });
  expect(edgePoint, "A static edge must retain its visible-stroke hit target").not.toBeNull();
  await page.mouse.click(edgePoint!.x, edgePoint!.y);
  await expect(page.locator(`.react-flow__edge[data-id="${edgePoint!.id}"]`)).toHaveClass(/selected/);
  await page.locator('.react-flow__node[data-id="ui-perf-0"] .node-head').click();
  await expect(page.locator('.react-flow__node[data-id="ui-perf-0"]')).toHaveClass(/selected/);
  return { edgePoint, selectedNode: "ui-perf-0", geometry: await canvasPerfGeometry(page), state: await canvasPerfState(page) };
}

async function restoreCanvasNodeSelectors(page: Page, arm: "A" | "B") {
  return page.evaluate(({ migrations, arm }) => {
    const split = (text: string) => {
      const result: string[] = []; let start = 0, depth = 0, square = 0, quote = "";
      for (let i = 0; i < text.length; i++) { const c = text[i]!;
        if (quote) { if (c === quote && text[i - 1] !== "\\") quote = ""; continue; }
        if (c === "'" || c === '"') { quote = c; continue; }
        if (c === "[") square++; else if (c === "]") square--; else if (!square && c === "(") depth++; else if (!square && c === ")") depth--;
        else if (!depth && !square && c === ",") { result.push(text.slice(start, i).trim()); start = i + 1; }
      }
      result.push(text.slice(start).trim()); return result;
    };
    const scratch = new CSSStyleSheet(); scratch.insertRule("* {}");
    const canonical = (selector: string) => { const rule = scratch.cssRules[0] as CSSStyleRule; rule.selectorText = selector; return rule.selectorText; };
    const entries = migrations.map(entry => ({ ...entry, explicit: entry.explicitSelectors.map(canonical) }));
    const matched = new Set<string>();
    const replacements: Array<{ id: string; before: string; after: string }> = [];
    const walk = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) {
          let branches = split(rule.selectorText);
          for (const entry of entries) {
            if (!entry.explicit.every(selector => branches.includes(selector))) continue;
            matched.add(entry.id);
            if (arm === "A") {
              const before = rule.selectorText;
              branches = [...branches.filter(selector => !entry.explicit.includes(selector)), ...split(canonical(entry.legacySelector))];
              rule.selectorText = branches.join(", ");
              replacements.push({ id: entry.id, before, after: rule.selectorText });
            }
          }
        } else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch (error) { throw new Error(`Cannot inspect benchmark stylesheet: ${String(error)}`); } }
    return { arm, matched: [...matched], unmatched: entries.filter(entry => !matched.has(entry.id)).map(entry => entry.id), replacements,
      note: "A restores original selectors in the same CSS rules; B retains explicit production selectors. Declarations and cascade order stay unchanged." };
  }, { migrations: CANVAS_NODE_SELECTOR_MIGRATIONS, arm });
}
