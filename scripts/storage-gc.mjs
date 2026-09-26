import { readdir, readFile, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCleanupTarget } from "./clean.mjs";

const workspaceRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const desktopProfile = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "SuperCanvasDesktop", "profile") : path.join(workspaceRoot, "desktop-profile");
const apply = process.argv.includes("--apply");
const verbose = process.argv.includes("--verbose");
const databasePath = path.resolve(
  process.env.LOCAL_DATABASE_PATH ??
    path.join(desktopProfile, "data", "super-canvas.json"),
);
const storageRoot = path.resolve(
  process.env.LOCAL_STORAGE_PATH ??
    path.join(desktopProfile, "storage"),
);
const managedRoots = ["assets", "previews"].map((name) =>
  path.join(storageRoot, name),
);

function assertInsideManagedRoot(target) {
  const resolved = path.resolve(target);
  const managed = managedRoots.some((root) => {
    const relative = path.relative(root, resolved);
    return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
  });
  if (!managed) throw new Error(`Refusing to touch unmanaged path: ${resolved}`);
}

async function filesUnder(root) {
  const result = [];
  const visit = async (directory) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(target);
        else if (entry.isFile()) result.push(target);
      }),
    );
  };
  try {
    const safeRoot = await validateCleanupTarget(storageRoot, path.relative(storageRoot, root));
    if (safeRoot) await visit(safeRoot);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return result;
}

async function pruneEmptyDirectories(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const target = path.join(root, entry.name);
    const safeTarget = await validateCleanupTarget(storageRoot, path.relative(storageRoot, target));
    if (!safeTarget) continue;
    await pruneEmptyDirectories(safeTarget);
    if ((await readdir(safeTarget)).length === 0) await rmdir(safeTarget);
  }
}

const snapshot = JSON.parse((await readFile(databasePath, "utf8")).replace(/^\uFEFF/u, ""));
if (!Array.isArray(snapshot.assets))
  throw new Error(`Unsupported local database format: ${databasePath}`);

const liveAssets = snapshot.assets.filter((asset) => asset?.deleted !== true);
const liveAssetIds = new Set(liveAssets.map((asset) => String(asset.id)));
const liveStorageKeys = new Set(
  liveAssets.map((asset) => String(asset.storageKey).replaceAll("\\", "/")),
);
const candidates = [];

for (const file of await filesUnder(managedRoots[0])) {
  const relative = path.relative(storageRoot, file).replaceAll("\\", "/");
  const objectKey = relative.endsWith(".metadata.json")
    ? relative.slice(0, -".metadata.json".length)
    : relative;
  if (!liveStorageKeys.has(objectKey)) candidates.push(file);
}

for (const file of await filesUnder(managedRoots[1])) {
  const relative = path.relative(managedRoots[1], file);
  const [assetId] = relative.split(path.sep);
  if (!assetId || !liveAssetIds.has(assetId)) candidates.push(file);
}

let bytes = 0;
for (const file of candidates) bytes += (await stat(file)).size;

if (apply) {
  for (const file of candidates) {
    assertInsideManagedRoot(file);
    const safeFile = await validateCleanupTarget(storageRoot, path.relative(storageRoot, file));
    if (safeFile) await rm(safeFile, { force: true });
  }
  for (const root of managedRoots) {
    try {
      const safeRoot = await validateCleanupTarget(storageRoot, path.relative(storageRoot, root));
      if (safeRoot) await pruneEmptyDirectories(safeRoot);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

const report = {
  mode: apply ? "apply" : "dry-run",
  databasePath,
  storageRoot,
  liveAssets: liveAssets.length,
  orphanFiles: candidates.length,
  reclaimableMB: Number((bytes / 1024 / 1024).toFixed(2)),
  ...(verbose
    ? { files: candidates.map((file) => path.relative(storageRoot, file)) }
    : {}),
};
console.log(JSON.stringify(report, null, 2));
if (!apply && candidates.length > 0)
  console.log("Dry-run only. Back up data/storage, stop the app, then use pnpm gc:storage:apply.");
