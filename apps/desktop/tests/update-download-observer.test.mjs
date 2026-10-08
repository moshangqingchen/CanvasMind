import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { observeUpdateDownloads, updateFailureDiagnostic } from "../src/update-download-observer.mjs";
const require = createRequire(import.meta.url);
const { NsisUpdater } = require("electron-updater");

test("observers preserve original receiver, arguments, Promise identity and exception identity", async () => {
  const args = [{ requestHeaders: { synthetic: "test" }, cancellationToken: {} }, "owned-destination"];
  const promise = Promise.resolve(false);
  const rejected = Promise.reject(new Error("original rejection"));
  const syncError = new Error("original sync exception");
  const executor = { download(...received) { assert.equal(this, executor); assert.deepEqual(received, args); return rejected; } };
  const updater = { httpExecutor: executor, differentialDownloadInstaller(...received) { assert.equal(this, updater); assert.deepEqual(received, args); return promise; } };
  const events = [];
  assert.equal(observeUpdateDownloads(updater, { differential: () => events.push("differential"), full: () => { throw new Error("observer only"); }, differentialResult: value => { events.push(value); throw new Error("observer result only"); } }).canConfirmCache, true);
  assert.equal(updater.differentialDownloadInstaller(...args), promise);
  assert.equal(updater.httpExecutor.download(...args), rejected);
  await promise;
  await assert.rejects(rejected, error => error.message === "original rejection");
  assert.deepEqual(events, ["differential", false]);
  const synchronous = { httpExecutor: { download() { throw syncError; } } };
  observeUpdateDownloads(synchronous, { full: () => { throw new Error("observer only"); } });
  assert.throws(() => synchronous.httpExecutor.download(), error => error === syncError);
});

test("only recognized fallback messages yield safe classifications; upstream raw logs are never forwarded", () => {
  let captured;
  const updater = {};
  observeUpdateDownloads(updater, { fallback: diagnostic => { captured = diagnostic; } });
  updater.logger.info("https://user:password@example.invalid/file?token=hidden-secret");
  updater.logger.error("Unrelated raw error with Bearer hidden-secret");
  assert.equal(captured, undefined);
  updater.logger.error("Cannot download differentially, fallback to full download: Error: net::ERR_CONNECTION_RESET\nhttps://user:password@example.invalid/file?token=hidden-secret\nAuthorization: Bearer hidden-secret\nC:\\private\\profile");
  assert.deepEqual(captured, { stage: "download", category: "network", code: "ERR_CONNECTION_RESET", retryable: true });
  assert.doesNotMatch(JSON.stringify(captured), /hidden-secret|password|https:|private|Bearer/);
  const noisy = {};
  observeUpdateDownloads(noisy, { fallback() { throw new Error("log writer failed"); } });
  assert.doesNotThrow(() => noisy.logger.error("Cannot download differentially, fallback to full download: ENOENT"));
});

test("failure classifications keep HTTP status and known codes without exposing messages", () => {
  const fixtures = [
    [Object.assign(new Error("signed https://example.invalid/?secret=hidden"), { statusCode: 403 }), { stage: "download", category: "http", statusCode: 403, retryable: false }],
    ["HttpError: 404 Not Found\nhttps://example.invalid/?token=hidden", { stage: "download", category: "not-found", statusCode: 404, retryable: false }],
    [new Error("sha512 checksum mismatch https://example.invalid/?signature=hidden"), { stage: "verify", category: "checksum", retryable: false }],
    [Object.assign(new Error("sha512 checksum mismatch"), { code: "ERR_CHECKSUM_MISMATCH" }), { stage: "verify", category: "checksum", code: "ERR_CHECKSUM_MISMATCH", retryable: false }],
    [Object.assign(new Error("timeout"), { code: "ERR_CONNECTION_TIMED_OUT" }), { stage: "download", category: "timeout", code: "ERR_CONNECTION_TIMED_OUT", retryable: true }],
    [Object.assign(new Error("unknown"), { code: "PRIVATE_TOKEN_HIDDEN" }), { stage: "download", category: "unknown", retryable: false }],
  ];
  for (const [error, expected] of fixtures) assert.deepEqual(updateFailureDiagnostic(error), expected);
});

