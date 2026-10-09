import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { captureSmokeProfileDiagnostics, diagnoseFailedSmokeProfile } from "../scripts/smoke-profile-diagnostics.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const protectedBytes = Buffer.from("synthetic protected profile bytes");
const cipher = Buffer.from("synthetic OS key ciphertext");
const plaintext = JSON.stringify({ masterKey: "synthetic-master-do-not-return", network: {} });

async function fixture(t, prefix = "supercanvas-desktop-smoke-diagnostics-") {
  const root = resolve(await mkdtemp(join(tmpdir(), prefix)));
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(basename(root).startsWith(prefix));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, "profile"));
  await mkdir(join(root, "browser"));
  return root;
}

const electronContext = (root, safeStorage) => ({ app: { getPath: () => join(root, "browser") }, safeStorage });
const assertRedacted = (value, root) => {
  const serialized = JSON.stringify(value);
  for (const privateValue of [root, plaintext, "synthetic-master-do-not-return", protectedBytes.toString(), cipher.toString(), cipher.toString("base64")]) {
    assert.equal(serialized.includes(privateValue), false);
  }
};

test("smoke metadata preserves files and returns only ciphertext digests, not protected values or paths", async t => {
  const root = await fixture(t);
  await writeFile(join(root, "profile/secrets.bin"), protectedBytes);
  const state = JSON.stringify({ os_crypt: { encrypted_key: cipher.toString("base64") }, arbitrary: "private extra field" });
  await writeFile(join(root, "browser/Local State"), state);
  const captured = await captureSmokeProfileDiagnostics(root);
  assert.deepEqual(captured.secrets, { state: "read", exists: true, bytes: protectedBytes.byteLength, sha256: hash(protectedBytes) });
  assert.equal(captured.localState.json, "parsed");
  assert.equal(captured.localState.encryptedKeySha256, hash(cipher));
  assert.equal(captured.localState.encryptedKey, "present");
  assertRedacted(captured, root);
  assert.equal(JSON.stringify(captured).includes("private extra field"), false);
  assert.deepEqual(await readFile(join(root, "profile/secrets.bin")), protectedBytes);
  assert.equal(await readFile(join(root, "browser/Local State"), "utf8"), state);
});

test("metadata distinguishes absent, invalid JSON, invalid key encoding and bounded files without writing", async t => {
  const root = await fixture(t);
  const empty = await captureSmokeProfileDiagnostics(root);
  assert.equal(empty.secrets.state, "missing");
  assert.equal(empty.localState.exists, false);
  assert.deepEqual(await readdir(join(root, "profile")), []);
  assert.deepEqual(await readdir(join(root, "browser")), []);
  await writeFile(join(root, "browser/Local State"), "not JSON: private payload");
  assert.equal((await captureSmokeProfileDiagnostics(root)).localState.json, "invalid");
  await writeFile(join(root, "browser/Local State"), JSON.stringify({ os_crypt: { encrypted_key: "private malformed cipher" } }));
  assert.equal((await captureSmokeProfileDiagnostics(root)).localState.encryptedKey, "invalid-encoding");
  await writeFile(join(root, "profile/secrets.bin"), Buffer.alloc(1024 * 1024 + 1, 7));
  const bounded = await captureSmokeProfileDiagnostics(root);
  assert.equal(bounded.secrets.state, "too-large");
  assert.equal(bounded.secrets.sha256, undefined);
  assertRedacted(bounded, root);
});

test("diagnostics refuse non-smoke roots and linked profile directories before reading or decrypting", async t => {
  const root = await fixture(t);
  const outside = await fixture(t, "unowned-diagnostics-");
  await writeFile(join(outside, "profile/secrets.bin"), protectedBytes);
  assert.deepEqual(await captureSmokeProfileDiagnostics(outside), { scope: "refused" });
  await rmdir(join(root, "profile"));
  await symlink(join(outside, "profile"), join(root, "profile"), process.platform === "win32" ? "junction" : "dir");
  assert.equal((await lstat(join(root, "profile"))).isSymbolicLink(), true);
  assert.equal((await captureSmokeProfileDiagnostics(root)).secrets.state, "scope-refused");
  let availabilityCalls = 0;
  const context = electronContext(root, { isEncryptionAvailable: () => { availabilityCalls++; return true; }, decryptString: () => assert.fail("linked files must not be decrypted") });
  assert.deepEqual(diagnoseFailedSmokeProfile(context, root), { stage: "scope", status: "scope-refused", available: null });
  assert.equal(availabilityCalls, 0);
});

