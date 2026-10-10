import { app, BrowserWindow, Menu, Tray, ipcMain, dialog, shell, safeStorage, nativeImage } from "electron";
import electronUpdater from "electron-updater";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { appendFile, mkdir, readFile, writeFile, readdir, access } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { APP_ID, TOKEN_HEADER, UPDATE_INTERVAL, backendEnvironment, isAppUrl, externalUrl, liveWindowContents, windowRequestHeaders } from "./policy.mjs";
import { developmentCommands, stopOwnedChild } from "./development.mjs";
import { discoverSource, initializeProfile, loadProfile } from "./data.mjs";
import { DesktopUpdater } from "./updater.mjs";
import { createUpdateDiagnostics } from "./update-diagnostics.mjs";
import { configureUpdates } from "./update-config.mjs";
import { ReferenceChannel } from "./reference-channel.mjs";
import { exitWaitPresentation } from "./exit-policy.mjs";
import { DesktopRendererRecovery, rendererLoadFailure } from "./renderer-recovery.mjs";

app.setAppUserModelId(APP_ID);
const smoke = process.argv.includes("--smoke-test");
const smokeWindowed = smoke && process.argv.includes("--smoke-windowed");
const development = !app.isPackaged && process.argv.includes("--desktop-dev");
function smokeRoot() {
  const supplied = process.argv.find((arg) => arg.startsWith("--smoke-profile="))?.slice("--smoke-profile=".length);
  if (!supplied) return mkdtempSync(join(tmpdir(), "supercanvas-desktop-smoke-"));
  const canonical = realpathSync(supplied);
  if (dirname(canonical).toLowerCase() !== realpathSync(tmpdir()).toLowerCase() || !basename(canonical).startsWith("supercanvas-desktop-smoke-")) throw new Error("Smoke tests can only reuse an isolated temporary profile");
  return resolve(supplied);
}
const dataRoot = smoke ? smokeRoot() : development
  ? join(process.env.LOCALAPPDATA || app.getPath("appData"), "SuperCanvasDesktopDevelopment")
  : process.env.SUPERCANVAS_DESKTOP_TEST_ROOT && !app.isPackaged
  ? process.env.SUPERCANVAS_DESKTOP_TEST_ROOT : join(process.env.LOCALAPPDATA || app.getPath("appData"), "SuperCanvasDesktop");
