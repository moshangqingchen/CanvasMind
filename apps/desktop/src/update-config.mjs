import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { UPDATE_OWNER, UPDATE_REPO } from "./policy.mjs";

export async function configureUpdates(updater, resourcesPath, dataRoot) {
  const feed = { provider: "github", owner: UPDATE_OWNER, repo: UPDATE_REPO };
  let configPath = join(resourcesPath, "app-update.yml");
  try { await access(configPath); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    // Downloads also read this file. Preserve existing packaged signing policy.
    await mkdir(dataRoot, { recursive: true });
    configPath = join(dataRoot, "app-update.yml");
    await writeFile(configPath, JSON.stringify({ ...feed, updaterCacheDirName: "@super-canvasdesktop-updater" }));
  }
  updater.updateConfigPath = configPath;
  updater.setFeedURL(feed);
  return configPath;
}
