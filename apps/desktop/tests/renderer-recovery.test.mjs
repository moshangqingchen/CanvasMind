import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DesktopRendererRecovery, rendererLoadFailure } from "../src/renderer-recovery.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function fixture(options = {}) {
  const calls = { urls: [], files: [], states: [], native: [], logs: [], shows: 0, stops: 0 };
  const backend = { pid: 42 };
  const context = { origin: "http://127.0.0.1:43210", backend, starting: false, waitingExit: false, quitting: false,
    window: { isDestroyed: () => false,
      loadURL: async url => { calls.urls.push(url); },
      loadFile: async path => { calls.files.push(path); },
      webContents: { stop: () => { calls.stops++; } },
    } };
  const recovery = new DesktopRendererRecovery({ context: () => context, startupPath: "startup.html",
    state: (...value) => calls.states.push(value), show: () => { calls.shows++; }, log: value => calls.logs.push(value),
    nativeError: (...value) => calls.native.push(value), ...options });
  return { recovery, context, calls, backend };
}
const crash = { reason: "crashed", exitCode: -1073741819 };

test("crash recovery restores only a trusted app path and keeps the same backend", async () => {
  const { recovery, context, calls, backend } = fixture();
  recovery.rememberPage(`${context.origin}/canvas/fixture?token=secret#private`);
  recovery.rememberPage("https://untrusted.example/elsewhere");
  await recovery.rendererGone(crash);
  assert.deepEqual(calls.urls, [`${context.origin}/canvas/fixture`]);
  assert.equal(context.backend, backend);
  assert.equal(calls.files.length, 0);
  assert.equal(calls.shows, 1);
  assert.ok(calls.logs.some(value => value.includes("reason=crashed exitCode=-1073741819")));
});

test("repeated crashes use a bounded budget even when each reload resolves successfully", async () => {
  const { recovery, calls } = fixture();
  await recovery.rendererGone(crash);
  await recovery.rendererGone(crash);
  await recovery.rendererGone(crash);
  assert.equal(calls.urls.length, 2);
  assert.deepEqual(calls.files, ["startup.html"]);
  assert.match(calls.states[0][1], /连续停止/);
  await recovery.rendererGone(crash);
  await recovery.rendererGone(crash);
  assert.equal(calls.urls.length, 2);
  assert.equal(calls.files.length, 1);
  assert.equal(calls.native.length, 1);
});

test("failed automatic reloads show the startup error and a manual retry reuses the existing backend", async () => {
  const { recovery, context, calls, backend } = fixture();
  let failing = true;
  context.window.loadURL = async url => { calls.urls.push(url); if (failing) throw new Error("ERR_CONNECTION_RESET"); };
  await recovery.rendererGone(crash);
  assert.equal(calls.urls.length, 2);
  assert.deepEqual(calls.files, ["startup.html"]);
  assert.equal(calls.states[0][0], "error");
  failing = false;
  await recovery.load({ manual: true });
  assert.equal(calls.urls.length, 3);
  assert.equal(context.backend, backend);
  assert.equal(recovery.isRecovering, false);
});

test("slow failed reloads cannot age out the fixed recovery budget and loop forever", async () => {
  let now = 0;
  const { recovery, context, calls } = fixture({ now: () => now });
  context.window.loadURL = async url => {
    calls.urls.push(url);
    now += 30_000;
    if (calls.urls.length > 3) context.quitting = true;
    throw new Error("navigation timed out");
  };
  await recovery.rendererGone(crash);
  assert.equal(calls.urls.length, 2);
  assert.deepEqual(calls.files, ["startup.html"]);
});

test("an initial navigation crash cannot race startup into a second automatic navigation", async () => {
  const { recovery, context, calls, backend } = fixture();
  context.starting = true;
  const entered = deferred(), release = deferred();
  context.window.loadURL = async url => { calls.urls.push(url); entered.resolve(); await release.promise; };
  const navigation = recovery.load();
  await entered.promise;
  void recovery.rendererGone(crash);
  release.resolve();
  await navigation;
  context.starting = false;
  await recovery.resume();
  assert.equal(calls.urls.length, 1);
  assert.deepEqual(calls.files, ["startup.html"]);
  assert.equal(context.backend, backend);
});

