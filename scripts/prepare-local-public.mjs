import { randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(scriptDir, "..");
const dataPath = join(workspace, "apps", "web", "data", "super-canvas.json");
const storagePath = join(workspace, "apps", "web", "storage");
const envPath = join(workspace, ".local-public.env");
const credentialsModule = join(
  workspace,
  "packages",
  "providers",
  "dist",
  "credentials.js",
);
const { decryptSecret, encryptSecret } = await import(
  pathToFileURL(credentialsModule).href
);

const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
const backupDirectory = join(workspace, "backups", `local-public-${timestamp}`);
const backupPath = join(backupDirectory, "super-canvas.json");
const temporaryPath = `${dataPath}.local-public.tmp`;
const oldMasterKey = "local-development-master-key";
let existingEnv = "";
try {
  existingEnv = await readFile(envPath, "utf8");
} catch {
  // First-time setup has no environment file yet.
}
const existingMasterKey = existingEnv
  .split(/\r?\n/u)
  .find((line) => line.startsWith("MASTER_KEY="))
  ?.slice("MASTER_KEY=".length)
  .trim();
const targetMasterKey =
  existingMasterKey || `base64:${randomBytes(32).toString("base64")}`;

const database = JSON.parse(await readFile(dataPath, "utf8"));
if (!Array.isArray(database.connections)) {
  throw new Error("画布数据库缺少 connections 数组，已停止迁移");
}

let migratedConnections = 0;
for (const connection of database.connections) {
  if (
    !connection ||
    typeof connection !== "object" ||
    typeof connection.encryptedSecret !== "string"
  ) {
    continue;
  }
  try {
    decryptSecret(connection.encryptedSecret, targetMasterKey);
    continue;
  } catch {
    try {
      const plaintext = decryptSecret(connection.encryptedSecret, oldMasterKey);
      connection.encryptedSecret = encryptSecret(plaintext, targetMasterKey);
      migratedConnections += 1;
    } catch {
      throw new Error(
        `连接 ${connection.id ?? "unknown"} 的密钥无法使用当前或旧开发主密钥解密，已停止迁移`,
      );
    }
  }
}

await mkdir(backupDirectory, { recursive: true });
await copyFile(dataPath, backupPath);
await writeFile(
  temporaryPath,
  `${JSON.stringify(database, null, 2)}\n`,
  "utf8",
);
await rename(temporaryPath, dataPath);

const envLines = [
  `MASTER_KEY=${targetMasterKey}`,
  "USE_MEMORY_STORE=true",
  `LOCAL_DATABASE_PATH=${dataPath}`,
  `LOCAL_STORAGE_PATH=${storagePath}`,
  "RUN_IN_PROCESS=true",
  "PUBLIC_BASE_URL=https://815rongai.com",
  "NEXT_PUBLIC_APP_NAME=超级画布",
];
await writeFile(envPath, `${envLines.join("\n")}\n`, {
  encoding: "utf8",
  mode: 0o600,
});

process.stdout.write(
  JSON.stringify({
    backupPath,
    envPath,
    migratedConnections,
  }),
);
