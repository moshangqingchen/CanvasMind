import { mkdir, readFile, writeFile, rename, readdir, lstat, stat, copyFile, realpath, rm } from "node:fs/promises";
import { join, resolve, dirname, basename, relative, isAbsolute, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { decryptSecret } from "@super-canvas/providers/credentials";
import { newMasterKey } from "./policy.mjs";

const exists = async (path) => stat(path).then(() => true, (e) => { if (e.code === "ENOENT") return false; throw e; });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const NETWORK_KEYS = ["ARTIFACT_HTTP_PROXY", "PROVIDER_HTTP_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "NODE_USE_ENV_PROXY"];

export function parseEnvironment(text) {
  const result = {};
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = /^\s*([A-Z_][A-Z_0-9]*)\s*=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

export function within(root, key) {
  const path = resolve(root, key);
  const rel = relative(resolve(root), path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("迁移文件路径越界");
  return path;
}

async function readOptional(path) {
  try { return await readFile(path, "utf8"); } catch (e) { if (e.code === "ENOENT") return ""; throw e; }
}

/** Storage adapters bind auxiliary files to the database filename. Copy them
 * with the main snapshot, including immutable historical evidence objects. */
export function databaseSidecarRoots(database) {
  return basename(database) === "super-canvas.json"
    ? [join(dirname(database), "catalog-pipeline"), join(dirname(database), "supplier-verification-evidence")]
    : [`${database}.catalog-pipeline`, `${database}.supplier-verification-evidence`];
}

export async function discoverSource(selected) {
  const root = await realpath(selected);
  // Same precedence as the old web server: package-local overrides root.
  const environment = {};
  for (const path of [join(root, ".env"), join(root, ".local-public.env"), join(root, "apps/web/.local-public.env")]) {
    Object.assign(environment, parseEnvironment(await readOptional(path)));
  }
  const web = await exists(join(root, "apps/web/data/super-canvas.json"));
  const activeRelease = (await readOptional(join(root, "active-release.txt"))).trim();
  const release = activeRelease && isAbsolute(activeRelease) ? activeRelease : root;
  const projectCandidates = [join(root, "项目"), join(root, "apps/web/项目"), join(release, "apps/web/项目"), join(release, "项目")];
  let projects = projectCandidates[0];
  for (const candidate of projectCandidates) if (await exists(candidate)) { projects = candidate; break; }
  const configured = (name, fallback) => environment[name] ? resolve(root, environment[name]) : fallback;
  const database = configured("LOCAL_DATABASE_PATH", join(root, web ? "apps/web/data/super-canvas.json" : "data/super-canvas.json"));
  if (!await exists(database)) throw new Error("所选目录没有本地画布数据库，请选择旧项目根目录或旧安装目录");
  return {
    root, environment, database,
    storage: configured("LOCAL_STORAGE_PATH", join(root, web ? "apps/web/storage" : "storage")),
    projects: configured("SUPERCANVAS_PROJECT_ROOT", projects),
    recovery: join(dirname(database), "artifact-recovery"),
  };
}

export async function assertSourceStopped(source) {
  const ports = new Set([3210, Number(source.environment.PORT)].filter((port) => Number.isInteger(port) && port > 0 && port < 65536));
  for (const port of ports) {
    const active = await new Promise((resolvePromise) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      const end = (value) => { socket.destroy(); resolvePromise(value); };
      socket.setTimeout(700, () => end(false)); socket.once("connect", () => end(true)); socket.once("error", () => end(false));
    });
    if (active) throw new Error("旧版服务仍在运行，请退出旧版并停止其守护程序后再迁移");
  }
  if (process.platform === "win32") {
    const result = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|powershell|pwsh|SuperCanvas)\\.exe$' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 15000 });
    const rows = JSON.parse(result.stdout.trim() || "[]");
    const active = (Array.isArray(rows) ? rows : [rows]).some((row) => row.ProcessId !== process.pid && row.CommandLine?.toLowerCase().includes(source.root.toLowerCase()));
    if (active) throw new Error("检测到使用旧项目目录的进程，请关闭旧版服务及守护程序后重试");
  }
}

export function validateSnapshot(snapshot, masterKey) {
  const arrays = ["canvases", "revisions", "assets", "connections", "runs", "nodeRuns", "webhookKeys"];
  if (![1, 2].includes(snapshot?.version) || arrays.some((key) => !Array.isArray(snapshot[key]))) throw new Error("不支持的本地数据库格式");
  if (snapshot.version === 2 && ["directorProfiles", "directorSessions", "directorMessages", "directorProposals"].some((key) => !Array.isArray(snapshot[key]))) throw new Error("导演数据不完整");
  if (snapshot.runs.some((run) => ["queued", "running"].includes(run.status))) throw new Error("旧版仍有未完成任务，请先完成或取消任务再迁移");
  validateCredentials(snapshot, masterKey);
}

function validateCredentials(value, masterKey) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["encryptedSecret", "encryptedApiKey"].includes(key) && typeof child === "string" && child) {
      try { decryptSecret(child, masterKey); } catch { throw new Error("原主密钥无法解密连接或历史任务，迁移已停止；请检查旧版环境文件"); }
    } else if (typeof child === "object") validateCredentials(child, masterKey);
  }
}

const storageObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const validAnchor = (value) => storageObject(value) && typeof value.transactionId === "string" && value.transactionId.length > 0
  && typeof value.sha256 === "string" && /^[a-f0-9]{64}$/u.test(value.sha256);
const sameAnchor = (left, right) => validAnchor(left) && validAnchor(right) && left.transactionId === right.transactionId && left.sha256 === right.sha256;
const invalidSidecars = () => { throw new Error("数据库独立状态或核验证据缺失、损坏或身份不符，迁移已停止；请保留完整原资料"); };

async function readStorageObject(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) invalidSidecars();
  const raw = await readFile(path);
  return { raw, value: JSON.parse(raw.toString("utf8")) };
}

/** Validate only by reading. Do not instantiate a repository here: importing
 * must never migrate, finalize, scan or otherwise write the selected source. */
export async function validateDatabaseSidecars(database, snapshot, masterKey) {
  const [pipelineRoot, evidenceRoot] = databaseSidecarRoots(database), settings = snapshot.applicationSettings ?? {};
  try {
    for (const root of [pipelineRoot, evidenceRoot]) {
      const info = await lstat(root).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
      if (info && (info.isSymbolicLink() || !info.isDirectory())) invalidSidecars();
    }
    const marker = settings["supplierCatalogPipelineStorage:v1"];
    if (marker !== undefined) {
      if (!storageObject(marker) || marker.schemaVersion !== 1 || !storageObject(marker.entries)) invalidSidecars();
      for (const [key, anchor] of Object.entries(marker.entries)) {
        if (!(key.startsWith("supplierCatalogPipeline:") || key === "supplier-catalog-pipeline-notice-cursors:v1")
          || !validAnchor(anchor) || Object.hasOwn(settings, key)) invalidSidecars();
        const { value: document } = await readStorageObject(join(pipelineRoot, `${hash(key)}.json`));
        if (!storageObject(document) || document.schemaVersion !== 1 || document.key !== key) invalidSidecars();
        for (const version of [document.committed, document.prepared]) {
          if (version === undefined) continue;
          if (!storageObject(version) || !validAnchor(version.anchor) || !Number.isSafeInteger(version.sequence) || version.sequence < 1
            || typeof version.transactionId !== "string" || !version.transactionId || hash(JSON.stringify(version.value)) !== version.sha256) invalidSidecars();
        }
        if (document.prepared && (document.prepared.transactionId !== document.prepared.anchor.transactionId
          || document.prepared.sha256 !== document.prepared.anchor.sha256)) invalidSidecars();
        const selected = sameAnchor(document.prepared?.anchor, anchor) ? document.prepared : document.committed;
        if (!selected || !sameAnchor(selected.anchor, anchor)) invalidSidecars();
      }
    }
    const references = settings["supplierVerificationEvidenceStorage:v1"];
    if (references !== undefined && (!storageObject(references) || references.schemaVersion !== 1 || !storageObject(references.entries))) invalidSidecars();
    const seen = new Set();
    for (const row of snapshot.supplierVerifications ?? []) {
      if (seen.has(row.id)) invalidSidecars(); seen.add(row.id);
      const reference = references && Object.hasOwn(references.entries, row.id) ? references.entries[row.id] : undefined;
      if (!reference) { if (row.verificationEvidenceStorageVersion !== undefined) invalidSidecars(); continue; }
      if (!storageObject(reference) || reference.schemaVersion !== 1 || reference.id !== row.id
        || !Number.isSafeInteger(reference.revision) || reference.revision < 0 || typeof reference.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(reference.sha256)
        || !Number.isSafeInteger(reference.byteLength) || reference.byteLength < 2
        || row.verificationEvidenceStorageVersion !== 1 || row.revision !== reference.revision) invalidSidecars();
      const { raw, value: record } = await readStorageObject(join(evidenceRoot, `${reference.sha256}.json`));
      if (raw.length !== reference.byteLength || hash(raw) !== reference.sha256 || !storageObject(record) || record.id !== reference.id
        || record.revision !== reference.revision || record.schemaVersion !== 1 || !Array.isArray(record.cases)
        || !Array.isArray(record.evidence) || !Array.isArray(record.skipped)) invalidSidecars();
      validateCredentials(record, masterKey);
    }
    if (references && Object.keys(references.entries).some(id => !seen.has(id))) invalidSidecars();
  } catch (error) {
    if (error.message?.startsWith("原主密钥无法解密")) throw error;
    invalidSidecars();
  }
}

