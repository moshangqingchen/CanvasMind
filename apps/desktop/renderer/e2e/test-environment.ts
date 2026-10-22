import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Isolate generated assets inside the project, away from real user profiles. */
export async function createTestEnvironment(
  baseURL: string,
  token: string,
  inherited: Record<string, string | undefined> = process.env,
) {
  const workspace = await realpath(
    fileURLToPath(new URL("../../../../", import.meta.url)),
  );
  const temporaryRoot = join(workspace, ".codex-temp");
  await mkdir(temporaryRoot, { recursive: true });
  if ((await realpath(temporaryRoot)) !== temporaryRoot)
    throw new Error("E2E temporary directory must stay in the workspace");
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
      SUPERCANVAS_REFERENCE_CHANNEL_FILE: join(
        root,
        "reference-channel-status.json",
      ),
      SUPPLIER_AUTO_VERIFY: "off",
      SUPERCANVAS_DESKTOP: "true",
      SUPERCANVAS_DESKTOP_TOKEN: token,
      SUPERCANVAS_DESKTOP_ORIGIN: baseURL,
      MASTER_KEY: "e2e-local-master-key",
    },
    async cleanup() {
      // Only delete the unique directory created above, after stopping its server.
      let canonicalRoot: string;
      try {
        canonicalRoot = await realpath(root);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      if (
        dirname(canonicalRoot) !== temporaryRoot ||
        !basename(root).startsWith("supercanvas-e2e-")
      )
        throw new Error("Invalid E2E temporary directory");
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    },
  };
}
