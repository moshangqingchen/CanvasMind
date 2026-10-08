import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, stat, symlink, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { createUpdateDiagnostics } from "../src/update-diagnostics.mjs";

async function temporaryDirectory(t) {
  const root = await mkdtemp(join(tmpdir(), "supercanvas-update-diagnostics-"));
  t.after(async () => {
    const path = resolve(root);
    assert.equal(dirname(path).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert.ok(basename(path).startsWith("supercanvas-update-diagnostics-"));
    await rm(path, { recursive: true, force: true });
  });
  return root;
}

async function records(root) {
  return (await readFile(join(root, "update-diagnostics.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
}

test("diagnostics retain only approved structure, never URLs, credentials, paths or raw errors", async (t) => {
  const root = join(await temporaryDirectory(t), "logs");
  const sink = createUpdateDiagnostics(root);
  const secret = "PRIVATE_DIAGNOSTIC_SENTINEL";
  const record = {
    event: "fallback", phase: "downloading", mode: "full", stage: "download", category: "network", code: "ECONNRESET",
    currentVersion: "0.2.64", targetVersion: "0.2.68", statusCode: 503, retryable: true,
    timestamp: secret, schemaVersion: secret, message: secret, stack: secret,
    url: `https://user:${secret}@example.invalid/download?signature=${secret}`,
    headers: { Authorization: `Bearer ${secret}`, "X-API-Key": secret },
    proxy: `http://user:${secret}@example.invalid`, path: `C:\\Users\\${secret}\\profile`,
  };
  assert.equal(await sink(record), true);
  const text = await readFile(join(root, "update-diagnostics.jsonl"), "utf8");
  assert.ok(!text.includes(secret));
  const [saved] = await records(root);
  assert.deepEqual(Object.keys(saved).sort(), ["schemaVersion", "timestamp", "event", "phase", "mode", "stage", "category", "code", "currentVersion", "targetVersion", "statusCode", "retryable"].sort());
  assert.equal(saved.schemaVersion, 1);
  assert.ok(Number.isFinite(Date.parse(saved.timestamp)));
  for (const key of ["event", "phase", "mode", "stage", "category", "code", "currentVersion", "targetVersion", "statusCode", "retryable"]) assert.equal(saved[key], record[key]);
});

test("unapproved records and disguised secrets are rejected without coercion or getters", async (t) => {
  const root = join(await temporaryDirectory(t), "logs");
  const sink = createUpdateDiagnostics(root);
  let getterCalls = 0;
  const invalid = { get event() { getterCalls++; return "error"; } };
  assert.equal(await sink(invalid), false);
  assert.equal(await sink({ event: "unknown-event", message: "PRIVATE_VALUE" }), false);
  assert.equal(await sink(new Error("PRIVATE_VALUE")), false);
  assert.equal(await sink(null), false);
  assert.equal(await sink(new Proxy({}, { getPrototypeOf() { throw new Error("PRIVATE_VALUE"); } })), false);
  assert.equal(getterCalls, 0);
  assert.equal(await sink({
    event: "error", phase: "PRIVATE_VALUE", mode: "PRIVATE_VALUE", stage: "PRIVATE_VALUE", category: "PRIVATE_VALUE", code: "PRIVATE_VALUE",
    currentVersion: "0.2.68+PRIVATE_VALUE", targetVersion: "0.2.68-PRIVATE_VALUE", statusCode: "503", retryable: "true",
    get message() { getterCalls++; throw new Error("PRIVATE_VALUE"); },
  }), true);
  const [saved] = await records(root);
  assert.deepEqual(Object.keys(saved).sort(), ["schemaVersion", "timestamp", "event"].sort());
  assert.equal(getterCalls, 0);
});

test("all approved observer failure codes survive the independent diagnostics boundary", async (t) => {
  const root = join(await temporaryDirectory(t), "logs");
  const sink = createUpdateDiagnostics(root);
  const approved = [
    "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "EPIPE",
    "ENOENT", "EACCES", "EPERM", "EBUSY", "ENOSPC", "EIO", "ERR_ABORTED", "ERR_CONNECTION_RESET",
    "ERR_CONNECTION_REFUSED", "ERR_CONNECTION_CLOSED", "ERR_INTERNET_DISCONNECTED", "ERR_NETWORK_CHANGED",
    "ERR_NAME_NOT_RESOLVED", "ERR_TIMED_OUT", "ERR_CONNECTION_TIMED_OUT", "ERR_PROXY_CONNECTION_FAILED",
    "ERR_TUNNEL_CONNECTION_FAILED", "ERR_HTTP_RESPONSE_CODE_FAILURE", "ERR_INVALID_URL",
    "ERR_UPDATER_CHECKSUM_MISMATCH", "ERR_UPDATER_INVALID_SIGNATURE", "ERR_UPDATER_INVALID_RELEASE_FEED",
    "ERR_UPDATER_LATEST_VERSION_NOT_FOUND", "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND", "ERR_UPDATER_NO_PUBLISHED_VERSIONS",
    "ERR_UPDATER_INVALID_PROVIDER_CONFIGURATION", "ERR_UPDATER_INVALID_UPDATE_INFO", "ERR_UPDATER_WEB_INSTALLER_DISABLED",
    "ERR_UPDATER_UNSUPPORTED_PROVIDER", "ERR_CHECKSUM_MISMATCH", "SHA512_MISMATCH", "CHECKSUM_MISMATCH", "DIGEST_MISMATCH",
  ];
  assert.equal(approved.length, 41);
  for (const code of approved) assert.equal(await sink({ event: "error", code }), true);
  for (const code of ["ERR_UNKNOWN_PRIVATE_TOKEN", "EACCES private-key", "ERR_PROXY_CONNECTION_FAILED\nBearer private-key"]) {
    assert.equal(await sink({ event: "error", code }), true);
  }
  const saved = await records(root);
  assert.deepEqual(saved.slice(0, approved.length).map((record) => record.code), approved);
  assert.ok(saved.slice(approved.length).every((record) => !Object.hasOwn(record, "code")));
  assert.ok(!(await readFile(join(root, "update-diagnostics.jsonl"), "utf8")).includes("private-key"));
});

test("queued writes snapshot approved fields and preserve order under concurrent calls", async (t) => {
  const root = join(await temporaryDirectory(t), "logs");
  const sink = createUpdateDiagnostics(root);
  const first = { event: "download-start", mode: "preparing", targetVersion: "0.2.68" };
  const firstWrite = sink(first);
  first.event = "error"; first.targetVersion = "PRIVATE_VALUE";
  const writes = Array.from({ length: 40 }, (_, index) => sink({ event: "download-mode", mode: "differential", targetVersion: `0.2.${index}` }));
  assert.ok((await Promise.all([firstWrite, ...writes])).every(Boolean));
  const saved = await records(root);
  assert.equal(saved[0].event, "download-start");
  assert.equal(saved[0].targetVersion, "0.2.68");
  assert.deepEqual(saved.slice(1).map((record) => record.targetVersion), Array.from({ length: 40 }, (_, index) => `0.2.${index}`));
});

test("rotation bounds both fixed files and leaves desktop logs and unrelated files intact", async (t) => {
  const root = join(await temporaryDirectory(t), "logs");
  await mkdir(root);
  await writeFile(join(root, "desktop.log"), "untouched desktop log");
  await writeFile(join(root, "unrelated.jsonl"), "untouched unrelated file");
  const sink = createUpdateDiagnostics(root);
  const padding = `${" ".repeat(256 * 1024 - 2)}\n`;
  await writeFile(join(root, "update-diagnostics.jsonl"), padding);
  await writeFile(join(root, "update-diagnostics.previous.jsonl"), "old previous");
  assert.equal(await sink({ event: "check-start", stage: "check" }), true);
  assert.equal(await readFile(join(root, "update-diagnostics.previous.jsonl"), "utf8"), padding);
  await writeFile(join(root, "update-diagnostics.jsonl"), " ".repeat(256 * 1024 + 1));
  await writeFile(join(root, "update-diagnostics.previous.jsonl"), " ".repeat(256 * 1024 + 1));
  assert.equal(await sink({ event: "check-complete", stage: "check" }), true);
  assert.ok((await stat(join(root, "update-diagnostics.jsonl"))).size <= 256 * 1024);
  assert.ok(!(await readdir(root)).includes("update-diagnostics.previous.jsonl"));
  assert.equal(await readFile(join(root, "desktop.log"), "utf8"), "untouched desktop log");
  assert.equal(await readFile(join(root, "unrelated.jsonl"), "utf8"), "untouched unrelated file");
  assert.equal((await records(root))[0].event, "check-complete");
});

test("diagnostics failures resolve safely and do not poison subsequent writes", async (t) => {
  const temporary = await temporaryDirectory(t);
  const root = join(temporary, "logs");
  await writeFile(root, "blocked destination");
  const sink = createUpdateDiagnostics(root);
  assert.equal(await sink({ event: "error", category: "cache", code: "EACCES" }), false);
  assert.equal(await readFile(root, "utf8"), "blocked destination");
  await rm(root);
  assert.equal(await sink({ event: "download-complete", mode: "cached" }), true);
  assert.equal((await records(root))[0].event, "download-complete");
  assert.equal(await createUpdateDiagnostics(undefined)({ event: "error" }), false);
});

test("bounded queues drop excess diagnostic records while successful records remain valid", async (t) => {
  const root = join(await temporaryDirectory(t), "logs");
  const sink = createUpdateDiagnostics(root);
  const outcomes = await Promise.all(Array.from({ length: 200 }, () => sink({ event: "download-mode", mode: "full" })));
  assert.equal(outcomes.filter(Boolean).length, 128);
  assert.equal((await records(root)).length, 128);
});

test("junctions cannot redirect diagnostics or create directories outside the log directory", async (t) => {
  const temporary = await temporaryDirectory(t);
  const outside = join(temporary, "outside");
  await mkdir(outside);
  const sentinel = join(outside, "sentinel.jsonl");
  await writeFile(sentinel, "private sentinel");
  const linkedRoot = join(temporary, "linked-logs");
  try { await symlink(outside, linkedRoot, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (error.code === "EPERM" || error.code === "EACCES") { t.skip("Temporary links unavailable"); return; } throw error; }
  assert.equal(await createUpdateDiagnostics(join(linkedRoot, "nested"))({ event: "check-start" }), false);
  assert.deepEqual(await readdir(outside), ["sentinel.jsonl"]);
  assert.equal(await readFile(sentinel, "utf8"), "private sentinel");
});

test("symbolic log files cannot redirect writes or rotation outside the log directory", async (t) => {
  const temporary = await temporaryDirectory(t);
  const sentinel = join(temporary, "sentinel.jsonl");
  await writeFile(sentinel, "private sentinel");
  const root = join(temporary, "logs");
  await mkdir(root);
  try { await symlink(sentinel, join(root, "update-diagnostics.jsonl"), "file"); }
  catch (error) { if (error.code === "EPERM" || error.code === "EACCES") { t.skip("Temporary file links unavailable"); return; } throw error; }
  assert.equal(await createUpdateDiagnostics(root)({ event: "error", category: "unknown" }), false);
  assert.equal(await readFile(sentinel, "utf8"), "private sentinel");
});

test("hard links and directories at reserved filenames are never overwritten or deleted", async (t) => {
  const temporary = await temporaryDirectory(t);
  const root = join(temporary, "logs");
  await mkdir(root);
  const sentinel = join(temporary, "sentinel.jsonl");
  await writeFile(sentinel, "private sentinel");
  await link(sentinel, join(root, "update-diagnostics.previous.jsonl"));
  const sink = createUpdateDiagnostics(root);
  assert.equal(await sink({ event: "check-start" }), false);
  assert.equal(await readFile(sentinel, "utf8"), "private sentinel");
  await rm(join(root, "update-diagnostics.previous.jsonl"));
  await mkdir(join(root, "update-diagnostics.previous.jsonl"));
  assert.equal(await sink({ event: "check-start" }), false);
  assert.ok((await stat(join(root, "update-diagnostics.previous.jsonl"))).isDirectory());
});
