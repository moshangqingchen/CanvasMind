import { UPDATE_INTERVAL, UPDATE_REPOSITORY } from "./policy.mjs";
function releaseNotes(info) {
  if (typeof info?.releaseNotes === "string") return info.releaseNotes.trim();
  return Array.isArray(info?.releaseNotes) ? info.releaseNotes.map(item => typeof item === "string" ? item : item?.note ? (item.version ? "## v" + item.version + "\n" : "") + item.note : "").filter(Boolean).join("\n").trim() : "";
}
function userFacingError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/app-update\.yml/i.test(message)) return "更新配置不可用，请使用 GitHub Release 中的完整安装包覆盖安装。";
  if (/ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|latest\.yml.*404|No published versions/i.test(message)) return "GitHub 上暂时没有完整的桌面更新包，请等待发布完成后重试。";
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|net::/i.test(message)) return "暂时无法连接 GitHub，请检查网络后重试。";
  return "更新未完成，请重试，或从 GitHub Release 下载完整安装包。";
}
export class DesktopUpdater {
  constructor(updater, version, { changed = () => {}, apply = async () => {}, packaged = true, currentNotes = "" } = {}) {
    this.updater = updater; this.changed = changed; this.apply = apply;
    this.status = { formatVersion: 1, desktop: true, enabled: packaged, managerAvailable: packaged, repository: UPDATE_REPOSITORY, intervalSeconds: UPDATE_INTERVAL / 1000, currentVersion: version, currentNotes, phase: packaged ? "idle" : "disabled", updatedAt: new Date().toISOString() };
    updater.autoDownload = false; updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false; updater.allowDowngrade = false; updater.fullChangelog = true;
    updater.on("checking-for-update", () => this.patch({ phase: "checking", error: undefined }));
    const summary = info => ({ version: info.version, tag: "v" + info.version, publishedAt: info.releaseDate, htmlUrl: "https://github.com/" + UPDATE_REPOSITORY + "/releases/tag/v" + encodeURIComponent(info.version), notes: releaseNotes(info) || undefined });
    const checked = () => ({ error: undefined, lastCheckedAt: new Date().toISOString(), lastSuccessfulCheckAt: new Date().toISOString() });
    updater.on("update-available", info => this.patch({ ...checked(), latest: summary(info), phase: this.status.deferredVersion === info.version ? "idle" : "available" }));
    updater.on("update-not-available", () => this.patch({ ...checked(), latest: undefined, phase: "idle" }));
    updater.on("download-progress", value => this.patch({ phase: "downloading", progress: { downloadedBytes: value.transferred, totalBytes: value.total } }));
    updater.on("update-downloaded", info => this.patch({ phase: "ready", latest: summary(info), downloadedVersion: info.version, error: undefined }));
    updater.on("error", error => this.fail(error));
  }
  patch(value) { Object.assign(this.status, value, { updatedAt: new Date().toISOString() }); this.changed(this.snapshot()); }
  fail(error) { this.patch({ phase: "failed", error: userFacingError(error), lastCheckedAt: new Date().toISOString() }); }
  snapshot() { return structuredClone(this.status); }
  async action(action) {
    if (!["check", "download", "apply", "defer"].includes(action)) throw new Error("无效的更新操作");
    if (!this.status.enabled) throw new Error("开发模式不安装更新，请使用安装版验证");
    if (action === "defer") {
      if (["available", "idle"].includes(this.status.phase)) this.patch({ phase: "idle", deferredVersion: this.status.latest?.version });
      return;
    }
    if (action === "check") {
      if (["checking", "downloading", "ready", "waiting_for_idle", "applying"].includes(this.status.phase)) return;
      this.patch({ phase: "checking", error: undefined });
      try { await this.updater.checkForUpdates(); } catch (error) { this.fail(error); }
    } else if (action === "download") {
      if (!this.status.latest || !["available", "idle", "failed"].includes(this.status.phase)) throw new Error("请先检查可下载的更新");
      this.patch({ phase: "downloading", progress: undefined, error: undefined });
      void this.updater.downloadUpdate().catch(error => this.fail(error));
    } else {
      if (this.status.phase !== "ready") throw new Error("更新尚未下载完成");
      await this.apply();
    }
  }
}
