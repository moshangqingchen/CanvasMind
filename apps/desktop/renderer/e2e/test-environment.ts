import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

/** Keep generated assets and project archives out of both the workspace and user profile. */
export async function createTestEnvironment(
  baseURL: string,
  token: string,
  inherited: Record<string, string | undefined> = process.env,
) {
  const temporaryRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(temporaryRoot, "supercanvas-e2e-"));
  return {
    root,
    env: {
      ...inherited,
      NODE_ENV: "production" as const,
      USE_MEMORY_STORE: "ephemeral",
      LOCAL_DATABASE_PATH: join(root, "data", "super-canvas.json"),
      LOCAL_STORAGE_PATH: join(root, "storage"),
      SUPERCANVAS_PROJECT_ROOT: join(root, "projects"),
      SUPERCANVAS_RECOVERY_ROOT: join(root, "data", "artifact-recovery"),
      SUPERCANVAS_REFERENCE_CHANNEL_FILE: join(root, "reference-channel-status.json"),
      SUPPLIER_AUTO_VERIFY: "off",
      SUPERCANVAS_DESKTOP: "true",
      SUPERCANVAS_DESKTOP_TOKEN: token,
      SUPERCANVAS_DESKTOP_ORIGIN: baseURL,
      MASTER_KEY: "e2e-local-master-key",
    },
    async cleanup() {
      // Only delete the unique directory created above, after stopping its server.
      if (dirname(root) !== temporaryRoot || !basename(root).startsWith("supercanvas-e2e-"))
        throw new Error("Invalid E2E temporary directory");
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    },
  };
}
