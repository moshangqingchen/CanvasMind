import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const MAX_DIAGNOSTIC_BYTES = 1024 * 1024;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const samePath = (left, right) => process.platform === "win32"
  ? left.toLowerCase() === right.toLowerCase() : left === right;

async function scopedRoot(root) {
  const supplied = resolve(root);
  const info = await lstat(supplied);
  if (!info.isDirectory() || info.isSymbolicLink()) return null;
  const canonical = await realpath(supplied);
  const temporary = await realpath(tmpdir());
  // Windows may supply a legitimate 8.3 spelling of its temporary directory.
  // Reject links with lstat, then compare canonical scope rather than spelling.
  return samePath(dirname(canonical), temporary)
    && basename(canonical).startsWith("supercanvas-desktop-smoke-") ? canonical : null;
}

async function readScopedFile(root, directory, name) {
  const folder = join(root, directory);
  try {
    const info = await lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(folder), folder)) {
      return { metadata: { state: "scope-refused" } };
    }
    const file = join(folder, name);
    const fileInfo = await lstat(file);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) return { metadata: { state: "scope-refused" } };
    if (fileInfo.size > MAX_DIAGNOSTIC_BYTES) return { metadata: { state: "too-large", exists: true, bytes: fileInfo.size } };
    const bytes = await readFile(file);
    if (bytes.byteLength > MAX_DIAGNOSTIC_BYTES) return { metadata: { state: "too-large", exists: true, bytes: bytes.byteLength } };
    return { metadata: { state: "read", exists: true, bytes: bytes.byteLength, sha256: hash(bytes) }, bytes };
  } catch (error) {
    return { metadata: error?.code === "ENOENT" ? { state: "missing", exists: false } : { state: "unreadable" } };
  }
}

/** Read only ciphertext metadata from the uniquely owned smoke profile. */
export async function captureSmokeProfileDiagnostics(root) {
  let canonical;
  try { canonical = await scopedRoot(root); } catch { /* Return an enum, never a path or raw filesystem error. */ }
  if (!canonical) return { scope: "refused" };
  const [secrets, localState] = await Promise.all([
    readScopedFile(canonical, "profile", "secrets.bin"),
    readScopedFile(canonical, "browser", "Local State"),
  ]);
  const result = { scope: "owned-smoke-profile", secrets: secrets.metadata, localState: localState.metadata };
  if (!localState.bytes) return result;
  let state;
  try { state = JSON.parse(localState.bytes.toString("utf8")); }
  catch { result.localState.json = "invalid"; return result; }
  result.localState.json = "parsed";
  const key = state?.os_crypt?.encrypted_key;
  if (typeof key !== "string" || !key) { result.localState.encryptedKey = "missing"; return result; }
  if (key.length > 16384 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(key)) {
    result.localState.encryptedKey = "invalid-encoding";
    return result;
  }
  const ciphertext = Buffer.from(key, "base64");
  if (!ciphertext.byteLength || ciphertext.toString("base64") !== key) {
    result.localState.encryptedKey = "invalid-encoding";
    return result;
  }
  result.localState.encryptedKey = "present";
  result.localState.encryptedKeySha256 = hash(ciphertext);
  return result;
}

/**
 * Self-contained for ElectronApplication.evaluate. Called only after restart
 * failure; plaintext remains inside the main process and no profile is written.
 */
export function diagnoseFailedSmokeProfile({ app, safeStorage }, expectedRoot) {
  const result = { stage: "scope", status: "scope-refused", available: null };
  let fs, path, os;
  try {
    fs = process.getBuiltinModule("node:fs");
    path = process.getBuiltinModule("node:path");
    os = process.getBuiltinModule("node:os");
    if (!fs || !path || !os) return { ...result, status: "builtins-unavailable" };
    const suppliedUserData = path.resolve(app.getPath("userData"));
    const suppliedRoot = path.dirname(suppliedUserData);
    const equal = (left, right) => process.platform === "win32"
      ? left.toLowerCase() === right.toLowerCase() : left === right;
    const plainDirectory = (folder) => {
      const info = fs.lstatSync(folder);
      return info.isDirectory() && !info.isSymbolicLink();
    };
    if (!plainDirectory(suppliedRoot) || !plainDirectory(suppliedUserData) || !plainDirectory(path.resolve(expectedRoot))) return result;
    // The native resolver expands Windows 8.3 components; the JS resolver may
    // preserve their spelling even when there are no symbolic links.
    const root = fs.realpathSync.native(suppliedRoot);
    const userData = fs.realpathSync.native(suppliedUserData);
    const expected = fs.realpathSync.native(path.resolve(expectedRoot));
    if (!equal(root, expected) || !equal(userData, path.join(root, "browser"))
      || !path.basename(root).startsWith("supercanvas-desktop-smoke-")
      || !equal(path.dirname(root), fs.realpathSync.native(os.tmpdir()))
      || !plainDirectory(path.join(root, "profile"))) return result;
    result.stage = "availability";
    try { result.available = safeStorage.isEncryptionAvailable(); }
    catch { return { ...result, status: "availability-failed" }; }
    if (!result.available) return { ...result, status: "unavailable" };
    result.stage = "read";
    let bytes;
    try {
      const file = path.join(root, "profile", "secrets.bin");
      const info = fs.lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink()) return { ...result, status: "scope-refused" };
      if (info.size > 1024 * 1024) return { ...result, status: "too-large" };
      bytes = fs.readFileSync(file);
      if (bytes.byteLength > 1024 * 1024) return { ...result, status: "too-large" };
    } catch (error) { return { ...result, status: error?.code === "ENOENT" ? "missing" : "read-failed" }; }
    result.stage = "decrypt";
    let plaintext;
    try { plaintext = safeStorage.decryptString(bytes); }
    catch { return { ...result, status: "decrypt-failed" }; }
    result.stage = "parse";
    let secrets;
    try { secrets = JSON.parse(plaintext); }
    catch { return { ...result, status: "parse-failed" }; }
    result.stage = "schema";
    if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)
      || typeof secrets.masterKey !== "string" || !secrets.masterKey) return { ...result, status: "schema-invalid" };
    return { ...result, status: "valid" };
  } catch { return { ...result, status: "scope-refused" }; }
}
