import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function writeCaptureJsonOnce(path, value) {
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value)}\n`, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
}

/** A fixed exclusive guard also prevents a second retry with a new timestamp. */
export function reserveAdditionalCapture(directory, identity, at = new Date().toISOString()) {
  if (identity.connectionId !== "37294a3e-157f-4117-8b7d-bb6e44e87570" || identity.modelId !== "gemini-stt")
    throw new Error("additional-capture-identity-invalid");
  if (!existsSync(join(directory, "source-read-once.json"))) throw new Error("original-lock-missing");
  if (existsSync(join(directory, "selection.secret.json")) || existsSync(join(directory, "source.secret.json")))
    throw new Error("existing-snapshot");
  const name = `source-read-retry-${at.replace(/[:.]/gu, "-")}`;
  const record = { ...identity, startedAt: at, authorization: "explicit-additional-one-read", snapshotDirectory: name };
  writeCaptureJsonOnce(join(directory, "source-read-additional-once.json"), record);
  writeCaptureJsonOnce(join(directory, `${name}.json`), record);
  const snapshotDirectory = join(directory, name);
  mkdirSync(snapshotDirectory);
  return snapshotDirectory;
}

/** Recovers only project snapshots, never opens the source DB or DPAPI file. */
export function sourceFromCapturedSnapshots(directory, decrypt, identity, checkpoint = () => {}) {
  const { record, supplier } = JSON.parse(readFileSync(join(directory, "selected-record.secret.json"), "utf8"));
  if (record?.id !== identity.connectionId) throw new Error("snapshot-connection-mismatch");
  checkpoint("isolated-native-decryption");
  const plaintext = decrypt(readFileSync(join(directory, "profile-key.dpapi.bin")));
  checkpoint("isolated-secret-json");
  const secrets = JSON.parse(plaintext);
  checkpoint("isolated-key-validation");
  if (typeof secrets.masterKey !== "string" || !secrets.masterKey) throw new Error("master-key-missing");
  const network = secrets.network ?? {};
  const providerProxy = network.PROVIDER_HTTP_PROXY || network.HTTPS_PROXY || network.HTTP_PROXY || undefined;
  return { record, supplier, masterKey: secrets.masterKey, providerProxy, modelId: identity.modelId,
    capturedAt: new Date().toISOString(), selectionSource: identity.selectionSource };
}

/** Pure extraction; matches FileRepository's optional UTF-8 BOM handling. */
export function selectedConnectionFromSnapshot(raw, connectionId) {
  let source;
  try { source = JSON.parse(raw.replace(/^\uFEFF/u, "")); }
  catch { throw new Error("source-json-invalid"); }
  if (!Array.isArray(source?.connections)) throw new Error("source-connections-invalid");
  const record = source.connections.find(row => row?.id === connectionId);
  if (!record) throw new Error("selected-connection-missing");
  const supplier = Array.isArray(source.suppliers)
    ? source.suppliers.find(row => row?.id === record.config?.supplierId) : undefined;
  return { record, supplier };
}
