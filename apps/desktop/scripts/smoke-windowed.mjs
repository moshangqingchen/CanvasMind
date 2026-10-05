import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { captureRenderedHome } from "./smoke-rendering.mjs";

const execFileAsync = promisify(execFile);

async function backendIdentity(application) {
  // Playwright's launched process can be a Windows wrapper; query Electron's
  // actual main process before identifying its own backend child.
  const mainPid = await application.evaluate(() => process.pid);
  assert.ok(Number.isSafeInteger(mainPid) && mainPid > 0);
  // Read process identity only. CommandLine could contain authentication data.
  const command = `$children = @(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${mainPid}' | Select-Object Name, ProcessId, CreationDate); ConvertTo-Json -InputObject $children -Compress`;
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 15000 });
  const parsed = JSON.parse(stdout);
  const children = Array.isArray(parsed) ? parsed : [parsed];
  const backends = children.filter(child => child.Name.toLowerCase() === "node.exe");
  assert.equal(backends.length, 1, `the isolated Electron main ${mainPid} must own exactly one Node backend: ${JSON.stringify(children)}`);
  return { mainPid, ...backends[0] };
}

/** One lightweight normal-GPU startup/restart check, with no supplier requests. */
export async function runWindowedSmoke({ electron, executablePath, baseArgs, environment, desktop, packaged }) {
  const profileRoot = await mkdtemp(join(tmpdir(), "supercanvas-desktop-smoke-windowed-"));
  const output = join(desktop, "release");
  await mkdir(output, { recursive: true });
  const args = [...baseArgs, "--smoke-test", "--smoke-windowed", `--smoke-profile=${profileRoot}`];
  const report = { packaged, windowed: true, profileRoot, checks: [], rendererErrors: [] };
  let application;
  const launch = async phase => {
    application = await electron.launch({ executablePath, args, env: environment, timeout: 90000 });
    const page = await application.firstWindow();
    page.on("pageerror", error => report.rendererErrors.push({ phase, message: error.message }));
    const userData = await application.evaluate(({ app }) => app.getPath("userData"));
    assert.equal(userData, join(profileRoot, "browser"), "normal-window smoke must use only its new isolated profile");
    return page;
  };
  const quit = async () => {
    const closed = application.waitForEvent("close", { timeout: 30000 });
    await application.evaluate(({ app }) => { app.quit(); });
    await closed;
    application = undefined;
  };
  try {
    const first = await launch("first-start");
    await first.getByRole("button", { name: "从空白开始" }).waitFor({ state: "visible", timeout: 15000 });
    await first.getByRole("button", { name: "从空白开始" }).click();
    await first.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/, { timeout: 90000 });
    const fixtureProject = await first.evaluate(async () => {
      const response = await fetch("/api/projects", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "普通窗口恢复验收画布" }),
      });
      if (!response.ok) throw new Error(`Cannot create the isolated empty test project: ${response.status}`);
      return (await response.json()).project;
    });
    await first.reload();
    report.firstStart = await captureRenderedHome(application, first,
      join(output, "smoke-windowed-home-first.png"), join(output, "smoke-windowed-home-first-capture.png"), { windowed: true });
    assert.ok(report.firstStart.projects.api.some(project => project.id === fixtureProject.id));
    report.checks.push("normal GPU, visible window, no offscreen rendering and nonempty homepage paint");
    await quit();

    const reopened = await launch("restart");
    await reopened.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/, { timeout: 90000 });
    report.restart = await captureRenderedHome(application, reopened,
      join(output, "smoke-windowed-home-restart.png"), join(output, "smoke-windowed-home-restart-capture.png"), { windowed: true });
    assert.deepEqual(report.restart.projects, report.firstStart.projects, "restarted homepage must finish reading and rendering the same isolated projects");
    report.checks.push("existing isolated profile restarts into a visibly painted homepage");

    const origin = new URL(reopened.url()).origin;
    const runtimePort = await readFile(join(profileRoot, "runtime-port.json"), "utf8");
    const backendBefore = await backendIdentity(application);
    report.crashRecovery = await application.evaluate(async ({ BrowserWindow }, origin) => {
      const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL() === `${origin}/`);
      if (!window) throw new Error("Window to inject the isolated renderer crash was not found");
      const contents = window.webContents;
      const previousPid = contents.getOSProcessId();
      return new Promise((resolve, reject) => {
        let crashed = false;
        const cleanup = () => {
          clearTimeout(timeout);
          contents.removeListener("render-process-gone", gone);
          contents.removeListener("did-finish-load", loaded);
        };
        const gone = () => { crashed = true; };
        const loaded = () => {
          const rendererPid = contents.getOSProcessId();
          if (!crashed || !rendererPid || rendererPid === previousPid || contents.getURL() !== `${origin}/`) return;
          cleanup();
          resolve({ previousRendererPid: previousPid, recoveredRendererPid: rendererPid, origin });
        };
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("The isolated renderer did not recover its homepage after forcefullyCrashRenderer"));
        }, 60000);
        contents.on("render-process-gone", gone);
        contents.on("did-finish-load", loaded);
        contents.forcefullyCrashRenderer();
      });
    }, origin);
    // The original Playwright Page stays marked crashed after native recovery.
    report.recoveredPaint = await captureRenderedHome(application, null,
      join(output, "smoke-windowed-home-recovered.png"), join(output, "smoke-windowed-home-recovered-capture.png"), { windowed: true, url: `${origin}/` });
    assert.deepEqual(report.recoveredPaint.projects, report.restart.projects, "recovered homepage must finish reading and rendering the same isolated projects");
    const backendAfter = await backendIdentity(application);
    assert.deepEqual(backendAfter, backendBefore, "renderer recovery must not restart the backend");
    const recovered = await application.evaluate(async ({ BrowserWindow }, origin) => {
      const contents = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === `${origin}/`)?.webContents;
      if (!contents) throw new Error("Recovered window no longer uses the original runtime origin");
      return { origin: new URL(contents.getURL()).origin, health: await contents.executeJavaScript("fetch('/api/health').then(response => response.status)") };
    }, origin);
    assert.equal(recovered.origin, origin, "renderer recovery must keep the same runtime origin");
    assert.equal(await readFile(join(profileRoot, "runtime-port.json"), "utf8"), runtimePort, "renderer recovery must not reallocate the runtime port");
    assert.equal(await application.evaluate(({ app }) => app.getPath("userData")), join(profileRoot, "browser"));
    assert.equal(recovered.health, 200);
    report.crashRecovery.backendBefore = backendBefore;
    report.crashRecovery.backendAfter = backendAfter;
    report.checks.push("forced renderer crash repaints the homepage with a new renderer PID and unchanged backend PID, profile and runtime port");
    assert.equal(report.rendererErrors.length, 0, JSON.stringify(report.rendererErrors));
    report.checks.push("no renderer exceptions on either normal-window startup");
    await quit();
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.error = error.stack;
    const page = await application?.firstWindow().catch(() => null);
    if (page && !page.isClosed()) await page.screenshot({ path: join(output, "smoke-windowed-failure.png") }).catch(() => {});
    throw error;
  } finally {
    if (application) await application.evaluate(({ app }) => app.exit(1)).catch(() => {});
    await writeFile(join(output, "smoke-windowed-report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
}
