import {
  copyFile,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptRoot, "..");
const dataPath = resolve(
  process.env.SUPERCANVAS_DATA_FILE ??
    join(workspaceRoot, "apps", "web", "data", "super-canvas.json"),
);
const baselinePath = resolve(
  process.env.SUPERCANVAS_PROVIDER_BASELINE ??
    join(
      workspaceRoot,
      "apps",
      "web",
      "data",
      "super-canvas.before-runtime-key-restore-20260829.json",
    ),
);
const dryRun = process.argv.includes("--dry-run");

const targetIds = [
  "ea4a8ee7-c709-4df9-a774-7c18722d30b6",
  "37294a3e-157f-4117-8b7d-bb6e44e87570",
  "829c6998-bfc8-4957-9c53-00b91619650f",
  "0e25fcc9-481e-49a6-8932-7d57c5236293",
  "62103fb3-1370-4deb-a0b2-7f4bdab3895e",
];

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function modelsFrom(connector) {
  return Array.isArray(connector?.models)
    ? connector.models.filter(
        (model) =>
          model &&
          typeof model === "object" &&
          typeof model.id === "string" &&
          model.id.trim().length > 0,
      )
    : [];
}

function mergeModels(baselineModels, currentModels) {
  const byId = new Map();
  for (const model of [...baselineModels, ...currentModels]) {
    const id = model.id.trim();
    const previous = byId.get(id);
    // Keep the current live descriptor for shared IDs (it may carry newer
    // pricing), while retaining every baseline/current ID in the callable set.
    byId.set(id, previous ? { ...previous, ...clone(model) } : clone(model));
  }
  return [...byId.values()];
}

function isCangyuanImageOverride(id) {
  return /^(?:gpt-image-2(?:-(?:1k|2k|4k))?|nano-banana(?:-pro)?-(?:1k|2k|4k)|nano-banana2-(?:1k|2k|4k))$/iu.test(
    id,
  );
}

function cleanedCangyuanConnector(currentConnector, models) {
  const connector = clone(currentConnector) ?? {};
  connector.models = models;
  const removedImageOverrides = [];
  if (connector.modelOverrides && typeof connector.modelOverrides === "object") {
    const overrides = {};
    for (const [id, value] of Object.entries(connector.modelOverrides)) {
      // The current regression introduced a model-level image transport which
      // bypasses the base connector's JSON `images` mapping. Drop it entirely;
      // the verified base generations transport handles both generate/edit.
      if (isCangyuanImageOverride(id)) {
        removedImageOverrides.push(id);
        continue;
      }
      overrides[id] = value;
    }
    if (Object.keys(overrides).length > 0) connector.modelOverrides = overrides;
    else delete connector.modelOverrides;
  }
  return { connector, removedImageOverrides };
}

function connectionMap(snapshot) {
  return new Map(
    (Array.isArray(snapshot?.connections) ? snapshot.connections : []).map(
      (connection) => [connection.id, connection],
    ),
  );
}

const [currentText, baselineText] = await Promise.all([
  readFile(dataPath, "utf8"),
  readFile(baselinePath, "utf8"),
]);
const current = JSON.parse(currentText);
const baseline = JSON.parse(baselineText);
if (!Array.isArray(current.connections) || !Array.isArray(baseline.connections))
  throw new Error("Provider repair requires valid connection arrays");

const currentConnections = connectionMap(current);
const baselineConnections = connectionMap(baseline);
const changes = [];
for (const id of targetIds) {
  const live = currentConnections.get(id);
  const saved = baselineConnections.get(id);
  if (!live || !saved) {
    changes.push({ id, skipped: true });
    continue;
  }
  const currentConfig = live.config ?? {};
  const baselineConfig = saved.config ?? {};
  const currentConnector = currentConfig.connector ?? {};
  const baselineConnector = baselineConfig.connector ?? {};
  const mergedModels = mergeModels(
    modelsFrom(baselineConnector),
    modelsFrom(currentConnector),
  );
  const isCangyuan = currentConfig.preset === "cangyuan-gpt-image-2";
  const cleaned = isCangyuan
    ? cleanedCangyuanConnector(currentConnector, mergedModels)
    : { connector: { ...clone(currentConnector), models: mergedModels }, removedImageOverrides: [] };
  const connector = cleaned.connector;
  const nextConfig = {
    ...currentConfig,
    ...(typeof baselineConfig.modelGroup === "string"
      ? { modelGroup: baselineConfig.modelGroup }
      : {}),
    ...(typeof baselineConfig.defaultModel === "string"
      ? { defaultModel: baselineConfig.defaultModel }
      : {}),
    connector,
  };
  const beforeModels = modelsFrom(currentConnector).map((model) => model.id);
  const afterModels = mergedModels.map((model) => model.id);
  const beforeDefault = currentConfig.defaultModel;
  const changed = JSON.stringify(currentConfig) !== JSON.stringify(nextConfig);
  if (changed) live.config = nextConfig;
  changes.push({
    id,
    beforeDefault,
    afterDefault: nextConfig.defaultModel,
    beforeCount: beforeModels.length,
    afterCount: afterModels.length,
    removedImageOverrides: cleaned.removedImageOverrides,
    changed,
  });
}

console.log(JSON.stringify({ dryRun, dataPath, baselinePath, changes }, null, 2));
if (dryRun) process.exit(0);

if (!changes.some((change) => change.changed)) {
  console.log(JSON.stringify({ backupPath: null, changed: false }));
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[^0-9]/gu, "").slice(0, 14);
const backupPath = `${dataPath}.before-provider-repair-${stamp}.json`;
await copyFile(dataPath, backupPath);
const temporaryPath = `${dataPath}.${process.pid}.provider-repair.tmp`;
try {
  await writeFile(temporaryPath, JSON.stringify(current), "utf8");
  await rename(temporaryPath, dataPath);
} finally {
  // A failed rename leaves the temporary file behind on some Windows builds;
  // best-effort cleanup keeps the data directory unambiguous.
  await unlink(temporaryPath).catch(() => undefined);
}
console.log(JSON.stringify({ backupPath, changed: true }));
