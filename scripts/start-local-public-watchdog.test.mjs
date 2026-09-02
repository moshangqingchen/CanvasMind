import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scriptUrl = new URL("./start-local-public-watchdog.ps1", import.meta.url);

test("watchdog probes the local health endpoint and starts the active release", async () => {
  const source = await readFile(scriptUrl, "utf8");

  assert.match(source, /127\.0\.0\.1:3210\/api\/health/u);
  assert.match(source, /active-release\.txt/u);
  assert.match(source, /start-local-public-managed\\\.ps1/u);
  assert.match(source, /Start-Process/u);
  assert.match(source, /Find-ManagerProcess/u);
  assert.match(source, /launchAge/u);
  assert.match(source, /-File `"\$manager`"/u);
});

test("watchdog guards against duplicate instances and stale managers", async () => {
  const source = await readFile(scriptUrl, "utf8");

  assert.match(source, /SuperCanvasWeb3210Watchdog/u);
  assert.match(source, /StaleHeartbeatSeconds/u);
  assert.match(source, /StartupGraceSeconds/u);
  assert.match(source, /RestartCooldownSeconds/u);
  assert.match(source, /Stop-ProcessTree/u);
});

test("watchdog registration falls back to a user startup shortcut", async () => {
  const registrationUrl = new URL("./register-local-public-watchdog.ps1", import.meta.url);
  const source = await readFile(registrationUrl, "utf8");

  assert.match(source, /WScript\.Shell/u);
  assert.match(source, /Startup/u);
  assert.match(source, /Register-ScheduledTask/u);
});
