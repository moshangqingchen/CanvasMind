/** Stage-three explicit exception: one Local State copy; only project snapshots otherwise. */
import { app, safeStorage } from "electron";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceFromCapturedSnapshots, writeCaptureJsonOnce } from "./capture-source-core.mjs";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const isolated = join(root, ".codex-temp", "agent-eval");
const nativeData = join(isolated, "local-state-v3-electron");
const logDirectory = join(root, ".codex-logs", "2026-10-16-redesign-v2", "agent-eval");
let stage = "authorization";
let authorized = false;
const identity = { connectionId: "37294a3e-157f-4117-8b7d-bb6e44e87570", modelId: "gemini-stt",
  selectionSource: "由审查方 Claude 依据只读证据确认；第三阶段用户再次明确指定连接及完整型号" };
const checkpoint = (next) => {
  stage = next;
  writeCaptureJsonOnce(join(logDirectory, `local-state-${next}-${Date.now()}.json`),
    { stage, at: new Date().toISOString(), sourceModified: false });
};
try {
  if (process.env.AGENT_EVAL_LOCAL_STATE !== "confirmed-stage-three-one-copy") throw new Error("not-authorized");
  mkdirSync(logDirectory, { recursive: true });
  // Exclusive guard is persisted before any original-profile access. Never reset.
  writeCaptureJsonOnce(join(isolated, "local-state-stage-three-once.json"),
    { ...identity, authorization: "stage-three-one-local-state-copy", at: new Date().toISOString() });
  authorized = true;
  if (existsSync(join(isolated, "source.secret.json")) || existsSync(join(isolated, "selection.secret.json")))
    throw new Error("snapshot-exists");
  const retry = JSON.parse(readFileSync(join(isolated, "source-read-additional-once.json"), "utf8"));
  if (retry.connectionId !== identity.connectionId || retry.modelId !== identity.modelId ||
    !/^source-read-retry-[0-9TZ-]+$/u.test(retry.snapshotDirectory)) throw new Error("snapshot-identity");
  mkdirSync(join(nativeData, "logs"), { recursive: true });
  app.setPath("userData", nativeData);
  app.setPath("sessionData", nativeData);
  app.setPath("logs", join(nativeData, "logs"));
  app.commandLine.appendSwitch("disk-cache-dir", join(nativeData, "cache"));
  app.commandLine.appendSwitch("disable-background-networking");
  app.disableHardwareAcceleration();
  checkpoint("before-local-state-copy");
  const source = join(process.env.LOCALAPPDATA, "SuperCanvasDesktop", "browser", "Local State");
  // The only official-profile read in this script. No DB, Cookies or Login Data.
  copyFileSync(source, join(nativeData, "Local State"));
  checkpoint("local-state-copy-complete");
  app.whenReady().then(() => {
    try {
      checkpoint("encryption-availability");
      if (!safeStorage.isEncryptionAvailable()) throw new Error("unavailable");
      const sourceSnapshot = sourceFromCapturedSnapshots(join(isolated, retry.snapshotDirectory),
        bytes => safeStorage.decryptString(bytes), identity, checkpoint);
      writeCaptureJsonOnce(join(isolated, "source.secret.json"), sourceSnapshot);
      checkpoint("capture-complete");
      process.stdout.write("Stage-three isolated capture completed; no credentials printed.\n");
      app.exit(0);
    } catch {
      checkpoint(`stopped-${stage}`);
      process.stderr.write(`Stage-three capture stopped at ${stage}; no further decryption attempt is allowed.\n`);
      app.exit(1);
    }
  });
} catch {
  if (authorized) checkpoint(`stopped-${stage}`);
  process.stderr.write(`Stage-three capture stopped at ${stage}; no source modification.\n`);
  app.exit(1);
}
