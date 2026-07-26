import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let localEnvChecked = false;

function masterKeyFromEnvFile(path: string): string | undefined {
  try {
    const content = readFileSync(path, "utf8");
    const line = content
      .split(/\r?\n/u)
      .find((item) => item.trimStart().startsWith("MASTER_KEY="));
    const value = line?.slice(line.indexOf("=") + 1).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Keep every local server mode on the same credential master key. This avoids
 * writing the shared JSON database with the development fallback while the
 * production launcher uses `.local-public.env`.
 */
export function serverMasterKey(): string | undefined {
  if (process.env.MASTER_KEY) return process.env.MASTER_KEY;
  if (process.env.NODE_ENV === "production") return undefined;

  if (!localEnvChecked) {
    localEnvChecked = true;
    const candidates = [
      process.env.SUPERCANVAS_ENV_FILE,
      resolve(process.cwd(), ".local-public.env"),
      resolve(process.cwd(), "..", "..", ".local-public.env"),
    ].filter((item): item is string => Boolean(item));

    for (const path of new Set(candidates)) {
      const value = masterKeyFromEnvFile(path);
      if (!value) continue;
      process.env.MASTER_KEY = value;
      return value;
    }
  }

  return "local-development-master-key";
}

export function requireServerMasterKey(): string {
  const masterKey = serverMasterKey();
  if (!masterKey)
    throw new Error("MASTER_KEY is required to protect provider credentials");
  return masterKey;
}
