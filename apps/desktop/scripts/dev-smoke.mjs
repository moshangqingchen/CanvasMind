import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, dirname, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const desktop = resolve(fileURLToPath(new URL("../", import.meta.url)));
const desktopRequire = createRequire(join(desktop, "package.json"));
const rendererRequire = createRequire(join(desktop, "renderer/package.json"));
const { _electron } = rendererRequire("@playwright/test");
const reportPath = join(desktop, "release/dev-smoke-report.json");
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, "{}");
const environment = { ...process.env, SUPERCANVAS_DEV_NODE: process.execPath, SUPERCANVAS_DESKTOP_SMOKE_REPORT: reportPath, ELECTRON_ENABLE_LOGGING: "0" };
delete environment.ELECTRON_RUN_AS_NODE;
const application = await _electron.launch({ executablePath: desktopRequire("electron"), args: [desktop, "--desktop-dev", "--smoke-test", "--disable-gpu"], env: environment, timeout: 90000 });
let closed = false;
try {
  const page = await application.firstWindow();
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/, { timeout: 180000 });
  await page.getByRole("heading", { name: "我的画布", exact: true }).waitFor({ timeout: 60000 });
  const origin = new URL(page.url()).origin;
  const profileRoot = dirname(await application.evaluate(({ app }) => app.getPath("userData")));
  assert.match(profileRoot, /supercanvas-desktop-smoke-/);
  assert.equal((await fetch(`${origin}/api/health`)).status, 401);
  assert.equal(await page.evaluate(async () => (await fetch("/api/health")).status), 200);
  assert.equal(await page.evaluate(async () => (await fetch("/api/desktop/lifecycle")).status), 200, "the forked Next dev server must inherit its lifecycle/authentication hook");
  await page.evaluate(() => new Promise((resolve, reject) => {
    const socket = new WebSocket(`${location.origin.replace("http:", "ws:")}/_next/hmr?id=desktop-dev-smoke`);
    const timeout = setTimeout(() => { socket.close(); reject(new Error("HMR websocket did not connect")); }, 10000);
    socket.onopen = () => { clearTimeout(timeout); socket.close(); resolve(true); };
    socket.onerror = () => { clearTimeout(timeout); reject(new Error("HMR websocket authentication failed")); };
  }));
  let diagnostic = {};
  for (let i = 0; i < 50; i++) {
    diagnostic = JSON.parse(await readFile(reportPath, "utf8"));
    if (diagnostic.childPids?.length === 7) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(diagnostic.childPids?.length, 7, "one Next CLI and six shared-package watchers must be owned by Electron");
  const closedEvent = application.waitForEvent("close", { timeout: 30000 });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closedEvent;
  closed = true;
  for (const pid of diagnostic.childPids) assert.throws(() => process.kill(pid, 0), `owned process ${pid} remained alive after closing the development window`);
  await assert.rejects(fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) }), "Next's forked HTTP worker must release the port on shutdown");
  const checks = ["isolated persistent smoke profile", "HTTP session authentication", "forked server lifecycle hook", "authenticated HMR websocket", "six shared package watchers", "close-window cleanup of owned processes and HTTP worker"];
  await writeFile(reportPath, JSON.stringify({ passed: true, profileRoot, checks }, null, 2));
  console.log(`Development smoke passed (${checks.length} checks). Report: ${reportPath}`);
} finally {
  if (!closed) await application.close();
}
