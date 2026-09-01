import { randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(scriptDir, "..");
const webRoot = join(workspace, "apps", "web");
const defaultDataPath = join(webRoot, "data", "super-canvas.json");
const defaultStoragePath = join(webRoot, "storage");
const envPath = join(workspace, ".local-public.env");
const credentialsModule = join(
  workspace,
  "packages",
  "providers",
  "dist",
  "credentials.js",
);
const oldMasterKey = "local-development-master-key";
let existingEnv = "";
try {
  existingEnv = await readFile(envPath, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  // First-time setup has no environment file yet.
}

const envLines = existingEnv.replace(/^\uFEFF/u, "").split(/\r?\n/u);
while (envLines.at(-1) === "") envLines.pop();

function assignment(line) {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
  return match ? { key: match[1], value: match[2] } : undefined;
}

function envValue(key) {
  for (let index = envLines.length - 1; index >= 0; index -= 1) {
    const parsed = assignment(envLines[index]);
    if (parsed?.key === key) return parsed.value.trim();
  }
  return undefined;
}

function setDefault(key, value, replaceEmpty = false) {
  for (let index = envLines.length - 1; index >= 0; index -= 1) {
    const parsed = assignment(envLines[index]);
    if (parsed?.key !== key) continue;
    if (replaceEmpty && !parsed.value.trim())
      envLines[index] = `${key}=${value}`;
    return;
  }
  envLines.push(`${key}=${value}`);
}

function resolveFromWebRoot(configured, fallback) {
  return configured ? resolve(webRoot, configured) : fallback;
}

const existingMasterKey = envValue("MASTER_KEY");
const targetMasterKey =
  existingMasterKey || `base64:${randomBytes(32).toString("base64")}`;
const dataPath = resolveFromWebRoot(
  envValue("LOCAL_DATABASE_PATH"),
  defaultDataPath,
);
const storagePath = resolveFromWebRoot(
  envValue("LOCAL_STORAGE_PATH"),
  defaultStoragePath,
);
const repositoryMode = envValue("USE_MEMORY_STORE");
const usesFileRepository =
  repositoryMode !== "ephemeral" &&
  (repositoryMode !== "false" || !envValue("DATABASE_URL"));

let database;
let initializedDatabase = false;
if (usesFileRepository) {
  try {
    database = JSON.parse(await readFile(dataPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    database = {
      version: 1,
      canvases: [],
      revisions: [],
      assets: [],
      connections: [],
      runs: [],
      nodeRuns: [],
      webhookKeys: [],
    };
    initializedDatabase = true;
  }
  if (!Array.isArray(database.connections)) {
    throw new Error("画布数据库缺少 connections 数组，已停止迁移");
  }
}

let migratedConnections = 0;
if (database) {
  const encryptedConnections = database.connections.filter(
    (connection) =>
      connection &&
      typeof connection === "object" &&
      typeof connection.encryptedSecret === "string",
  );
  if (encryptedConnections.length > 0) {
    const { decryptSecret, encryptSecret } = await import(
      pathToFileURL(credentialsModule).href
    );
    for (const connection of encryptedConnections) {
      try {
        decryptSecret(connection.encryptedSecret, targetMasterKey);
        continue;
      } catch {
        try {
          const plaintext = decryptSecret(
            connection.encryptedSecret,
            oldMasterKey,
          );
          connection.encryptedSecret = encryptSecret(
            plaintext,
            targetMasterKey,
          );
          migratedConnections += 1;
        } catch {
          throw new Error(
            `连接 ${connection.id ?? "unknown"} 的密钥无法使用当前或旧开发主密钥解密，已停止迁移`,
          );
        }
      }
    }
  }
}

let backupPath;
if (database && (initializedDatabase || migratedConnections > 0)) {
  await mkdir(dirname(dataPath), { recursive: true });
  if (!initializedDatabase) {
    const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
    const backupDirectory = join(
      workspace,
      "backups",
      `local-public-${timestamp}`,
    );
    backupPath = join(backupDirectory, "super-canvas.json");
    await mkdir(backupDirectory, { recursive: true });
    await copyFile(dataPath, backupPath);
  }
  const temporaryPath = `${dataPath}.local-public.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(database, null, 2)}\n`,
    "utf8",
  );
  await rename(temporaryPath, dataPath);
}

if (!envValue("S3_ENDPOINT")) {
  await mkdir(storagePath, { recursive: true });
}

setDefault("MASTER_KEY", targetMasterKey, true);
setDefault("USE_MEMORY_STORE", "true");
setDefault("LOCAL_DATABASE_PATH", dataPath);
setDefault("LOCAL_STORAGE_PATH", storagePath);
setDefault("RUN_IN_PROCESS", "true");
setDefault("NEXT_PUBLIC_LOCAL_DOWNLOAD_ORIGIN", "http://127.0.0.1:3210");
setDefault("NEXT_PUBLIC_APP_NAME", "超级画布");

await writeFile(envPath, `${envLines.join("\n")}\n`, {
  encoding: "utf8",
  mode: 0o600,
});

process.stdout.write(
  JSON.stringify({
    backupPath: backupPath ?? null,
    dataPath: usesFileRepository ? dataPath : null,
    envPath,
    initializedDatabase,
    migratedConnections,
  }),
);