test("crashes during startup or a cancelled exit wait until their owner releases the window", async () => {
  for (const blocked of ["starting", "waitingExit"]) {
    const { recovery, context, calls } = fixture();
    context[blocked] = true;
    await recovery.rendererGone(crash);
    assert.equal(calls.urls.length, 0);
    context[blocked] = false;
    await recovery.resume();
    assert.equal(calls.urls.length, 1);
  }
});

test("quit during navigation does not reopen the window or show recovery errors", async () => {
  const { recovery, context, calls } = fixture();
  const entered = deferred(), release = deferred();
  context.window.loadURL = async url => { calls.urls.push(url); entered.resolve(); await release.promise; throw new Error("window destroyed"); };
  const operation = recovery.rendererGone(crash);
  await entered.promise;
  context.quitting = true;
  recovery.stop();
  release.resolve();
  await operation;
  await recovery.rendererGone({ reason: "clean-exit", exitCode: 0 });
  assert.equal(calls.urls.length, 1);
  assert.equal(calls.shows, 0);
  assert.deepEqual(calls.files, []);
  assert.deepEqual(calls.native, []);
});

test("a failed error page falls back to one native error without exposing URL secrets", async () => {
  const { recovery, context, calls } = fixture();
  context.window.loadURL = async () => { throw new Error("failed https://name:pass@example.com/canvas?token=secret#private"); };
  context.window.loadFile = async () => { throw new Error("missing startup page"); };
  await recovery.load();
  await recovery.rendererGone(crash);
  assert.equal(calls.native.length, 1);
  assert.match(calls.native[0][1], /https:\/\/example\.com\/canvas/);
  assert.doesNotMatch(JSON.stringify(calls), /name:pass|token=secret|#private/);
});

test("stalled navigation is stopped and produces an actionable error page", async () => {
  const { recovery, context, calls } = fixture({ navigationTimeoutMs: 10 });
  context.window.loadURL = () => new Promise(() => {});
  await recovery.load();
  assert.equal(calls.stops, 1);
  assert.deepEqual(calls.files, ["startup.html"]);
  assert.match(calls.states[0][2], /界面加载超时/);
});

test("only main-frame failures are logged and no URL query, fragment or credentials survive", () => {
  assert.equal(rendererLoadFailure(-2, "ERR_FAILED", "https://example.com/frame?token=secret", false), null);
  const diagnostic = rendererLoadFailure(-2, "ERR_FAILED https://name:pass@example.com/a?signature=secret", "https://name:pass@example.com/a?token=secret#private", true);
  assert.match(diagnostic, /main-frame load failed: -2/);
  assert.doesNotMatch(diagnostic, /name:pass|signature|token|secret|private/);
});

const mainSource = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
const functionSource = (name, next) => mainSource.slice(mainSource.indexOf(`async function ${name}(`), mainSource.indexOf(`\nasync function ${next}(`));
const backendExitSource = mainSource.slice(mainSource.indexOf('    child.on("exit", (code) => {'), mainSource.indexOf("    const deadline = Date.now()"));
const initializeSource = mainSource.slice(mainSource.indexOf('    handle("desktop:initialize",'), mainSource.indexOf('    ipcMain.on("desktop:prepared",'));

function setupWindowFixture() {
  const calls = { gone: 0, prepared: 0, external: [], loads: [], states: [] };
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.bounds = { x: 90, y: 70, width: 1100, height: 760 }; this.normal = { ...this.bounds }; this.maximized = true; this.fullscreen = false; this.minimized = false; this.destroyed = false;
      this.webContents = Object.assign(new EventEmitter(), { crashed: false, url: "", zoom: 1.25,
        isCrashed() { return this.crashed; }, getURL() { return this.url; }, getZoomFactor() { return this.zoom; }, setZoomFactor(value) { this.zoom = value; },
        setWindowOpenHandler(handler) { this.open = handler; },
      });
    }
    isDestroyed() { return this.destroyed; } isMaximized() { return this.maximized; } isFullScreen() { return this.fullscreen; } isMinimized() { return this.minimized; }
    getBounds() { return this.bounds; } getNormalBounds() { return this.normal; }
    maximize() { this.maximized = true; } setFullScreen(value) { this.fullscreen = value; } minimize() { this.minimized = true; }
    destroy() { this.destroyed = true; this.webContents.emit("render-process-gone", {}, crash); } removeMenu() {} hide() { this.hidden = true; }
  }
  const context = { Window, BrowserWindow: Window, window: new Window({}), quitting: false, backend: undefined, startupPath: "fixture/startup.html", __dirname: "fixture", join, pathToFileURL,
    smoke: true, smokeWindowed: true, development: false, preparations: new Map([["test", () => { calls.prepared++; }]]),
    origin: "http://127.0.0.1:43210", log: async () => {}, requestExit: async () => {}, rendererLoadFailure,
    rendererRecovery: { rendererGone: async () => { calls.gone++; }, rememberPage() {} },
    isAppUrl: (url, origin) => url.startsWith(origin + "/"), externalUrl: url => url.startsWith("https://") ? url : null,
    shell: { openExternal: async url => { calls.external.push(url); } },
  };
  context.window.webContents.crashed = true;
  context.window.webContents.url = pathToFileURL(context.startupPath).href;
  const helpers = mainSource.slice(mainSource.indexOf("function createMainWindow("), mainSource.indexOf("\nasync function prepareRenderer("));
  vm.runInNewContext(helpers, context);
  return { context, calls };
}