app.setPath("userData", join(dataRoot, "browser"));
const locked = app.requestSingleInstanceLock();
// A rejected instance must exit before Chromium initializes and commits a
// separate encryption key into the owning instance's shared Local State.
if (!locked) app.exit(0);
let window, tray, backend, origin, token, secrets, updater, rendererRecovery;
let referenceChannel, configuringReference = false;
let starting = false, quitting = false, intentionalStop = false, waitingExit = false, applyUpdate = false;
let exitTimer, updateTimer;
let exitEpoch = 0;
const developmentWatchers = new Set();
const stopDevelopmentWatchers = async () => {
  const children = [...developmentWatchers];
  developmentWatchers.clear();
  await Promise.all(children.map(stopOwnedChild));
};
const preparations = new Map();
const startupPath = join(__dirname, "startup.html");
const logRoot = join(dataRoot, "logs");
const logPath = join(logRoot, "desktop.log");
const send = (channel, value) => {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed() && !window.webContents.isCrashed()) window.webContents.send(channel, value);
};
const show = () => { if ((!smoke || smokeWindowed) && !quitting && window && !window.isDestroyed()) { window.show(); window.focus(); } };
function redact(text) {
  let value = String(text).replace(/(bearer\s+|(?:api[-_]?key|token|secret|password|MASTER_KEY)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]");
  value = value.replace(/(https?:\/\/)[^@\s/]+@/gi, "$1[redacted]@");
  if (token) value = value.replaceAll(token, "[redacted]");
  if (secrets?.masterKey) value = value.replaceAll(secrets.masterKey, "[redacted]");
  return value;
}
async function log(message) {
  await mkdir(logRoot, { recursive: true });
  await appendFile(logPath, `${new Date().toISOString()} ${redact(message)}\n`).catch(() => {});
}
const state = (phase, message, detail) => send("desktop:state", { phase, message, detail });
const trusted = (event) => event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame &&
  (event.senderFrame.url === pathToFileURL(startupPath).href || isAppUrl(event.senderFrame.url, origin));
function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trusted(event)) throw new Error("拒绝未知窗口请求");
    return callback(...args);
  });
}
async function protect(text) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows 密钥保护不可用，未保存任何明文凭据");
  return safeStorage.encryptString(text);
}
async function unprotect(bytes) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows 密钥保护不可用");
  return safeStorage.decryptString(bytes);
}
async function startupScreen() {
  await rendererRecovery.loadStartup();
  show();
}
async function freePort() {
  const reserve = (preferred) => new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(preferred, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
  // Preserve the browser origin across restarts for drafts and preferences,
  // while still choosing a free port if another process occupies the old one.
  try {
    const { port } = JSON.parse(await readFile(join(dataRoot, "runtime-port.json"), "utf8"));
    if (Number.isInteger(port) && port >= 1024 && port < 65536) return await reserve(port);
  } catch {}
  return reserve(0);
}
async function runtimeRequest(path, body) {
  if (!origin || !backend) throw new Error("本地服务尚未就绪");
  const response = await fetch(`${origin}${path}`, { method: body ? "POST" : "GET", headers: { [TOKEN_HEADER]: token, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`本地服务返回 ${response.status}`);
  return response.json();
}

async function start() {
  if (starting || quitting || waitingExit) return;
  if (backend) return rendererRecovery.load({ manual: true });
  starting = true;
  let runtimeReady = false;
  try {
    await startupScreen();
    if (quitting || window.isDestroyed()) return;
    state("loading", "正在读取本机资料…");
    secrets = await loadProfile(dataRoot, unprotect);
    if (!secrets && development) secrets = await initializeProfile(dataRoot, { encrypt: protect });
    if (quitting || window.isDestroyed()) return;
    if (!secrets) { state("setup", "欢迎使用 Windows 桌面版", "迁移会复制画布、素材、历史和 API 配置，保留旧版资料。迁移前请关闭旧版服务及其守护程序。"); return; }
    referenceChannel ??= new ReferenceChannel({ root: dataRoot, protect, unprotect, onState: value => send("desktop:reference-channel", value) });
    await referenceChannel.load();
    if (quitting || window.isDestroyed()) return;
    state("loading", "正在启动画布服务…");
    const runtime = app.isPackaged ? join(process.resourcesPath, "runtime") : join(__dirname, "../stage");
    token = randomBytes(32).toString("hex");
    const port = await freePort();
    if (quitting || window.isDestroyed()) return;
    origin = `http://127.0.0.1:${port}`;
    intentionalStop = false;
    const hook = app.isPackaged ? join(runtime, "runtime-hook.cjs") : join(__dirname, "runtime-hook.cjs");
    const environment = { ...backendEnvironment(process.env, dataRoot, port, token, secrets), ...(smoke || development ? { SUPPLIER_AUTO_VERIFY: "off" } : {}) };
    environment.SUPERCANVAS_CLI_EXAMPLES_ROOT = development
      ? resolve(__dirname, "../../../packages/providers/examples")
      : join(runtime, "server/packages/providers/examples");
    let command = { executable: join(runtime, "node.exe"), args: ["--require", hook, join(runtime, "server/apps/desktop/renderer/server.js")], cwd: join(dataRoot, "profile") };
    if (development) {
      environment.NODE_ENV = "development";
      environment.SUPERCANVAS_DESKTOP_DEV = "true";
      const commands = developmentCommands(resolve(__dirname, "../../.."), process.env.SUPERCANVAS_DEV_NODE || "", hook, port);
      command = commands.server;
      if (!developmentWatchers.size) for (const watched of commands.watchers) {
        const watcher = spawn(watched.executable, watched.args, { cwd: watched.cwd, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
        developmentWatchers.add(watcher);
        watcher.on("exit", () => developmentWatchers.delete(watcher));
        watcher.on("error", (error) => void log(`shared package watcher: ${error.message}`));
        for (const stream of [watcher.stdout, watcher.stderr]) stream.on("data", (chunk) => { process.stdout.write(redact(chunk)); void log(chunk.toString()); });
      }
    }
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: environment,
    });
    backend = child;
    let launchError;
    child.on("error", (error) => { launchError = error; });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { if (development) process.stdout.write(redact(chunk)); void log(chunk.toString()); });
    child.on("exit", (code) => {
      if (backend === child) backend = undefined;
      void referenceChannel?.stop().catch(() => {});
      void log(`backend exited: ${code}`);
      if (!intentionalStop && !starting && !quitting) {
        ++exitEpoch;
        clearInterval(exitTimer); waitingExit = false;
        void rendererRecovery.error("本地服务已停止", "你的资料仍保存在本机。重试后会检查未完成任务，不会自动重复付费提交。");
      }
    });
    const deadline = Date.now() + 90000;
    let ready = false;
    while (Date.now() < deadline) {
      if (quitting || window.isDestroyed()) return;
      if (launchError) throw launchError;
      if (child.exitCode !== null || child.signalCode) throw new Error("本地服务启动失败，请查看日志");
      try { ready = (await runtimeRequest("/api/health")).ok === true; } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!ready) throw new Error("本地服务启动超时，请查看日志后重试");
    await runtimeRequest("/api/desktop/lifecycle", { draining: false });
    runtimeReady = true;
    if (quitting || window.isDestroyed()) return;
    if (!smoke) await referenceChannel.start({ origin, desktopToken: token, secret: secrets.masterKey });
    if (quitting || window.isDestroyed()) return;
    await writeFile(join(dataRoot, "runtime-port.json"), JSON.stringify({ port }));
    if (quitting || window.isDestroyed()) return;
    await rendererRecovery.load();
    if (quitting) return;
    void updater.action("check").catch((error) => void log(error.message));
  } catch (error) {
    // A failed renderer navigation must not stop a healthy runtime or its tasks.
    if (!runtimeReady) {
      intentionalStop = true;
      if (backend) { if (development) await stopOwnedChild(backend); else backend.kill(); backend = undefined; }
      if (development) await stopDevelopmentWatchers();
    }
    await log(error.message);
    await rendererRecovery.error("无法启动超级画布", redact(error.message));
  } finally { starting = false; void rendererRecovery.resume(); }
}
function createMainWindow(bounds = {}) {
  const created = new BrowserWindow({ title: "超级画布", width: 1440, height: 960, ...bounds, minWidth: 980, minHeight: 680, show: false,
    backgroundColor: "#101114", icon: join(__dirname, "icon.png"),
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, offscreen: smoke && !smokeWindowed } });
  created.webContents.on("render-process-gone", (_event, details) => {
    if (created !== window) return;
    for (const prepared of [...preparations.values()]) prepared("界面进程已停止，已取消本次退出；恢复界面后请重新确认");
    void rendererRecovery.rendererGone(details).catch(error => void log(error.message));
  });
  created.webContents.on("did-navigate", (_event, url) => { if (created === window) rendererRecovery.rememberPage(url); });
  created.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => { if (created === window && isMainFrame) rendererRecovery.rememberPage(url); });
  created.on("unresponsive", () => { void log("renderer unresponsive").catch(() => {}); });
  created.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    const message = rendererLoadFailure(errorCode, errorDescription, validatedURL, isMainFrame);
    if (message) void log(message).catch(() => {});
  });
  created.removeMenu();
  created.on("close", (event) => { if (!quitting) { event.preventDefault(); if (development) void requestExit(); else created.hide(); } });
  const openExternal = (url) => { const safe = externalUrl(url); if (safe) void shell.openExternal(safe); };
  created.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
  created.webContents.on("will-navigate", (event, url) => { if (!isAppUrl(url, origin)) { event.preventDefault(); openExternal(url); } });
  created.webContents.on("will-redirect", (event, url) => { if (!isAppUrl(url, origin)) { event.preventDefault(); openExternal(url); } });
  created.webContents.on("will-attach-webview", (event) => event.preventDefault());
  return created;
}
function recoverCrashedSetupWindow() {
  if (quitting || backend || !window || window.isDestroyed()) return;
  const previous = window;
  if (!previous.webContents.isCrashed() || previous.webContents.getURL() !== pathToFileURL(startupPath).href) return;
  const maximized = previous.isMaximized(), fullscreen = previous.isFullScreen(), minimized = previous.isMinimized();
  const bounds = maximized || fullscreen ? previous.getNormalBounds() : previous.getBounds();
  const zoom = previous.webContents.getZoomFactor();
  window = createMainWindow(bounds);
  window.webContents.setZoomFactor(zoom);
  if (maximized) window.maximize();
  if (fullscreen) window.setFullScreen(true);
  if (minimized) window.minimize();
  previous.destroy();
  void log("replaced crashed setup window; profile and backend unchanged").catch(() => {});
}

