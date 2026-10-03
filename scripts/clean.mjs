import { lstat, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const generatedDirectory =
  /^(?:\.next(?:-.*)?|out|playwright-report|test-results(?:-.*)?|\.ui-[a-z0-9-]+-results)$/u;

async function entries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

// Check every ancestor: a junction must never redirect cleanup into another tree.
export async function validateCleanupTarget(root, relativePath) {
  const canonicalRoot = await realpath(root);
  const target = path.resolve(canonicalRoot, relativePath);
  const relative = path.relative(canonicalRoot, target);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(`Cleanup target escapes workspace: ${relativePath}`);
  let current = canonicalRoot;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(
          `Cleanup target contains a symbolic link: ${relativePath}`,
        );
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  return target;
}

async function measure(target) {
  const info = await lstat(target);
  if (info.isSymbolicLink()) return { bytes: 0, files: 0 };
  if (!info.isDirectory()) return { bytes: info.size, files: 1 };
  let bytes = 0,
    files = 0;
  for (const entry of await entries(target)) {
    if (entry.isSymbolicLink()) continue;
    const child = await measure(path.join(target, entry.name));
    bytes += child.bytes;
    files += child.files;
  }
  return { bytes, files };
}

export async function planCleanup(
  root,
  { deep = false, measureFiles = true } = {},
) {
  const canonicalRoot = await realpath(root);
  const candidates = new Map();
  const add = async (relativePath, reason) => {
    const target = await validateCleanupTarget(canonicalRoot, relativePath);
    if (target) candidates.set(relativePath.replaceAll("\\", "/"), reason);
  };
  const inspectOutputs = async (relativeRoot, keepDesktop = false) => {
    for (const entry of await entries(path.join(canonicalRoot, relativeRoot))) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && generatedDirectory.test(entry.name)) {
        if (keepDesktop && !deep && entry.name === ".next-desktop") continue;
        await add(
          path.join(relativeRoot, entry.name),
          "可重建的构建与测试输出",
        );
      } else if (entry.isFile() && /(?:\.log|\.tsbuildinfo)$/u.test(entry.name))
        await add(
          path.join(relativeRoot, entry.name),
          "开发日志与增量编译缓存",
        );
    }
  };
  await inspectOutputs("");
  await add(".codex-logs", "历史开发日志");
  // Keep source snapshots, databases and media in old deployment fixtures.
  for (const entry of await entries(path.join(canonicalRoot, ".codex-temp"))) {
    if (!entry.isDirectory() || !/^deploy-web-test-\d+$/u.test(entry.name))
      continue;
    const relativeRoot = `.codex-temp/${entry.name}`;
    await inspectOutputs(relativeRoot);
    await add(`${relativeRoot}/node_modules`, "旧测试部署的重复依赖");
  }
  // Installed copies under apps/ are intentionally outside this workspace list.
  const packageFolders = ["apps/desktop/renderer", "apps/desktop"];
  for (const entry of await entries(path.join(canonicalRoot, "packages")))
    if (entry.isDirectory() && !entry.isSymbolicLink())
      packageFolders.push(`packages/${entry.name}`);
  for (const relativeRoot of packageFolders) {
    await inspectOutputs(relativeRoot, true);
    if (deep) {
      await add(`${relativeRoot}/dist`, "可重建的编译输出");
      await add(`${relativeRoot}/node_modules`, "可重新安装的开发依赖");
    }
  }
  if (deep) {
    for (const relativePath of [
      "node_modules",
      "apps/desktop/stage",
      "apps/desktop/release/win-unpacked",
    ])
      await add(relativePath, "可重建的依赖或桌面打包中间产物");
  }
  const targets = [...candidates.keys()].filter(
    (candidate) =>
      ![...candidates.keys()].some(
        (parent) => parent !== candidate && candidate.startsWith(`${parent}/`),
      ),
  );
  const planned = [];
  for (const relativePath of targets.sort()) {
    const target = await validateCleanupTarget(canonicalRoot, relativePath);
    if (target)
      planned.push({
        path: relativePath,
        reason: candidates.get(relativePath),
        ...(measureFiles ? await measure(target) : { bytes: 0, files: 0 }),
      });
  }
  return planned;
}

export async function applyCleanup(root, plan) {
  // A modified plan cannot authorize removal of data, backups or installations.
  const allowed = new Set(
    (await planCleanup(root, { deep: true, measureFiles: false })).map(
      (entry) => entry.path,
    ),
  );
  const validated = [];
  for (const entry of plan) {
    if (!allowed.has(entry.path))
      throw new Error(`Not a generated cleanup target: ${entry.path}`);
    const target = await validateCleanupTarget(root, entry.path);
    if (target) validated.push(target);
  }
  for (const target of validated)
    await rm(target, { recursive: true, force: true });
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.some((arg) => !["--dry-run", "--deep"].includes(arg)))
    throw new Error("Usage: node scripts/clean.mjs [--dry-run] [--deep]");
  const deep = args.includes("--deep"),
    dryRun = args.includes("--dry-run");
  const plan = await planCleanup(workspaceRoot, { deep });
  if (!dryRun) await applyCleanup(workspaceRoot, plan);
  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "applied",
        deep,
        bytes: plan.reduce((sum, entry) => sum + entry.bytes, 0),
        files: plan.reduce((sum, entry) => sum + entry.files, 0),
        targets: plan,
        preserved: [
          "画布、素材、密钥与备份",
          "已安装 App",
          "安装包",
          ...(deep ? [] : ["当前桌面构建、stage 和编译输出"]),
        ],
      },
      null,
      2,
    ),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