test("a crashed setup gets a new secured window with its geometry and zoom while stale events are ignored", async () => {
  const { context, calls } = setupWindowFixture();
  const previous = context.window;
  context.recoverCrashedSetupWindow();
  const current = context.window;
  assert.notEqual(current, previous);
  assert.equal(previous.destroyed, true);
  assert.equal(calls.gone, 0, "destroying the retired window must not create a recovery for the current one");
  assert.equal(calls.prepared, 0);
  assert.equal(current.options.x, previous.normal.x);
  assert.equal(current.options.width, previous.normal.width);
  assert.equal(current.maximized, true);
  assert.equal(current.webContents.zoom, previous.webContents.zoom);
  assert.equal(current.options.webPreferences.sandbox, true);
  assert.equal(current.options.webPreferences.contextIsolation, true);
  assert.equal(current.options.webPreferences.nodeIntegration, false);
  assert.equal(current.options.webPreferences.preload, join("fixture", "preload.cjs"));
  assert.equal(current.webContents.open({ url: "https://example.com/" }).action, "deny");
  let blocked = 0;
  current.webContents.emit("will-navigate", { preventDefault() { blocked++; } }, "file:///outside.html");
  current.webContents.emit("will-redirect", { preventDefault() { blocked++; } }, "https://example.com/redirect");
  current.webContents.emit("will-attach-webview", { preventDefault() { blocked++; } });
  assert.equal(blocked, 3);
  assert.deepEqual(calls.external, ["https://example.com/", "https://example.com/redirect"]);
  const retired = current;
  retired.webContents.crashed = true;
  retired.webContents.url = pathToFileURL(context.startupPath).href;
  context.recoverCrashedSetupWindow();
  retired.webContents.emit("render-process-gone", {}, crash);
  assert.equal(calls.gone, 0);
  let closePrevented = false;
  context.window.emit("close", { preventDefault() { closePrevented = true; } });
  assert.equal(closePrevented, true);
  assert.equal(context.window.hidden, true);
});

test("setup recreation never replaces a healthy window, an unknown file, a live backend or a quitting app", () => {
  for (const reason of ["healthy", "unknown-file", "backend", "quitting"]) {
    const { context } = setupWindowFixture();
    const previous = context.window;
    if (reason === "healthy") previous.webContents.crashed = false;
    if (reason === "unknown-file") previous.webContents.url += "?nonce=unknown";
    if (reason === "backend") context.backend = { pid: 42 };
    if (reason === "quitting") context.quitting = true;
    context.recoverCrashedSetupWindow();
    assert.equal(context.window, previous);
    assert.equal(previous.destroyed, false);
  }
});

test("startup after successful initialization prepares a crashed setup before bounded file navigation", async () => {
  const { recovery, context, calls } = fixture();
  context.window.loadFile = async () => { throw new Error("retired renderer must not be reused"); };
  recovery.prepareErrorWindow = () => { context.window = { isDestroyed: () => false, loadFile: async path => { calls.files.push(path); } }; };
  Object.assign(context, { rendererRecovery: recovery, show: () => { calls.shows++; } });
  await vm.runInNewContext(functionSource("startupScreen", "freePort") + "; startupScreen()", context);
  assert.deepEqual(calls.files, ["startup.html"]);
  assert.equal(calls.shows, 1);
});

