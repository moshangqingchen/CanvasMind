/** Explicit, one-shot native credential read. Never invoked by tests or product code. */
import { app, safeStorage } from "electron";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reserveAdditionalCapture, selectedConnectionFromSnapshot, sourceFromCapturedSnapshots } from "./capture-source-core.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const isolated = join(repositoryRoot, ".codex-temp", "agent-eval");
const writeOnce = (path, value) => {
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value)}\n`, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
};
// Safe stages are persisted before each source operation. Never store native
// exception messages: they can contain provider objects or secret material.
let stage = "initializing";
let snapshotDirectory = isolated;
const checkpoint = (next) => {
  stage = next;
  writeOnce(join(snapshotDirectory, `capture-${next}-${Date.now()}.json`), { stage, at: new Date().toISOString() });
};
// Set all Electron writable paths before app readiness. No native window is made.
const nativeData = join(isolated, "source-reader-electron");
mkdirSync(nativeData, { recursive: true });
mkdirSync(join(nativeData, "logs"), { recursive: true });
app.setPath("userData", nativeData);
app.setPath("sessionData", nativeData);
app.setPath("logs", join(nativeData, "logs"));
app.commandLine.appendSwitch("disk-cache-dir", join(nativeData, "cache"));
app.disableHardwareAcceleration();

// Do not top-level-await readiness: Electron waits for main-module evaluation.
app.whenReady().then(() => {
try {
  const captureMode = process.env.AGENT_EVAL_CAPTURE;
  if (!["confirmed-one-read", "confirmed-additional-one-read", "confirmed-isolated-recovery"].includes(captureMode) || !process.env.AGENT_EVAL_PROFILE_ROOT ||
    !process.env.AGENT_EVAL_CONNECTION_ID || !process.env.AGENT_EVAL_MODEL_ID)
    throw new Error("capture-not-authorized");
  if (existsSync(join(isolated, "selection.secret.json")) || existsSync(join(isolated, "source.secret.json")))
    throw new Error("existing-snapshot");
  const profile = join(resolve(process.env.AGENT_EVAL_PROFILE_ROOT), "profile");
  const database = join(profile, "data", "super-canvas.json");
  const secretsPath = join(profile, "secrets.bin");
  mkdirSync(dirname(join(isolated, "source.secret.json")), { recursive: true });
  const identity = { connectionId: process.env.AGENT_EVAL_CONNECTION_ID, modelId: process.env.AGENT_EVAL_MODEL_ID,
    selectionSource: process.env.AGENT_EVAL_SELECTION_SOURCE || "user-confirmed saved creative-assistant selection" };
  if (captureMode === "confirmed-isolated-recovery") {
    const retry = JSON.parse(readFileSync(join(isolated, "source-read-additional-once.json"), "utf8"));
    if (retry.connectionId !== identity.connectionId || retry.modelId !== identity.modelId ||
      !/^source-read-retry-[0-9TZ-]+$/u.test(retry.snapshotDirectory)) throw new Error("recovery-identity-invalid");
    snapshotDirectory = join(isolated, retry.snapshotDirectory);
    checkpoint("before-isolated-recovery");
    writeOnce(join(isolated, "source.secret.json"), sourceFromCapturedSnapshots(snapshotDirectory,
      encrypted => safeStorage.decryptString(encrypted), identity, checkpoint));
    checkpoint("capture-complete");
    app.exit(0);
    return;
  }
  // Old locks are immutable. The authorized extra read gets its own one-shot guard.
  if (captureMode === "confirmed-additional-one-read") snapshotDirectory = reserveAdditionalCapture(isolated, identity);
  else writeOnce(join(isolated, "source-read-once.json"), { startedAt: new Date().toISOString(), ...identity });
  checkpoint("checking-encryption");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("dpapi-unavailable");
  checkpoint("before-database-read");
  const before = statSync(database);
  const raw = readFileSync(database, "utf8"); // Original DB is read exactly once.
  checkpoint("database-read-complete");
  const after = statSync(database);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("source-changed");
  const { record, supplier } = selectedConnectionFromSnapshot(raw, process.env.AGENT_EVAL_CONNECTION_ID);
  // Retain only the selected connection, never the full source database. This
  // intermediate snapshot can survive a later native-decryption failure.
  writeOnce(join(snapshotDirectory, "selected-record.secret.json"), { record, supplier });
  checkpoint("before-dpapi-read");
  const encrypted = readFileSync(secretsPath); // One DPAPI source-file read.
  const encryptedFd = openSync(join(snapshotDirectory, "profile-key.dpapi.bin"), "wx", 0o600);
  try { writeFileSync(encryptedFd, encrypted); fsyncSync(encryptedFd); } finally { closeSync(encryptedFd); }
  checkpoint("dpapi-read-complete");
  checkpoint("before-isolated-decryption");
  writeOnce(join(isolated, "source.secret.json"), sourceFromCapturedSnapshots(snapshotDirectory,
    bytes => safeStorage.decryptString(bytes), identity, checkpoint));
  checkpoint("capture-complete");
  // Intentionally no stdout: neither source objects nor secrets leave the file.
  app.exit(0);
} catch {
  // Never print native error causes; DPAPI/provider objects may include credentials.
  try { writeOnce(join(snapshotDirectory, `capture-stopped-${Date.now()}.json`),
    { stage, at: new Date().toISOString(), sourceModified: false }); } catch { /* Keep the original evidence immutable. */ }
  process.stderr.write(`Isolated one-shot selection capture stopped at ${stage}; source was not modified.\n`);
  app.exit(1);
}
});
