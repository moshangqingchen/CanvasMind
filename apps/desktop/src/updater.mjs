import { UPDATE_INTERVAL, UPDATE_REPOSITORY } from "./policy.mjs";
import { differentialFallbackReason, observeUpdateDownloads, updateFailureDiagnostic } from "./update-download-observer.mjs";
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
  constructor(updater, version, { changed = () => {}, apply = async () => {}, diagnostic = () => {}, packaged = true, currentNotes = "", now = Date.now } = {}) {
    this.updater = updater; this.changed = changed; this.apply = apply; this.diagnostic = diagnostic; this.now = now;
    this.status = { formatVersion: 1, desktop: true, enabled: packaged, managerAvailable: packaged, repository: UPDATE_REPOSITORY, intervalSeconds: UPDATE_INTERVAL / 1000, currentVersion: version, currentNotes, phase: packaged ? "idle" : "disabled", updatedAt: new Date().toISOString() };
    updater.autoDownload = false; updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false; updater.allowDowngrade = false; updater.fullChangelog = true;
    this.downloadObserver = observeUpdateDownloads(updater, {
      differential: () => {
        if (this.status.phase !== "downloading") return;
        this.fallbackDiagnostic = undefined;
        this.downloadMode("differential");
      },
      fallback: value => { if (this.status.phase === "downloading") this.fallbackDiagnostic = value; },
      differentialResult: needsFull => {
        if (this.status.phase !== "downloading" || needsFull !== true) return;
        const fallback = this.fallbackDiagnostic;
        this.downloadMode("full", { fallback: true, reason: differentialFallbackReason(fallback) });
        if (fallback) { this.patch({ diagnostic: fallback }); this.record("fallback", fallback); }
      },
      full: () => { if (this.status.phase === "downloading" && this.status.download?.mode !== "full") this.downloadMode("full"); },
    });
    updater.on("checking-for-update", () => this.patch({ phase: "checking", error: undefined }));
    const summary = info => ({ version: info.version, tag: "v" + info.version, publishedAt: info.releaseDate, htmlUrl: "https://github.com/" + UPDATE_REPOSITORY + "/releases/tag/v" + encodeURIComponent(info.version), notes: releaseNotes(info) || undefined });
    const checked = () => ({ error: undefined, lastCheckedAt: new Date().toISOString(), lastSuccessfulCheckAt: new Date().toISOString() });
    updater.on("update-available", info => {
      this.patch({ ...checked(), latest: summary(info), phase: this.status.deferredVersion === info.version ? "idle" : "available", diagnostic: undefined });
      this.record("check-complete", { stage: "check" });
    });
    updater.on("update-not-available", () => { this.patch({ ...checked(), latest: undefined, phase: "idle", diagnostic: undefined }); this.record("check-complete", { stage: "check" }); });
    updater.on("download-progress", value => this.progress(value));
    updater.on("update-downloaded", info => {
      this.stopProgressTimer();
      if (this.status.download?.mode === "preparing" && this.downloadObserver.canConfirmCache) this.downloadMode("cached");
      this.patch({ phase: "ready", latest: summary(info), downloadedVersion: info.version, error: undefined, progress: undefined, diagnostic: undefined });
      this.record("download-complete", { stage: "verify" });
    });
    updater.on("error", error => this.fail(error));
  }
  patch(value) {
    Object.assign(this.status, value, { updatedAt: new Date().toISOString() });
    try { this.changed(this.snapshot()); } catch { /* UI notification cannot interrupt an update. */ }
  }
  record(event, details = {}) {
    const record = { event, phase: this.status.phase, currentVersion: this.status.currentVersion, targetVersion: this.status.latest?.version, mode: this.status.download?.mode, ...details };
    try { Promise.resolve(this.diagnostic(record)).catch(() => {}); } catch { /* Logs are best effort. */ }
  }
  downloadMode(mode, details = {}) {
    this.stopProgressTimer();
    this.lastProgress = undefined;
    this.patch({ download: { mode, ...details }, progress: undefined });
    this.record("download-mode", { stage: "download" });
  }
  progress(value) {
    if (this.status.phase !== "downloading") return;
    const finiteBytes = input => typeof input === "number" && Number.isFinite(input) && input >= 0 ? input : undefined;
    const downloadedBytes = finiteBytes(value?.transferred) ?? 0;
    const totalBytes = finiteBytes(value?.total);
    const bytesPerSecond = finiteBytes(value?.bytesPerSecond);
    const estimatedRemainingSeconds = totalBytes > 0 && bytesPerSecond > 0 ? Math.ceil(Math.max(0, totalBytes - downloadedBytes) / bytesPerSecond) : undefined;
    this.lastProgress = { at: this.now() };
    this.patch({ progress: { downloadedBytes, ...(totalBytes ? { totalBytes } : {}), ...(bytesPerSecond !== undefined ? { bytesPerSecond } : {}), ...(Number.isFinite(estimatedRemainingSeconds) ? { estimatedRemainingSeconds } : {}) } });
    if (!this.progressTimer) {
      this.progressTimer = setInterval(() => this.refreshProgress(), 1000);
      this.progressTimer.unref?.();
    }
  }
  refreshProgress() {
    if (this.status.phase === "downloading" && this.status.progress && this.lastProgress && this.now() - this.lastProgress.at >= 10_000 && this.status.progress.bytesPerSecond !== 0) {
      this.patch({ progress: { ...this.status.progress, bytesPerSecond: 0, estimatedRemainingSeconds: undefined } });
    }
  }
  stopProgressTimer() { if (this.progressTimer) clearInterval(this.progressTimer); this.progressTimer = undefined; }
  fail(error, stage = this.status.phase === "checking" ? "check" : ["applying", "waiting_for_idle"].includes(this.status.phase) ? "apply" : "download") {
    // Upstream emits the same error before rejecting its operation Promise.
    if (this.status.phase === "failed" && this.lastFailure === error) return;
    this.lastFailure = error;
    const diagnostic = updateFailureDiagnostic(error, stage);
    this.stopProgressTimer();
    this.patch({ phase: "failed", error: userFacingError(error), lastCheckedAt: new Date().toISOString(), progress: undefined, diagnostic });
    this.record("error", diagnostic);
  }
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
      this.stopProgressTimer();
      this.lastFailure = undefined;
      this.patch({ phase: "checking", error: undefined, diagnostic: undefined, progress: undefined, download: undefined });
      this.record("check-start", { stage: "check" });
      try { await this.updater.checkForUpdates(); } catch (error) { this.fail(error, "check"); }
    } else if (action === "download") {
      if (!this.status.latest || !["available", "idle", "failed"].includes(this.status.phase)) throw new Error("请先检查可下载的更新");
      this.stopProgressTimer(); this.lastProgress = undefined; this.fallbackDiagnostic = undefined;
      this.lastFailure = undefined;
      this.patch({ phase: "downloading", download: { mode: "preparing" }, progress: undefined, error: undefined, diagnostic: undefined, downloadedVersion: undefined });
      this.record("download-start", { stage: "download" });
      void this.updater.downloadUpdate().catch(error => this.fail(error, "download"));
    } else {
      if (this.status.phase !== "ready") throw new Error("更新尚未下载完成");
      try { await this.apply(); } catch (error) {
        const diagnostic = updateFailureDiagnostic(error, "apply");
        this.patch({ diagnostic }); this.record("error", diagnostic); throw error;
      }
    }
  }
}