test("manual setup retry clears the old fallback so another setup crash can recover", async () => {
  const { recovery, context, calls } = fixture();
  context.origin = undefined; context.backend = undefined;
  await recovery.rendererGone(crash);
  assert.equal(recovery.fallback, true);
  recovery.nativeShown = true; recovery.attempts = [1, 2];
  await recovery.loadStartup();
  assert.equal(recovery.fallback, false);
  assert.equal(recovery.nativeShown, false);
  assert.deepEqual(recovery.attempts, []);
  await recovery.rendererGone(crash);
  assert.equal(calls.files.length, 3, "second setup crash must load its actionable error page again");
  assert.deepEqual(calls.native, []);
  assert.equal(calls.states.length, 2);
});

test("error navigation uses the replacement window and retains the requested error state", async () => {
  const { recovery, context, calls } = fixture();
  context.backend = undefined;
  context.window.loadFile = async () => { throw new Error("retired renderer must not be reused"); };
  recovery.prepareErrorWindow = () => { context.window = { isDestroyed: () => false, loadFile: async path => { calls.files.push(path); } }; };
  await recovery.rendererGone(crash);
  assert.deepEqual(calls.files, ["startup.html"]);
  assert.equal(calls.states[0][0], "error");
  assert.equal(calls.states[0][1], "界面进程已停止");
  assert.deepEqual(calls.native, []);
});

test("a renderer crash during a cancelled migration picker resumes after initialization releases the window", async () => {
  const { recovery, context, calls } = fixture();
  const picker = deferred(), entered = deferred();
  let initialized = 0, started = 0;
  Object.assign(context, { backend: undefined, origin: undefined, rendererRecovery: recovery,
    handle: (_channel, callback) => { context.initialize = callback; },
    dialog: { showOpenDialog: () => { entered.resolve(); return picker.promise; } },
    state: (...value) => calls.states.push(value), discoverSource: async () => "fixture-source",
    initializeProfile: async () => { initialized++; }, dataRoot: "fixture-profile", protect: async value => value,
    start: async () => { started++; },
  });
  vm.runInNewContext(initializeSource, context);
  const initialization = context.initialize("migrate");
  await entered.promise;
  await recovery.rendererGone(crash);
  assert.equal(context.starting, true);
  assert.equal(calls.files.length, 0);
  picker.resolve({ canceled: true });
  await initialization;
  await recovery.operation;
  assert.equal(context.starting, false);
  assert.deepEqual(calls.files, ["startup.html"], "cancelled initialization must recover the crashed page");
  assert.equal(recovery.pending, false);
  assert.deepEqual(calls.urls, []);
  assert.equal(initialized, 0);
  assert.equal(started, 0);
});

test("a renderer crash during failed initialization resumes while preserving the initialization error", async () => {
  const { recovery, context, calls } = fixture();
  const entered = deferred();
  let rejectInitialization, started = 0;
  const writing = new Promise((_resolve, reject) => { rejectInitialization = reject; });
  Object.assign(context, { backend: undefined, origin: undefined, rendererRecovery: recovery,
    handle: (_channel, callback) => { context.initialize = callback; },
    state: (...value) => calls.states.push(value),
    initializeProfile: () => { entered.resolve(); return writing; }, dataRoot: "fixture-profile", protect: async value => value,
    start: async () => { started++; },
  });
  vm.runInNewContext(initializeSource, context);
  const initialization = context.initialize("fresh");
  const rejection = assert.rejects(initialization, /fixture initialization failure/);
  await entered.promise;
  await recovery.rendererGone(crash);
  assert.equal(context.starting, true);
  assert.equal(calls.files.length, 0);
  rejectInitialization(new Error("fixture initialization failure"));
  await rejection;
  await recovery.operation;
  assert.equal(context.starting, false);
  assert.deepEqual(calls.files, ["startup.html"], "failed initialization must recover the crashed page");
  assert.equal(recovery.pending, false);
  assert.deepEqual(calls.urls, []);
  assert.equal(started, 0);
});