async function prepareRenderer() {
  // A lost renderer has no live edits to acknowledge. The backend lifecycle
  // check below still owns active generations and in-flight writes.
  if (window.webContents.isDestroyed() || window.webContents.isCrashed() || rendererRecovery?.isRecovering) return;
  if (!isAppUrl(window.webContents.getURL(), origin)) return;
  const id = randomUUID();
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { preparations.delete(id); reject(new Error("保存画布超时，请返回软件检查保存状态")); }, 30000);
    preparations.set(id, (error) => { clearTimeout(timeout); preparations.delete(id); error ? reject(new Error(error)) : resolve(); });
    send("desktop:prepare-exit", id);
  });
}
async function cancelExit() {
  const epoch = ++exitEpoch;
  clearInterval(exitTimer); waitingExit = false;
  try {
    if (backend) await runtimeRequest("/api/desktop/lifecycle", { draining: false });
  } finally {
    if (epoch === exitEpoch && !quitting) {
      send("desktop:draining", false);
      if (applyUpdate) updater.patch({ phase: "ready" });
      applyUpdate = false;
      show();
      void rendererRecovery.resume();
    }
  }
}
async function finishExit() {
  if (!waitingExit || quitting) return;
  const epoch = exitEpoch;
  clearInterval(exitTimer); clearInterval(updateTimer);
  await runtimeRequest("/api/desktop/lifecycle");
  if (epoch !== exitEpoch) return;
  quitting = true; intentionalStop = true;
  rendererRecovery.stop();
  await referenceChannel?.stop();
  if (window && !window.isDestroyed()) window.destroy();
  const child = backend;
  if (development) {
    await stopOwnedChild(child);
    await stopDevelopmentWatchers();
  } else if (child) {
    await new Promise((resolve) => {
      const timeout = setTimeout(() => { child.kill(); resolve(); }, 5000);
      child.once("exit", () => { clearTimeout(timeout); resolve(); });
      child.send({ type: "shutdown" });
    });
  }
  if (applyUpdate) { updater.patch({ phase: "applying" }); electronUpdater.autoUpdater.quitAndInstall(false, true); }
  else app.quit();
}
async function requestExit(install = false) {
  if (waitingExit || quitting) return;
  if (!backend) {
    quitting = true; applyUpdate = install;
    clearInterval(exitTimer); clearInterval(updateTimer);
    rendererRecovery?.stop();
    await stopDevelopmentWatchers();
    // A stopped local service has nothing left to drain, but a downloaded
    // upgrade still needs the installer rather than an ordinary app quit.
    if (install) {
      updater.patch({ phase: "applying" });
      electronUpdater.autoUpdater.quitAndInstall(false, true);
    } else app.quit();
    return;
  }
  waitingExit = true; applyUpdate = install;
  const epoch = ++exitEpoch;
  send("desktop:draining", true);
  try {
    await prepareRenderer();
    if (epoch !== exitEpoch) return;
    const current = await runtimeRequest("/api/desktop/lifecycle", { draining: true });
    if (epoch !== exitEpoch) {
      if (!waitingExit && !quitting) await runtimeRequest("/api/desktop/lifecycle", { draining: false });
      return;
    }
    if (current.activeRuns || current.activeWrites) {
      const result = await dialog.showMessageBox(window, { type: "question", ...exitWaitPresentation(current, install),
        buttons: ["完成后继续", "返回软件"], defaultId: 0, cancelId: 1 });
      if (epoch !== exitEpoch) return;
      if (result.response === 1) { await cancelExit(); return; }
      if (install) updater.patch({ phase: "waiting_for_idle" });
      let checking = false;
      exitTimer = setInterval(async () => {
        if (checking) return; checking = true;
        try {
          const value = await runtimeRequest("/api/desktop/lifecycle");
          if (epoch !== exitEpoch) return;
          if (!value.activeRuns && !value.activeWrites) await finishExit();
        } catch (error) {
          if (epoch !== exitEpoch || quitting) return;
          const cancelledEpoch = exitEpoch + 1;
          await cancelExit().catch(() => {});
          if (cancelledEpoch !== exitEpoch || quitting) return;
          await dialog.showMessageBox(window, { type: "error", message: "未能安全退出", detail: redact(error.message) });
        }
        finally { checking = false; }
      }, 1500);
    } else await finishExit();
  } catch (error) {
    if (epoch !== exitEpoch || quitting) return;
    const cancelledEpoch = exitEpoch + 1;
    await cancelExit().catch(() => {});
    if (cancelledEpoch !== exitEpoch || quitting) return;
    await dialog.showMessageBox(window, { type: "error", message: "未退出：请先处理保存或任务状态", detail: redact(error.message) });
  }
}

