import { chromium, _electron, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mapChromeRenderer, windowsProcessMemory } from "./p0-memory-metrics";

const token = "supercanvas-isolated-e2e-session";

async function installIdleInputGuard(page: Page) {
  await page.addInitScript(() => {
    const state = { blocked: false, prevented: 0 };
    (window as typeof window & { __p0IdleInputGuard: typeof state }).__p0IdleInputGuard = state;
    // CDP wheel/keyboard injection can bypass Electron's native pre-dispatch
    // events. This capture guard also covers it, before product window handlers
    // or document-level counters. No event, target, text or coordinate is kept.
    const prevent = (event: Event) => {
      if (!state.blocked) return;
      state.prevented++;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const type of ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "mousemove", "click", "dblclick", "auxclick", "contextmenu", "wheel", "keydown", "keypress", "keyup", "touchstart", "touchmove", "touchend"])
      window.addEventListener(type, prevent, { capture: true, passive: false });
  });
}

async function setPageInputBlocked(page: Page, blocked: boolean) {
  await page.evaluate(blocked => {
    (window as typeof window & { __p0IdleInputGuard: { blocked: boolean } }).__p0IdleInputGuard.blocked = blocked;
  }, blocked);
}

export async function launchMemoryTarget(baseURL: string, output: string) {
  const raster = process.env.P0_MEMORY_DISABLE_GPU === "1";
  const gpuArgs = raster ? ["--disable-gpu"] : [];
  const mode = process.env.P0_MEMORY_BROWSER ?? "chrome";
  const preloadMode = process.env.P0_MEMORY_PRELOAD ?? "none";
  if (!["none", "mock"].includes(preloadMode)) throw new Error(`Unknown P0_MEMORY_PRELOAD: ${preloadMode}`);
  if (preloadMode === "mock" && mode !== "electron") throw new Error("P0_MEMORY_PRELOAD=mock requires Electron");
  if (process.env.P0_MEMORY_CATALOG_POLL === "1" && preloadMode !== "mock") throw new Error("Controlled catalog polling requires P0_MEMORY_PRELOAD=mock");
  const surface = process.env.P0_MEMORY_SURFACE ?? "hidden";
  if (!["hidden", "hidden-unthrottled", "offscreen", "native-windowed"].includes(surface)) throw new Error(`Unknown P0_MEMORY_SURFACE: ${surface}`);
  if (mode !== "electron" && surface !== "hidden") throw new Error("P0_MEMORY_SURFACE overrides require Electron");
  const surfaceArgs = surface === "hidden-unthrottled" ? ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"] : [];
  const args = [...gpuArgs, ...surfaceArgs];
  const temporaryRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(temporaryRoot, "supercanvas-p0-browser-"));
  const owned = new Map<number, string>();
  let stopped = false;
  const remember = async (pid: number) => {
    const process = await windowsProcessMemory(pid);
    owned.set(pid, process.startedAt);
  };
  const cleanTemporaryRoot = async () => {
    if (dirname(root) !== temporaryRoot || !basename(root).startsWith("supercanvas-p0-browser-")) throw new Error("Unsafe browser cleanup path");
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  const reportShutdown = async () => {
    const remaining: Array<{ pid: number; startedAt: string }> = [];
    for (const [pid, startedAt] of owned) {
      const current = await windowsProcessMemory(pid).catch(() => null);
      if (current?.startedAt === startedAt) remaining.push({ pid, startedAt });
    }
    await writeFile(join(output, "browser-teardown.json"), JSON.stringify({ timestamp: new Date().toISOString(), observedOwnedPids: [...owned.keys()], remaining }, null, 2));
    if (remaining.length) throw new Error(`Owned browser processes remain after close: ${remaining.map(item => item.pid).join(", ")}`);
  };

  if (mode === "electron") {
    const executablePath = process.env.P0_MEMORY_ELECTRON_EXECUTABLE;
    if (!executablePath) { await cleanTemporaryRoot(); throw new Error("Electron mode requires explicit P0_MEMORY_ELECTRON_EXECUTABLE"); }
    const mainPath = join(root, "main.cjs");
    let preloadPath: string | undefined;
    let preloadIdentity: { mode: string; source?: string; sha256?: string; sourcePath?: string; installedPreloadVerified: boolean } = { mode: "none", installedPreloadVerified: false };
    if (preloadMode === "mock") {
      try {
        const sourcePath = fileURLToPath(new URL("../../../src/preload.cjs", import.meta.url));
        const source = await readFile(sourcePath);
        preloadPath = join(root, "preload.cjs");
        await writeFile(preloadPath, source, { flag: "wx" });
        preloadIdentity = { mode: "mock", source: "repository preload with isolated mock IPC; not verified installed preload", sourcePath,
          sha256: createHash("sha256").update(source).digest("hex"), installedPreloadVerified: false };
      } catch (error) { await cleanTemporaryRoot(); throw error; }
    }
    // This main never imports the installed application's startup/profile code.
    // The origin is the production server owned by the isolated global setup.
    await writeFile(mainPath, `const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('node:path');
globalThis.__p0NativePaintFrames = 0;
globalThis.__p0NetworkCounters = { blockedExternalAttempts: 0, successfulExternalConnections: 0 };
globalThis.__p0IpcCalls = { updateStatus: 0, referenceStatus: 0, preparedAcknowledgements: 0, rejected: 0 };
globalThis.__p0IdleInput = { blocked: false, mouseEvents: 0, keyboardEvents: 0 };
app.setPath('userData', path.join(__dirname, 'user-data'));
app.setPath('sessionData', path.join(__dirname, 'session-data'));
app.whenReady().then(() => {
  const allowedOrigin = ${JSON.stringify(new URL(baseURL).origin)};
  let win;
  if (${preloadMode === "mock"}) {
    const trusted = event => event.sender === win?.webContents && event.senderFrame === win.webContents.mainFrame &&
      new URL(event.senderFrame.url).origin === allowedOrigin;
    ipcMain.handle('desktop:update-status', event => {
      if (!trusted(event)) throw new Error('P0 rejects untrusted IPC');
      globalThis.__p0IpcCalls.updateStatus++;
      return { formatVersion: 1, desktop: true, enabled: false, managerAvailable: false, repository: 'isolated/mock',
        intervalSeconds: 21600, currentVersion: '0.0.0-p0-mock', currentNotes: '', phase: 'disabled' };
    });
    ipcMain.handle('desktop:reference-status', event => {
      if (!trusted(event)) throw new Error('P0 rejects untrusted IPC');
      globalThis.__p0IpcCalls.referenceStatus++;
      return { enabled: false, baseUrl: '', tokenConfigured: false, phase: 'disabled', message: 'P0 isolated mock; no gateway', port: 3210 };
    });
    ipcMain.on('desktop:prepared', event => {
      if (trusted(event)) globalThis.__p0IpcCalls.preparedAcknowledgements++;
    });
    for (const channel of ['desktop:update-action', 'desktop:initialize', 'desktop:retry', 'desktop:open-logs', 'desktop:cancel-exit', 'desktop:reference-save']) {
      ipcMain.handle(channel, () => {
        globalThis.__p0IpcCalls.rejected++;
        throw new Error('P0 mock IPC forbids this action');
      });
    }
  }
  session.defaultSession.webRequest.onBeforeRequest((details, done) => {
    const url = new URL(details.url);
    const blocked = !['data:', 'blob:', 'about:'].includes(url.protocol) && url.origin !== allowedOrigin;
    if (blocked) globalThis.__p0NetworkCounters.blockedExternalAttempts++;
    done({ cancel: blocked });
  });
  session.defaultSession.webRequest.onBeforeSendHeaders((details, done) => {
    if (new URL(details.url).origin === allowedOrigin) details.requestHeaders['x-supercanvas-desktop-token'] = ${JSON.stringify(token)};
    done({ requestHeaders: details.requestHeaders });
  });
  win = new BrowserWindow({ width: 1600, height: 1000, show: false, paintWhenInitiallyHidden: true,
    webPreferences: { backgroundThrottling: false, nodeIntegration: false, contextIsolation: true, sandbox: true, offscreen: ${surface === "offscreen"}, preload: ${JSON.stringify(preloadPath)} } });
  if (${surface === "native-windowed"}) {
    win.setTitle('SuperCanvas — 隔离内存测量，请勿操作（未加载正式资料）');
    win.on('page-title-updated', event => event.preventDefault());
    win.setContentSize(1600, 1000);
    win.show();
    win.focus();
  }
  if (win.webContents.isOffscreen()) {
    // Default CPU bitmap delivery: deliberately do not store the NativeImage,
    // dirty rectangle or event object. Canvas acceleration is a separate flag.
    win.webContents.on('paint', () => { globalThis.__p0NativePaintFrames++; });
    win.webContents.setFrameRate(60);
    win.webContents.startPainting();
  }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Isolate only this test window. Keep rendering, focus, timers and all product
  // listeners intact; prevent outside input from changing a timed idle scene.
  win.webContents.on('before-mouse-event', event => {
    if (globalThis.__p0IdleInput.blocked) { globalThis.__p0IdleInput.mouseEvents++; event.preventDefault(); }
  });
  win.webContents.on('before-input-event', event => {
    if (globalThis.__p0IdleInput.blocked) { globalThis.__p0IdleInput.keyboardEvents++; event.preventDefault(); }
  });
  win.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
`, "utf8");
    let app;
    try { app = await _electron.launch({ executablePath, args: [...args, mainPath], timeout: 45_000, env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" } }); }
    catch (error) { await cleanTemporaryRoot(); throw error; }
    try {
    const page = await app.firstWindow();
    await installIdleInputGuard(page);
    const context = app.context();
    const cdp = await context.newCDPSession(page);
    await remember(app.process().pid!);
    const renderer = async () => {
      const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map(item => ({ pid: item.pid, type: item.type })));
      for (const item of metrics) if (!owned.has(item.pid)) await remember(item.pid).catch(() => undefined);
      const state = await app.evaluate(({ app, BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]!;
        return { pid: win.webContents.getOSProcessId(), visible: win.isVisible(), focused: win.isFocused(),
          offscreen: win.webContents.isOffscreen(), painting: win.webContents.isOffscreen() ? win.webContents.isPainting() : null,
          frameRate: win.webContents.isOffscreen() ? win.webContents.getFrameRate() : null,
          backgroundThrottling: win.webContents.getBackgroundThrottling(),
          paintFrames: (globalThis as typeof globalThis & { __p0NativePaintFrames?: number }).__p0NativePaintFrames ?? 0,
          mockIpcCalls: (globalThis as typeof globalThis & { __p0IpcCalls?: { updateStatus: number; referenceStatus: number; preparedAcknowledgements: number; rejected: number } }).__p0IpcCalls,
          idleInput: (globalThis as typeof globalThis & { __p0IdleInput?: { blocked: boolean; mouseEvents: number; keyboardEvents: number } }).__p0IdleInput,
          network: (globalThis as typeof globalThis & { __p0NetworkCounters?: { blockedExternalAttempts: number; successfulExternalConnections: number } }).__p0NetworkCounters,
          gpuFeatureStatus: app.getGPUFeatureStatus() };
      });
      await remember(state.pid);
      return { pid: state.pid, method: "Electron BrowserWindow.webContents.getOSProcessId", surfaceState: state };
    };
    const versions = await app.evaluate(() => process.versions);
    const metadata = { mode, raster, args, surface, preload: preloadIdentity, productMainLoaded: false,
      catalogUpgrade: { mode: process.env.P0_MEMORY_CATALOG_POLL === "1" ? "controlled-running-empty-ids" : "complete-empty-ids", transport: "Playwright route fulfillment only; never reaches server" },
      offscreenCpuBitmapDelivery: surface === "offscreen", useSharedTexture: false,
      nativeWindowSurface: surface !== "offscreen", visibleWindowValidation: surface === "native-windowed", surfaceLimitation: surface === "offscreen" ? "Offscreen changes the compositor output path and cannot stand in for native visible-window validation" : surface === "native-windowed" ? "Visible isolated test window only; actual visibility and focus are required in every sample" : "Hidden native window; actual aura drawing must be verified",
      executablePath, versions, hiddenWindow: surface !== "native-windowed", backgroundThrottling: false, isolatedProfile: root };
    await writeFile(join(output, "launch-metadata.json"), JSON.stringify(metadata, null, 2));
    return { page, context, cdp, renderer, metadata,
      async setInputBlocked(blocked: boolean) {
        await setPageInputBlocked(page, blocked);
        await app.evaluate((_electron, blocked) => {
          const state = (globalThis as typeof globalThis & { __p0IdleInput: { blocked: boolean } }).__p0IdleInput;
          state.blocked = blocked;
        }, blocked);
      },
      async close() {
        if (stopped) return; stopped = true;
        try { await app.close(); await reportShutdown(); } finally { await cleanTemporaryRoot(); }
      } };
    } catch (error) { try { await app.close(); } finally { await cleanTemporaryRoot(); } throw error; }
  }
  if (mode !== "chrome") { await cleanTemporaryRoot(); throw new Error(`Unknown memory target: ${mode}`); }
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome", headless: process.env.P0_MEMORY_HEADED !== "1",
      args: [...gpuArgs, "--disable-background-timer-throttling", "--disable-renderer-backgrounding"], downloadsPath: root });
  } catch (error) { await cleanTemporaryRoot(); throw error; }
  try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 1000 }, serviceWorkers: "block", extraHTTPHeaders: { "x-supercanvas-desktop-token": token } });
  const page: Page = await context.newPage();
  await installIdleInputGuard(page);
  const cdp = await context.newCDPSession(page);
  const browserCdp = await browser.newBrowserCDPSession();
  let mapping: Awaited<ReturnType<typeof mapChromeRenderer>> | null = null;
  let sequence = 0;
  let needsMapping = true;
  page.on("framenavigated", frame => { if (frame === page.mainFrame()) needsMapping = true; });
  const renderer = async () => {
    if (!mapping || needsMapping) {
      mapping = await mapChromeRenderer(page, browserCdp, output, sequence++); needsMapping = false;
      for (const item of mapping.processInfo) if (!owned.has(item.id)) await remember(item.id).catch(() => undefined);
    }
    return { pid: mapping.pid, method: mapping.method };
  };
  return { page, context, cdp, renderer, metadata: { mode, raster, args: gpuArgs, surface: "chrome", version: browser.version(), hiddenWindow: process.env.P0_MEMORY_HEADED !== "1", backgroundThrottling: false, isolatedProfile: "Playwright fresh browser profile" },
    async setInputBlocked(blocked: boolean) { await setPageInputBlocked(page, blocked); },
    async close() {
      if (stopped) return; stopped = true;
      try { await browser.close(); await reportShutdown(); } finally { await cleanTemporaryRoot(); }
    } };
  } catch (error) { try { await browser.close(); } finally { await cleanTemporaryRoot(); } throw error; }
}
