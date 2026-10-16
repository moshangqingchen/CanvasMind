import type { FullConfig } from "@playwright/test";
import p0MemoryGlobalSetup from "./p0-memory-global-setup";

export default async function settingsRetentionGlobalSetup(config: FullConfig) {
  if (process.env.P0_SETTINGS_RETENTION !== "1") return;
  if (process.env.P0_MEMORY_ALLOW_INVALID_DIAGNOSTIC === "1")
    throw new Error("UI cycle retention diagnostic must keep the 6 GiB gate");
  // Reuse the owned server/profile/network guards without editing their opt-in
  // condition or any configuration used by the concurrent formal matrix.
  const previous = process.env.P0_MEMORY_RETENTION;
  process.env.P0_MEMORY_RETENTION = "1";
  try { return await p0MemoryGlobalSetup(config); }
  finally {
    if (previous === undefined) delete process.env.P0_MEMORY_RETENTION;
    else process.env.P0_MEMORY_RETENTION = previous;
  }
}