if (locked) {
  if (development) {
    process.on("message", (message) => { if (message?.type === "desktop-dev:stop") void requestExit(); });
    process.on("disconnect", () => void requestExit());
  }
  app.on("second-instance", show);
  app.on("before-quit", (event) => { if (!quitting) { event.preventDefault(); void requestExit(); } });
  app.on("window-all-closed", () => {});
  app.on("child-process-gone", (_event, details) => {
    void log(`child process gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`).catch(() => {});
  });
  app.whenReady().then(async () => {
    await mkdir(logRoot, { recursive: true });
    if (process.platform === "win32" && app.isPackaged && !smoke) {
      // Keep existing desktop shortcuts on a stable ICO when the EXE is replaced.
      const icon = join(process.resourcesPath, "app-icon.ico");
      try {
        await access(icon);
        const desktop = app.getPath("desktop");
        for (const name of await readdir(desktop)) {
          if (!name.toLowerCase().endsWith(".lnk")) continue;
          try {
            const path = join(desktop, name);
            const link = shell.readShortcutLink(path);
            if (resolve(link.target).toLowerCase() === resolve(process.execPath).toLowerCase() && link.icon !== icon)
              shell.writeShortcutLink(path, "update", { ...link, icon, iconIndex: 0 });
          } catch { /* Unrelated or unreadable shortcuts remain untouched. */ }
        }
      } catch { /* Icon repair must not block application startup. */ }
    }
    window = createMainWindow();
    rendererRecovery = new DesktopRendererRecovery({
      context: () => ({ window, origin, backend, starting, quitting, waitingExit }), startupPath, state, show, log,
      nativeError: (message, detail) => dialog.showErrorBox(message, redact(detail)),
      prepareErrorWindow: recoverCrashedSetupWindow,
    });
    const session = window.webContents.session;
    const clipboardWriteAllowed = (contents, permission) => Boolean(contents && !contents.isDestroyed() && contents.id === liveWindowContents(window)?.id && isAppUrl(contents.getURL(), origin) && ["clipboard-sanitized-write", "clipboard-write"].includes(permission));
    session.setPermissionRequestHandler((contents, permission, callback) => callback(clipboardWriteAllowed(contents, permission)));
    session.setPermissionCheckHandler((contents, permission) => clipboardWriteAllowed(contents, permission));
    session.webRequest.onBeforeSendHeaders((details, callback) => {
      callback({ requestHeaders: windowRequestHeaders(details, window, origin, development, token) });
    });
    session.on("will-download", (_event, item) => {
      if (smoke) item.setSavePath(join(dataRoot, item.getFilename()));
      else item.setSaveDialogOptions({ title: "保存超级画布文件" });
    });
    tray = new Tray(nativeImage.createFromPath(join(__dirname, "icon.png")));
    tray.setToolTip("超级画布 · 关闭窗口后继续运行");
    tray.on("double-click", show);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "打开超级画布", click: show },
      { label: "检查更新", click: () => { show(); send("desktop:open-update"); void updater.action("check").catch((error) => dialog.showMessageBox(window, { message: error.message })); } },
      { label: "打开资料目录", click: () => void shell.openPath(join(dataRoot, "profile")) },
      { label: "打开日志", click: () => void shell.openPath(logRoot) },
      { type: "separator" }, { label: "退出", click: () => void requestExit() },
    ]));
    const currentNotes = await readFile(join(__dirname, "release-notes.md"), "utf8").catch(() => "");
    let updateConfigurationError;
    if (app.isPackaged && !smoke) try {
      await configureUpdates(electronUpdater.autoUpdater, process.resourcesPath, dataRoot);
    } catch (error) { updateConfigurationError = error; await log(error.message); }
    updater = new DesktopUpdater(electronUpdater.autoUpdater, app.getVersion(), { packaged: app.isPackaged && !smoke,
      currentNotes, diagnostic: createUpdateDiagnostics(logRoot), changed: (value) => send("desktop:update-changed", value), apply: () => requestExit(true) });
    if (updateConfigurationError) updater.fail(updateConfigurationError);
    handle("desktop:update-status", () => updater.snapshot());
    handle("desktop:update-action", (action) => updater.action(action));
    handle("desktop:open-logs", () => shell.openPath(logRoot));
    handle("desktop:retry", () => start());
    handle("desktop:cancel-exit", cancelExit);
    handle("desktop:reference-status", () => referenceChannel?.snapshot() ?? { enabled: false, baseUrl: "", tokenConfigured: false, phase: "disabled", message: "本机资料尚未初始化", port: 3210 });
    handle("desktop:reference-save", async input => {
      if (!referenceChannel || !backend || waitingExit || configuringReference) throw new Error("请等待当前操作完成后重试");
      configuringReference = true;
      try {
        const activity = await runtimeRequest("/api/desktop/lifecycle");
        if (activity.activeRuns) throw new Error("请等待当前生成完成后再修改素材通道");
        return await referenceChannel.configure(input);
      }
      finally { configuringReference = false; }
    });
    handle("desktop:initialize", async (mode) => {
      if (!["fresh", "migrate"].includes(mode)) throw new Error("无效的初始化操作");
      if (starting || backend) throw new Error("服务已经启动");
      starting = true;
      let initialized = false;
      try {
        let source;
        if (mode === "migrate") {
          const choice = await dialog.showOpenDialog(window, { title: "选择旧项目根目录或旧版安装目录", properties: ["openDirectory"] });
          if (choice.canceled) { state("setup", "选择如何开始使用超级画布"); return; }
          source = await discoverSource(choice.filePaths[0]);
        }
        state("loading", source ? "正在复制并校验旧版资料…" : "正在创建本机资料库…", "请保持窗口打开。旧版资料不会被修改。");
        await initializeProfile(dataRoot, { source, encrypt: protect });
        initialized = true;
      } finally {
        starting = false;
        // Successful initialization hands recovery to start(); cancelled or
        // failed initialization must release any crash recovery waiting here.
        if (!initialized) void rendererRecovery.resume();
      }
      await start();
    });
    ipcMain.on("desktop:prepared", (event, value) => {
      if (trusted(event) && typeof value?.id === "string") preparations.get(value.id)?.(typeof value.error === "string" ? value.error.slice(0, 1000) : undefined);
    });
    updateTimer = setInterval(() => void updater.action("check").catch((error) => void log(error.message)), UPDATE_INTERVAL);
    await start();
    // Explicit opt-in smoke harness writes no credentials and never migrates real data.
    if (!app.isPackaged && process.env.SUPERCANVAS_DESKTOP_SMOKE_REPORT) {
      await writeFile(process.env.SUPERCANVAS_DESKTOP_SMOKE_REPORT, JSON.stringify({ window: !window.isDestroyed(), setup: !secrets, origin: origin || null,
        ...(development ? { development: true, childPids: [backend?.pid, ...[...developmentWatchers].map((child) => child.pid)].filter(Boolean) } : {}) }));
    }
  }).catch(async (error) => { await log(error.message); if (development) { await stopOwnedChild(backend); await stopDevelopmentWatchers(); } dialog.showErrorBox("超级画布无法启动", redact(error.message)); quitting = true; app.quit(); });
}