test("the serialized Electron failure probe validates schema without returning plaintext or modifying ciphertext", async t => {
  const root = await fixture(t);
  await writeFile(join(root, "profile/secrets.bin"), protectedBytes);
  // Playwright sends the callback without module bindings; it must remain self-contained.
  const serializedProbe = Function(`return (${diagnoseFailedSmokeProfile.toString()});`)();
  let decryptions = 0;
  const context = electronContext(root, {
    isEncryptionAvailable: () => true,
    decryptString: bytes => { decryptions++; assert.deepEqual(bytes, protectedBytes); return plaintext; },
  });
  const result = serializedProbe(context, root);
  assert.deepEqual(result, { stage: "schema", status: "valid", available: true });
  assert.equal(decryptions, 1);
  assertRedacted(result, root);
  assert.deepEqual(await readFile(join(root, "profile/secrets.bin")), protectedBytes);
});

test("failure stages distinguish availability, read, decrypt, parse and schema errors without raw error text", async t => {
  const root = await fixture(t);
  const invoke = storage => diagnoseFailedSmokeProfile(electronContext(root, storage), root);
  assert.deepEqual(invoke({ isEncryptionAvailable: () => false }), { stage: "availability", status: "unavailable", available: false });
  assert.deepEqual(invoke({ isEncryptionAvailable: () => true }), { stage: "read", status: "missing", available: true });
  await writeFile(join(root, "profile/secrets.bin"), protectedBytes);
  const rejected = invoke({ isEncryptionAvailable: () => true, decryptString: () => { throw new Error(`${root} ${plaintext}`); } });
  assert.deepEqual(rejected, { stage: "decrypt", status: "decrypt-failed", available: true });
  assertRedacted(rejected, root);
  assert.deepEqual(invoke({ isEncryptionAvailable: () => true, decryptString: () => "private non-JSON" }), { stage: "parse", status: "parse-failed", available: true });
  assert.deepEqual(invoke({ isEncryptionAvailable: () => true, decryptString: () => JSON.stringify({ masterKey: 42 }) }), { stage: "schema", status: "schema-invalid", available: true });
  assert.deepEqual(diagnoseFailedSmokeProfile(electronContext(root, { isEncryptionAvailable: () => assert.fail("wrong profile must not be queried") }), `${root}-different`),
    { stage: "scope", status: "scope-refused", available: null });
});

test("snapshots identify an OS ciphertext-key change separately from an unchanged profile secret", async t => {
  const root = await fixture(t);
  await writeFile(join(root, "profile/secrets.bin"), protectedBytes);
  await writeFile(join(root, "browser/Local State"), JSON.stringify({ os_crypt: { encrypted_key: cipher.toString("base64") } }));
  const before = await captureSmokeProfileDiagnostics(root);
  await writeFile(join(root, "browser/Local State"), JSON.stringify({ os_crypt: { encrypted_key: Buffer.from("other synthetic ciphertext").toString("base64") } }));
  const after = await captureSmokeProfileDiagnostics(root);
  assert.equal(before.secrets.sha256, after.secrets.sha256);
  assert.notEqual(before.localState.encryptedKeySha256, after.localState.encryptedKeySha256);
  assertRedacted(after, root);
});

test("Windows short-path aliases retain the same owned smoke profile scope", { skip: process.platform !== "win32" }, async t => {
  const root = await fixture(t);
  const canonical = await realpath(root);
  const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class SmokeShortPath { [DllImport(\"kernel32.dll\", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path, StringBuilder output, uint length); }'; $diagnosticBuffer = New-Object Text.StringBuilder 32768; $diagnosticLength = [SmokeShortPath]::GetShortPathName($env:SMOKE_DIAGNOSTIC_FIXTURE_PATH, $diagnosticBuffer, 32768); if ($diagnosticLength -eq 0 -or $diagnosticLength -ge 32768) { exit 1 }; [Console]::Write($diagnosticBuffer.ToString())"],
  { env: { ...process.env, SMOKE_DIAGNOSTIC_FIXTURE_PATH: canonical }, windowsHide: true, timeout: 15000, maxBuffer: 65536 });
  const alias = stdout.trim();
  if (alias.toLowerCase() === canonical.toLowerCase()) { t.skip("This volume did not provide a distinct 8.3 alias"); return; }
  await writeFile(join(root, "profile/secrets.bin"), protectedBytes);
  assert.equal((await captureSmokeProfileDiagnostics(alias)).secrets.sha256, hash(protectedBytes));
  const context = electronContext(alias, { isEncryptionAvailable: () => true, decryptString: () => plaintext });
  assert.deepEqual(diagnoseFailedSmokeProfile(context, canonical), { stage: "schema", status: "valid", available: true });
});