async function treeManifest(root, withHashes = false) {
  const result = [];
  const rootInfo = await lstat(root).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
  if (!rootInfo) return result;
  if (rootInfo.isSymbolicLink()) throw new Error("迁移目录包含符号链接，请先将素材整理为实际文件");
  if (!rootInfo.isDirectory()) throw new Error("迁移目录不是实际文件夹");
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      const info = await lstat(file);
      if (info.isSymbolicLink()) throw new Error("迁移目录包含符号链接，请先将素材整理为实际文件");
      if (info.isDirectory()) await walk(file);
      else if (info.isFile()) result.push({ key: relative(root, file), size: info.size, modified: info.mtimeMs,
        ...(withHashes ? { sha256: hash(await readFile(file)) } : {}) });
      else throw new Error("迁移目录包含非普通文件");
    }
  };
  await walk(root);
  return result.sort((a, b) => a.key.localeCompare(b.key));
}

async function copyTree(source, target, manifest) {
  await mkdir(target, { recursive: true });
  for (const file of manifest) {
    const to = within(target, file.key);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(within(source, file.key), to);
    if ((await stat(to)).size !== file.size) throw new Error("素材复制校验失败");
    if (file.sha256 && hash(await readFile(to)) !== file.sha256) throw new Error("数据库独立文件复制校验失败");
  }
}

export async function loadProfile(root, decrypt) {
  const profile = join(root, "profile");
  if (!await exists(profile)) return null;
  if (!await exists(join(profile, "initialized.json"))) throw new Error("资料目录不完整，请保留目录并从迁移备份恢复");
  try {
    const secrets = JSON.parse(await decrypt(await readFile(join(profile, "secrets.bin"))));
    if (typeof secrets.masterKey !== "string" || !secrets.masterKey) throw new Error();
    return secrets;
  } catch { throw new Error("无法解密本机资料密钥，请使用原 Windows 账户打开；不会自动重置密钥"); }
}