function realNsisFixture({ needsFull = false, disabled = false, web = false } = {}) {
  const updater = new NsisUpdater(null, { version: "0.2.67", name: "IsolatedUpdater", isPackaged: true, userDataPath: "unused", baseCachePath: "unused" });
  const info = { url: "SuperCanvas-Setup-0.2.68-x64.exe", sha512: "synthetic-sha512", size: 20 };
  const fileInfo = { url: new URL("https://example.invalid/installer.exe"), info, ...(web ? { packageInfo: { path: "https://example.invalid/package.7z", sha512: "synthetic-package" } } : {}) };
  const provider = { resolveFiles: () => [fileInfo] };
  const token = {};
  const requestHeaders = { "x-synthetic-fixture": "fixture" };
  const options = { updateInfoAndProvider: { provider, info: { version: "0.2.68", files: [info] } }, requestHeaders, cancellationToken: token, disableDifferentialDownload: disabled, disableWebInstaller: false };
  const calls = [], observations = [];
  let originalDownloadOptions;
  updater.executeDownload = function(task) {
    assert.equal(this, updater);
    originalDownloadOptions = { sha512: info.sha512, headers: requestHeaders, cancellationToken: token, onProgress() {} };
    return task.task("synthetic-destination", originalDownloadOptions, web ? "synthetic-package-file" : null, async () => {});
  };
  updater.verifySignature = async () => { calls.push("verify-signature"); return null; };
  updater.differentialDownloadInstaller = async function(...args) {
    assert.equal(this, updater); assert.equal(args[0], fileInfo); assert.equal(args[1], options); calls.push("differential");
    if (needsFull) this.logger.error("Cannot download differentially, fallback to full download: ECONNRESET");
    return needsFull;
  };
  updater.differentialDownloadWebPackage = async () => false;
  updater.httpExecutor = { download(url, destination, actualOptions) {
    assert.equal(this, updater.httpExecutor); assert.equal(url, fileInfo.url); assert.equal(destination, "synthetic-destination");
    assert.equal(actualOptions, originalDownloadOptions); assert.equal(actualOptions.sha512, "synthetic-sha512"); assert.equal(actualOptions.cancellationToken, token);
    calls.push("full"); return Promise.resolve();
  } };
  observeUpdateDownloads(updater, { differential: () => observations.push("differential"), full: () => observations.push("full"), fallback: value => observations.push(value.code), differentialResult: value => observations.push(value) });
  return { updater, options, calls, observations };
}

test("real NSIS differential success preserves signature verification and avoids full transport", async () => {
  const fixture = realNsisFixture();
  await fixture.updater.doDownloadUpdate(fixture.options);
  assert.deepEqual(fixture.calls, ["differential", "verify-signature"]);
  assert.deepEqual(fixture.observations, ["differential", false]);
});

test("real NSIS differential fallback preserves checksum, cancellation, progress and signature checks", async () => {
  const fixture = realNsisFixture({ needsFull: true });
  await fixture.updater.doDownloadUpdate(fixture.options);
  assert.deepEqual(fixture.calls, ["differential", "full", "verify-signature"]);
  assert.deepEqual(fixture.observations, ["differential", "ECONNRESET", true, "full"]);
});

test("real NSIS disabled differential and web installers go directly to full download without a fallback error", async () => {
  for (const input of [{ disabled: true }, { web: true }]) {
    const fixture = realNsisFixture(input);
    await fixture.updater.doDownloadUpdate(fixture.options);
    assert.deepEqual(fixture.calls, ["full", "verify-signature"]);
    assert.deepEqual(fixture.observations, ["full"]);
  }
});