test("successful initialization hands a pending renderer recovery to backend startup without an early error page", async () => {
  const { recovery, context, calls, backend } = fixture();
  const entered = deferred(), writing = deferred();
  const origin = context.origin;
  Object.assign(context, { backend: undefined, origin: undefined, rendererRecovery: recovery,
    handle: (_channel, callback) => { context.initialize = callback; },
    state: (...value) => calls.states.push(value),
    initializeProfile: async () => { entered.resolve(); await writing.promise; }, dataRoot: "fixture-profile", protect: async value => value,
    start: async () => {
      assert.deepEqual(calls.files, [], "initialization must not race startup into a missing-backend error page");
      context.starting = true;
      context.backend = backend;
      context.origin = origin;
      await recovery.load();
      context.starting = false;
      await recovery.resume();
    },
  });
  vm.runInNewContext(initializeSource, context);
  const initialization = context.initialize("fresh");
  await entered.promise;
  await recovery.rendererGone(crash);
  writing.resolve();
  await initialization;
  await recovery.operation;
  assert.equal(context.starting, false);
  assert.deepEqual(calls.files, []);
  assert.deepEqual(calls.urls, [origin]);
  assert.equal(recovery.isRecovering, false);
});

for (const response of [0, 1]) {
  test(`a backend failure invalidates an open exit confirmation before response=${response}`, async () => {
    const confirmation = deferred(), entered = deferred();
    const calls = { timers: 0, cancellations: 0, dialogs: [], failures: [] };
    const child = { pid: 42, on: (event, callback) => { assert.equal(event, "exit"); context.backendExited = callback; } };
    const context = { waitingExit: false, quitting: false, backend: child, child, starting: false, intentionalStop: false,
      applyUpdate: false, exitEpoch: 0, exitTimer: undefined, window: {}, send() {}, prepareRenderer: async () => {},
      runtimeRequest: async () => ({ activeRuns: 0, activeWrites: 1 }), exitWaitPresentation: () => ({}),
      dialog: { showMessageBox: async (_window, value) => { calls.dialogs.push(value.type); entered.resolve(); return confirmation.promise; } },
      setInterval: () => { calls.timers++; return 1; }, clearInterval() {}, log: async () => {},
      referenceChannel: { stop: async () => {} }, rendererRecovery: { error: async message => { calls.failures.push(message); } },
      cancelExit: async () => { calls.cancellations++; }, finishExit: async () => {}, redact: value => value,
    };
    const requestExit = mainSource.slice(mainSource.indexOf("async function requestExit("), mainSource.indexOf("\nif (locked)"));
    vm.runInNewContext(backendExitSource + requestExit, context);
    const exit = context.requestExit();
    await entered.promise;
    const oldEpoch = context.exitEpoch;
    context.backendExited(1);
    assert.equal(context.backend, undefined);
    assert.equal(context.waitingExit, false);
    assert.deepEqual(calls.failures, ["本地服务已停止"]);
    confirmation.resolve({ response });
    await exit;
    assert.equal(calls.timers, 0, "a stopped backend must not reactivate the old exit poll");
    assert.equal(calls.cancellations, 0, "an obsolete confirmation must not cancel another exit");
    assert.deepEqual(calls.dialogs, ["question"]);
    assert.ok(context.exitEpoch > oldEpoch, "backend failure must invalidate pending exit work");
  });
}

test("main retry reloads a healthy backend without starting a second runtime", async () => {
  let loaded = 0;
  const backend = { pid: 42 };
  const context = { starting: false, quitting: false, waitingExit: false, backend,
    rendererRecovery: { load: async options => { assert.equal(options.manual, true); loaded++; } } };
  await vm.runInNewContext(functionSource("start", "prepareRenderer") + "; start()", context);
  assert.equal(loaded, 1);
  assert.equal(context.backend, backend);
});

