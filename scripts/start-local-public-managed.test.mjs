import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scriptUrl = new URL("./start-local-public-managed.ps1", import.meta.url);

function getFunctionSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  assert.ok(start >= 0, `missing function marker: ${startMarker}`);
  assert.ok(end > start, `missing function boundary: ${endMarker}`);
  return source.slice(start, end);
}

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

test("managed deployment keeps Git source sync separate from packaged releases", async () => {
  const source = await readFile(scriptUrl, "utf8");
  const sync = getFunctionSection(
    source,
    "function Invoke-RemoteSourceSync",
    "function Set-ActiveReleaseRoot",
  );
  const check = getFunctionSection(
    source,
    "function Invoke-ReleaseCheck",
    "function Invoke-ReleaseDownload",
  );

  assert.match(source, /gitCommand -C \$workspace/u);
  assert.match(sync, /ls-remote/u);
  assert.match(sync, /pull", "--ff-only", "origin"/u);
  assert.match(sync, /blocked_dirty/u);
  assert.match(sync, /Test-GitSourceDeployment/u);
  assert.match(sync, /Packaged release has no \.git metadata/u);

  const tokenBranch = check.indexOf("if ($config.Token)");
  const packagedBranch = check.indexOf(
    "elseif (-not (Test-GitSourceDeployment))",
  );
  const sourceBranch = check.indexOf(
    "GitHub Release API check skipped for Git source",
  );
  assert.ok(tokenBranch >= 0, "token Release branch should exist");
  assert.ok(packagedBranch > tokenBranch, "packaged branch should follow token branch");
  assert.ok(sourceBranch > packagedBranch, "Git source skip branch should be last");
  assert.match(
    check.slice(packagedBranch, sourceBranch),
    /Get-GitHubReleaseCandidate -Config \$config -CurrentVersion \$currentVersion/u,
  );
  assert.match(check, /GitHub Release API check skipped for Git source/u);
});

test("managed deployment uses REST releases and falls back to the Atom feed", async () => {
  const source = await readFile(scriptUrl, "utf8");
  const rest = getFunctionSection(
    source,
    "function Get-ReleaseCandidateFromRest",
    "function Get-ReleaseCandidateFromAtom",
  );
  const atom = getFunctionSection(
    source,
    "function Get-ReleaseCandidateFromAtom",
    "function Get-GitHubReleaseCandidate",
  );
  const resolver = getFunctionSection(
    source,
    "function Get-GitHubReleaseCandidate",
    "function Invoke-ReleaseCheck",
  );

  assert.match(
    rest,
    /https:\/\/api\.github\.com\/repos\/\$\(\$Config\.Repository\)\/releases\?per_page=30/u,
  );
  assert.match(rest, /Invoke-RestMethod/u);
  assert.match(atom, /https:\/\/github\.com\/\$\(\$Config\.Repository\)\/releases\.atom/u);
  assert.match(atom, /\[xml\]\$content/u);
  assert.match(atom, /releases\/download\/\$tag/u);
  assert.match(atom, /super-canvas-v\$version-windows-x64\.zip/u);
  assert.match(atom, /super-canvas-v\$version-release-manifest\.json/u);

  const restCall = resolver.indexOf("Get-ReleaseCandidateFromRest");
  const atomCall = resolver.indexOf("Get-ReleaseCandidateFromAtom");
  assert.ok(restCall >= 0, "REST lookup should be attempted");
  assert.ok(atomCall > restCall, "Atom lookup should be a REST fallback");
  assert.match(resolver, /trying releases\.atom/u);
  assert.match(resolver, /GitHub Release 查询失败.*REST.*Atom/u);
});

test("managed deployment converts Git transport failures into status errors", async () => {
  const source = await readFile(scriptUrl, "utf8");
  const git = getFunctionSection(
    source,
    "function Invoke-GitCommand",
    "function Get-GitSourceInfo",
  );
  const check = getFunctionSection(
    source,
    "function Invoke-ReleaseCheck",
    "function Invoke-ReleaseDownload",
  );

  assert.match(git, /try\s*\{[\s\S]*& \$gitCommand -C \$workspace/u);
  assert.match(
    git,
    /catch\s*\{[\s\S]*ExitCode = 1[\s\S]*Git 命令执行失败/u,
  );
  const tryStart = check.indexOf("try {");
  const syncCall = check.indexOf("$source = Invoke-RemoteSourceSync");
  assert.ok(tryStart >= 0 && syncCall > tryStart, "Git sync must be guarded by release-check try/catch");
  assert.match(
    check,
    /catch\s*\{[\s\S]*\$sourcePatch\.phase = "failed"[\s\S]*Write-UpdateStatus \$sourcePatch/u,
  );
});
