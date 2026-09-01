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
