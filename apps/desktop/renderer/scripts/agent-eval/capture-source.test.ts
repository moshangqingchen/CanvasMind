import { expect, it } from "vitest";
import { selectedConnectionFromSnapshot, reserveAdditionalCapture, sourceFromCapturedSnapshots, writeCaptureJsonOnce } from "./capture-source-core.mjs";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EVALUATION_TEMP } from "./paths";
import { testSelection } from "./test-fixture";

it("reads optional BOM exactly as the application does and extracts only the exact connection and supplier", () => {
  const snapshot = testSelection();
  const record = { ...snapshot.record, config: { ...snapshot.record.config, supplierId: "selected-supplier" } };
  const raw = `\uFEFF${JSON.stringify({ connections: [
    { ...record, id: "other-connection", encryptedSecret: "other-secret" }, record,
  ], suppliers: [{ id: "other-supplier" }, { id: "selected-supplier" }], canvases: [{ id: "private-canvas" }] })}`;
  const selected = selectedConnectionFromSnapshot(raw, record.id);
  expect(selected).toEqual({ record, supplier: { id: "selected-supplier" } });
  expect(JSON.stringify(selected)).not.toMatch(/other-secret|private-canvas|other-supplier/u);
});

it("keeps the historical lock immutable and consumes exactly one additional read even with another timestamp", () => {
  mkdirSync(EVALUATION_TEMP, { recursive: true });
  const directory = mkdtempSync(join(EVALUATION_TEMP, "capture-test-"));
  const oldLock = '{"startedAt":"old-attempt"}\n';
  writeFileSync(join(directory, "source-read-once.json"), oldLock);
  const identity = { connectionId: "37294a3e-157f-4117-8b7d-bb6e44e87570", modelId: "gemini-stt" };
  const snapshots = reserveAdditionalCapture(directory, identity, "2026-10-16T18:00:00.000Z");
  expect(snapshots).toContain("source-read-retry-2026-10-16T18-00-00-000Z");
  expect(readFileSync(join(directory, "source-read-once.json"), "utf8")).toBe(oldLock);
  expect(() => reserveAdditionalCapture(directory, identity, "2026-10-16T19:00:00.000Z")).toThrow();
  expect(() => reserveAdditionalCapture(directory, { ...identity, modelId: "another-model" })).toThrow("additional-capture-identity-invalid");
});

it("recovers selected connection and DPAPI ciphertext only from isolated snapshots without a source profile", () => {
  mkdirSync(EVALUATION_TEMP, { recursive: true });
  const directory = mkdtempSync(join(EVALUATION_TEMP, "capture-test-"));
  const identity = { connectionId: "selected", modelId: "test-text", selectionSource: "test confirmed" };
  writeCaptureJsonOnce(join(directory, "selected-record.secret.json"), { record: { id: "selected" }, supplier: { id: "supplier" } });
  writeFileSync(join(directory, "profile-key.dpapi.bin"), "test-ciphertext");
  let decryptCalls = 0;
  const source = sourceFromCapturedSnapshots(directory, bytes => {
    decryptCalls++;
    expect(bytes.toString()).toBe("test-ciphertext");
    return JSON.stringify({ masterKey: "test-only-key", network: {} });
  }, identity);
  expect(source.record.id).toBe("selected");
  expect(source.masterKey).toBe("test-only-key");
  expect(source.modelId).toBe("test-text");
  expect(decryptCalls).toBe(1);
  expect(() => sourceFromCapturedSnapshots(directory, () => "{}", { ...identity, connectionId: "other" })).toThrow("snapshot-connection-mismatch");
  const stages: string[] = [];
  expect(() => sourceFromCapturedSnapshots(directory, () => { throw new Error("synthetic native failure"); }, identity,
    stage => stages.push(stage))).toThrow("synthetic native failure");
  expect(stages).toEqual(["isolated-native-decryption"]);
});

it("fails closed with fixed errors without including source content or choosing another connection", () => {
  for (const [raw, message] of [
    ['{"sensitive":"placeholder-private-data",', "source-json-invalid"],
    ['{"connections":{}}', "source-connections-invalid"],
    ['{"connections":[{"id":"other"}]}', "selected-connection-missing"],
  ]) {
    expect(() => selectedConnectionFromSnapshot(raw, "selected")).toThrow(message);
    try { selectedConnectionFromSnapshot(raw, "selected"); } catch (error) {
      expect(String(error)).not.toContain("placeholder-private-data");
    }
  }
});
