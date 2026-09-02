import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scriptUrl = new URL("./start-local-public-managed.ps1", import.meta.url);

test("managed deployment logs do not contaminate typed function results", async () => {
  const source = await readFile(scriptUrl, "utf8");
  const logger = /function Write-ManagerLog \{(?<body>[\s\S]*?)\n\}/u.exec(
    source,
  )?.groups?.body;

  assert.ok(logger, "Write-ManagerLog should exist");
  assert.doesNotMatch(logger, /\bWrite-Output\b/u);
  assert.match(logger, /\[void\]\[Console\]::WriteLine\(\$line\)/u);
});

test("managed deployment accepts only one explicit true build result", async () => {
  const source = await readFile(scriptUrl, "utf8");

  assert.match(source, /\$initialBuildOutcome\.Count -eq 1/u);
  assert.match(source, /\$initialBuildOutcome\[0\] -is \[bool\]/u);
  assert.match(source, /\$buildOutcome\.Count -eq 1/u);
  assert.match(source, /\$buildOutcome\[0\] -is \[bool\]/u);
});

test("managed deployment writes status without a UTF-8 BOM and emits heartbeats", async () => {
  const source = await readFile(scriptUrl, "utf8");

  assert.match(source, /UTF8Encoding\]::new\(\$false\)/u);
  assert.match(source, /WriteAllText\(\$temporaryPath,[\s\S]*\$utf8NoBom\)/u);
  assert.match(source, /managerHeartbeatAt/u);
  assert.match(source, /Write-ManagerHeartbeat/u);
  assert.match(source, /phase = "starting"/u);
});

test("managed deployment refreshes installed watchdog scripts after applying a release", async () => {
  const source = await readFile(scriptUrl, "utf8");

  assert.match(source, /candidateWatchdog/u);
  assert.match(source, /installedWatchdog/u);
  assert.match(source, /candidateRegistrar/u);
  assert.match(source, /installedRegistrar/u);
});

test("managed deployment follows remote Git without anonymous GitHub API calls", async () => {
  const source = await readFile(scriptUrl, "utf8");

  assert.match(source, /gitCommand -C \$workspace/u);
  assert.match(source, /ls-remote/u);
  assert.match(source, /pull", "--ff-only", "origin"/u);
  assert.match(source, /blocked_dirty/u);
  assert.match(source, /GitHub Release API check skipped/u);
  assert.match(source, /if \(\$config\.Token\)/u);
});