test("a missing renderer needs no ACK but safe exit still checks backend lifecycle activity", async () => {
  let lifecycle = 0, dialogs = 0, cancelled = 0, finished = 0;
  const context = { waitingExit: false, quitting: false, backend: { pid: 42 }, applyUpdate: false, exitEpoch: 0,
    window: { webContents: { isDestroyed: () => false, isCrashed: () => true } },
    send() {}, runtimeRequest: async (path, body) => { assert.equal(path, "/api/desktop/lifecycle"); assert.equal(body.draining, true); lifecycle++; return { activeRuns: 1, activeWrites: 1 }; },
    exitWaitPresentation: () => ({}), dialog: { showMessageBox: async () => { dialogs++; return { response: 1 }; } },
    cancelExit: async () => { cancelled++; }, finishExit: async () => { finished++; },
  };
  const requestExit = mainSource.slice(mainSource.indexOf("async function requestExit("), mainSource.indexOf("\nif (locked)"));
  await vm.runInNewContext(functionSource("prepareRenderer", "cancelExit") + requestExit + "; requestExit()", context);
  assert.equal(lifecycle, 1);
  assert.equal(dialogs, 1);
  assert.equal(cancelled, 1);
  assert.equal(finished, 0);
});

test("a stale exit failure cannot cancel a newer exit or display its old error", async () => {
  for (const failureAt of ["initial", "poll"]) {
    let rejectOld, pollExit, requests = 0, cancellations = 0;
    const pending = new Promise((_, reject) => { rejectOld = reject; });
    const entered = deferred();
    const dialogs = [];
    const context = { waitingExit: false, quitting: false, backend: { pid: 42 }, applyUpdate: false, exitEpoch: 0,
      window: {}, send() {}, prepareRenderer: async () => {}, exitWaitPresentation: () => ({}),
      runtimeRequest: async () => {
        requests++;
        if (requests === (failureAt === "initial" ? 1 : 2)) { entered.resolve(); return pending; }
        return { activeRuns: 1, activeWrites: 1 };
      },
      dialog: { showMessageBox: async (_window, value) => { dialogs.push(value.type); return { response: 0 }; } },
      setInterval: callback => { pollExit = callback; return 1; }, clearInterval() {},
      cancelExit: async () => { cancellations++; context.exitEpoch++; context.waitingExit = false; },
      redact: value => value, finishExit: async () => {},
    };
    const requestExit = mainSource.slice(mainSource.indexOf("async function requestExit("), mainSource.indexOf("\nif (locked)"));
    vm.runInNewContext(requestExit, context);
    const first = context.requestExit();
    if (failureAt === "poll") await first;
    const oldPoll = failureAt === "poll" ? pollExit() : first;
    await entered.promise;
    await context.cancelExit();
    await context.requestExit();
    const newerEpoch = context.exitEpoch;
    rejectOld(new Error("obsolete lifecycle failure"));
    await oldPoll;
    assert.equal(context.exitEpoch, newerEpoch);
    assert.equal(context.waitingExit, true);
    assert.equal(cancellations, 1);
    assert.equal(dialogs.includes("error"), false);
  }
});

test("failed drain cancellation resumes a renderer crash while preserving the backend", async () => {
  const { recovery, context, calls, backend } = fixture();
  context.waitingExit = true;
  await recovery.rendererGone(crash);
  Object.assign(context, { exitEpoch: 1, exitTimer: 1, applyUpdate: false,
    clearInterval() {}, runtimeRequest: async () => { throw new Error("drain reset failed"); },
    send() {}, show: () => { calls.shows++; }, rendererRecovery: recovery,
  });
  vm.runInNewContext(functionSource("cancelExit", "finishExit"), context);
  await assert.rejects(context.cancelExit(), /drain reset failed/);
  await recovery.operation;
  assert.equal(context.waitingExit, false);
  assert.equal(context.backend, backend);
  assert.deepEqual(calls.urls, [context.origin]);
  assert.equal(recovery.isRecovering, false);
});