export async function initializeProfile(root, { source, encrypt, ensureStopped = assertSourceStopped }) {
  if (await exists(join(root, "profile"))) throw new Error("桌面资料库已经存在，不能重复导入或覆盖");
  await mkdir(root, { recursive: true });
  const stage = within(root, `migration-${randomUUID()}`);
  try {
    await mkdir(join(stage, "data"), { recursive: true });
    let secrets = { masterKey: newMasterKey(), network: {} };
    let summary = { source: null, createdAt: new Date().toISOString() };
    if (source) {
      await ensureStopped(source);
      if ((await lstat(source.database)).isSymbolicLink()) throw new Error("迁移数据库包含符号链接，请先整理为实际文件");
      const raw = await readFile(source.database);
      const snapshot = JSON.parse(raw.toString("utf8").replace(/^\uFEFF/, ""));
      const masterKey = source.environment.MASTER_KEY || "local-development-master-key";
      validateSnapshot(snapshot, masterKey);
      await validateDatabaseSidecars(source.database, snapshot, masterKey);
      const network = Object.fromEntries(NETWORK_KEYS.filter((key) => source.environment[key]).map((key) => [key, source.environment[key]]));
      secrets = { masterKey, network };
      const sourceSidecars = databaseSidecarRoots(source.database);
      const entries = [[source.storage, "storage"], [source.projects, "projects"], [source.recovery, "data/artifact-recovery"],
        [sourceSidecars[0], "data/catalog-pipeline", true], [sourceSidecars[1], "data/supplier-verification-evidence", true]];
      const before = await Promise.all(entries.map(([path, , hashes]) => treeManifest(path, hashes)));
      for (let i = 0; i < entries.length; i++) await copyTree(entries[i][0], join(stage, entries[i][1]), before[i]);
      for (const asset of snapshot.assets) {
        if (asset.deleted) continue;
        if (typeof asset.storageKey !== "string") throw new Error("素材索引不完整");
        const file = within(join(stage, "storage"), asset.storageKey);
        if (!await exists(file) || (await stat(file)).size !== asset.size) throw new Error(`素材缺失或大小不符：${asset.id}`);
      }
      await writeFile(join(stage, "data/super-canvas.json"), raw);
      await mkdir(join(stage, "backups"), { recursive: true });
      await writeFile(join(stage, "backups/imported-database.json"), raw);
      // The legacy backup filename remains, with its matching auxiliary roots.
      // A copied main JSON alone is no longer a complete database backup.
      for (let i = 0; i < sourceSidecars.length; i++) {
        const suffix = i === 0 ? "catalog-pipeline" : "supplier-verification-evidence";
        await copyTree(sourceSidecars[i], join(stage, `backups/imported-database.json.${suffix}`), before[i + 3]);
      }
      await ensureStopped(source);
      const after = await Promise.all(entries.map(([path, , hashes]) => treeManifest(path, hashes)));
      if (hash(await readFile(source.database)) !== hash(raw) || JSON.stringify(before) !== JSON.stringify(after)) throw new Error("迁移期间旧版数据发生变化，请停止旧版后重试");
      await validateDatabaseSidecars(join(stage, "data/super-canvas.json"), snapshot, masterKey);
      await validateDatabaseSidecars(join(stage, "backups/imported-database.json"), snapshot, masterKey);
      summary = { ...summary, source: source.root, databaseSha256: hash(raw), canvases: snapshot.canvases.length, assets: snapshot.assets.length, publicAssetChannel: source.environment.PUBLIC_BASE_URL ? "requires-reconfiguration" : "not-configured" };
    }
    await mkdir(join(stage, "storage"), { recursive: true });
    await mkdir(join(stage, "projects"), { recursive: true });
    await writeFile(join(stage, "secrets.bin"), await encrypt(JSON.stringify(secrets)));
    await writeFile(join(stage, "initialized.json"), JSON.stringify(summary, null, 2));
    await rename(stage, join(root, "profile"));
    return secrets;
  } finally {
    // Only the uniquely owned staging directory is removed. The original
    // installation and an activated profile are never cleanup targets.
    await rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}
