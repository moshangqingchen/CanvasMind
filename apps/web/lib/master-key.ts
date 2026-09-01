import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let localEnvChecked = false;

const LOCAL_RUNTIME_ENV_KEYS = [
  "PROVIDER_HTTP_PROXY",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NODE_USE_ENV_PROXY",
  "PUBLIC_BASE_URL",
] as const;

function localEnvFileCandidates(): string[] {
  if (process.env.SUPERCANVAS_ENV_FILE)
    return [process.env.SUPERCANVAS_ENV_FILE];
  // The web package is commonly started with cwd=apps/web, while the
  // workspace launcher starts from the repository root. Check both layouts
  // (and the historical two-level path) so direct `pnpm dev` has the same
  // public asset URL and proxy settings as the managed launcher.
  return [
    resolve(process.cwd(), ".local-public.env"),
    resolve(process.cwd(), "..", ".local-public.env"),
    resolve(process.cwd(), "..", "..", ".local-public.env"),
  ];
}

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

function loadLocalNetworkEnvironment(): void {
  const candidates = localEnvFileCandidates();
  // A package-local env file may contain only proxy settings while the
  // repository-level file contains PUBLIC_BASE_URL (or vice versa). Walk all
  // candidates so missing keys are filled without overriding existing values.
  for (const path of new Set(candidates)) {
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const values = new Map<string, string>();
    for (const line of content.split(/\r?\n/u)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
      if (
        match &&
        LOCAL_RUNTIME_ENV_KEYS.includes(
          match[1] as (typeof LOCAL_RUNTIME_ENV_KEYS)[number],
        )
      )
        values.set(match[1], match[2]?.trim() ?? "");
    }
    for (const key of LOCAL_RUNTIME_ENV_KEYS) {
      if (process.env[key]?.trim()) continue;
      const value = values.get(key);
      if (value) process.env[key] = value;
    }
  }
}

/**
 * Keep every local server mode on the same credential master key. This avoids
 * writing the shared JSON database with the development fallback while the
 * production launcher uses `.local-public.env`.
 */
export function serverMasterKey(): string | undefined {
  // Also load the local proxy settings when the app is started with `pnpm
  // dev` instead of the managed launcher. Provider requests to hosts resolved
  // through a TUN/Fake-IP adapter otherwise fail with EACCES before connect.
  loadLocalNetworkEnvironment();
  if (process.env.MASTER_KEY) return process.env.MASTER_KEY;

  if (!localEnvChecked) {
    localEnvChecked = true;
    const candidates = localEnvFileCandidates();

    for (const path of new Set(candidates)) {
      const value = masterKeyFromEnvFile(path);
      if (!value) continue;
      process.env.MASTER_KEY = value;
      return value;
    }
  }

  if (process.env.NODE_ENV === "production") return undefined;
  return "local-development-master-key";
}

export function requireServerMasterKey(): string {
  const masterKey = serverMasterKey();
  if (!masterKey)
    throw new Error("MASTER_KEY is required to protect provider credentials");
  return masterKey;
}
