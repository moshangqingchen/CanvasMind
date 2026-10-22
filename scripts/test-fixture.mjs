import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Maintenance fixtures remain inside the project and never use user data. */
export async function createMaintenanceFixture(t, prefix) {
  if (!/^[a-z0-9-]+$/u.test(prefix)) throw new Error("Invalid fixture prefix");
  const workspace = await realpath(
    fileURLToPath(new URL("../", import.meta.url)),
  );
  const temporaryRoot = path.join(workspace, ".codex-temp");
  await mkdir(temporaryRoot, { recursive: true });
  if ((await realpath(temporaryRoot)) !== temporaryRoot)
    throw new Error(
      "Maintenance temporary directory must stay in the workspace",
    );
  const root = await mkdtemp(path.join(temporaryRoot, prefix));
  t.after(async () => {
    if (
      path.dirname(await realpath(root)) !== temporaryRoot ||
      !path.basename(root).startsWith(prefix)
    )
      throw new Error("Invalid maintenance fixture directory");
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  });
  return root;
}