test("an old drain cancellation cannot reopen or clear a newer exit after its request settles", async () => {
  for (const outcome of ["resolve", "reject"]) {
    for (const supersededBy of ["new exit", "quit"]) {
      let release, reject;
      const pending = new Promise((resolve, fail) => { release = resolve; reject = fail; });
      const calls = [];
      const context = { waitingExit: true, quitting: false, exitEpoch: 1, exitTimer: 1,
        backend: { pid: 42 }, applyUpdate: true, clearInterval() {},
        runtimeRequest: () => pending, send: () => calls.push("send"),
        updater: { patch: () => calls.push("update") }, show: () => calls.push("show"),
        rendererRecovery: { resume: () => calls.push("resume") },
      };
      vm.runInNewContext(functionSource("cancelExit", "finishExit"), context);
      const cancellation = context.cancelExit();
      context.waitingExit = true;
      if (supersededBy === "new exit") context.exitEpoch++;
      else context.quitting = true;
      if (outcome === "resolve") { release(); await cancellation; }
      else { reject(new Error("old drain reset failed")); await assert.rejects(cancellation, /old drain reset failed/); }
      assert.deepEqual(calls, []);
      assert.equal(context.waitingExit, true);
      assert.equal(context.applyUpdate, true);
    }
  }
});

test("an old exit response only clears draining when no newer exit owns it", async () => {
  for (const newExit of [false, true]) {
    const response = deferred(), entered = deferred();
    let requests = 0, draining = false;
    const context = { waitingExit: false, quitting: false, exitEpoch: 0, exitTimer: undefined,
      backend: { pid: 42 }, applyUpdate: false, window: {}, send() {}, show() {},
      prepareRenderer: async () => {}, rendererRecovery: { resume() {} },
      clearInterval() {}, setInterval: () => 1, exitWaitPresentation: () => ({}),
      dialog: { showMessageBox: async () => ({ response: 0 }) },
      runtimeRequest: async (_path, body) => {
        if (++requests === 1) { entered.resolve(); await response.promise; }
        draining = body.draining;
        return { activeRuns: 1, activeWrites: 0 };
      }, finishExit: async () => {}, redact: value => value,
    };
    const requestExit = mainSource.slice(mainSource.indexOf("async function requestExit("), mainSource.indexOf("\nif (locked)"));
    vm.runInNewContext(functionSource("cancelExit", "finishExit") + requestExit, context);
    const oldExit = context.requestExit();
    await entered.promise;
    await context.cancelExit();
    if (newExit) await context.requestExit();
    const epoch = context.exitEpoch;
    response.resolve();
    await oldExit;
    assert.equal(draining, newExit);
    assert.equal(context.waitingExit, newExit);
    assert.equal(context.exitEpoch, epoch);
  }
});

test("an exit error awaiting cancellation cannot report or modify a newer exit", async () => {
  for (const failureAt of ["initial", "poll"]) {
    for (const outcome of ["resolve", "reject"]) {
      const entered = deferred();
      let release, reject, pollExit, exits = 0;
      const pending = new Promise((resolve, fail) => { release = resolve; reject = fail; });
      const calls = [];
      const context = { waitingExit: false, quitting: false, exitEpoch: 0, exitTimer: undefined,
        backend: { pid: 42 }, applyUpdate: false, window: {}, send() {},
        show: () => calls.push("show"), rendererRecovery: { resume: () => calls.push("resume") },
        prepareRenderer: async () => {}, clearInterval() {}, setInterval: callback => { pollExit = callback; return 1; },
        exitWaitPresentation: () => ({}), redact: value => value, finishExit: async () => {},
        dialog: { showMessageBox: async (_window, value) => { calls.push(value.type); return { response: 0 }; } },
        runtimeRequest: async (_path, body) => {
          if (body?.draining === false) { entered.resolve(); return pending; }
          if (!body || (++exits === 1 && failureAt === "initial")) throw new Error("old lifecycle failure");
          return { activeRuns: 1, activeWrites: 0 };
        },
      };
      const requestExit = mainSource.slice(mainSource.indexOf("async function requestExit("), mainSource.indexOf("\nif (locked)"));
      vm.runInNewContext(functionSource("cancelExit", "finishExit") + requestExit, context);
      const first = context.requestExit();
      if (failureAt === "poll") await first;
      const oldAttempt = failureAt === "poll" ? pollExit() : first;
      await entered.promise;
      await context.requestExit();
      const epoch = context.exitEpoch;
      if (outcome === "resolve") release();
      else reject(new Error("old cancel failed"));
      await oldAttempt;
      assert.equal(context.exitEpoch, epoch);
      assert.equal(context.waitingExit, true);
      assert.equal(calls.includes("error"), false);
      assert.equal(calls.includes("show"), false);
      assert.equal(calls.includes("resume"), false);
    }
  }
});
