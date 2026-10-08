"use client";
import { createPortal } from "react-dom";
import { ArrowRight, Check, CircleAlert, Download, ExternalLink, RefreshCw, Sparkles, X } from "lucide-react";
import type { AppUpdateView } from "../lib/client-api";
import { useDialogFocus } from "./use-dialog-focus";
import styles from "./app-update-modal.module.css";
interface AppUpdateModalProps {
  open: boolean; status: AppUpdateView | null; busy?: boolean; onClose: () => void;
  onCheck: () => void; onDownload: () => void; onApply: () => void; onDefer: () => void;
  reloadReady?: boolean; onReload?: () => void;
}
// Feed HTML is converted to inert text, never mounted as remote markup.
function notesText(notes: string) {
  if (!/<(?:p|ul|li|h[1-6]|div|br)[\s>]/i.test(notes)) return notes;
  const doc = new DOMParser().parseFromString(notes, "text/html");
  doc.querySelectorAll("script,style,iframe,img").forEach(node => node.remove());
  doc.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach(node => { node.textContent = "\n## " + node.textContent + "\n"; });
  doc.querySelectorAll("li").forEach(node => { node.textContent = "\n- " + node.textContent + "\n"; });
  doc.querySelectorAll("p,br").forEach(node => node.append("\n"));
  return doc.body.textContent ?? "";
}
function ReleaseNotes({ notes }: { notes: string }) {
  const lines = notesText(notes).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return <div className={styles.notesText}>{lines.map((line, index) => {
    const heading = /^#{1,6}\s+/.test(line);
    const bullet = /^(?:[-*+] |\d+\. )/.test(line);
    const text = line.replace(/^#{1,6}\s+|^(?:[-*+] |\d+\. )/g, "").replace(/\*\*([^*]+)\*\*/g, "$1");
    return heading ? <h4 key={index}>{text}</h4> : <p key={index} className={bullet ? styles.bullet : undefined}>{text}</p>;
  })}</div>;
}
function dateLabel(value?: string) {
  return !value || Number.isNaN(Date.parse(value)) ? "" : new Date(value).toLocaleDateString("zh-CN");
}
function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function bytes(value: number) {
  const units = ["B", "KB", "MB", "GB"];
  const unit = Math.min(units.length - 1, value > 0 ? Math.max(0, Math.floor(Math.log(value) / Math.log(1024))) : 0);
  return `${(value / 1024 ** unit).toLocaleString("zh-CN", { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`;
}
function remainingTime(seconds: number) {
  if (seconds <= 1) return "正在完成下载…";
  if (seconds < 60) return `约 ${Math.ceil(seconds)} 秒`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `约 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return `约 ${hours} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ""}`;
}
const downloadLabels = {
  preparing: "准备下载",
  differential: "差分下载",
  full: "完整安装包",
  cached: "使用已校验缓存",
};
const stageLabels = { check: "检查版本", download: "下载安装包", verify: "校验安装包", apply: "安装更新" };
const categoryLabels = {
  network: "网络连接", timeout: "响应超时", "not-found": "更新资源不可用", http: "服务响应异常",
  cache: "缓存读写", checksum: "文件校验", signature: "签名验证", configuration: "更新配置", unknown: "尚未确认",
};
const failureDescriptions = {
  network: "暂时无法连接更新服务，请检查网络后重试。",
  timeout: "更新服务响应超时，请稍后重试。",
  "not-found": "更新资源暂时不可用，请重新检查版本。",
  http: "更新服务暂时无法完成请求，请稍后重试。",
  cache: "暂时无法读取或保存更新包，请重试下载。",
  checksum: "更新包未通过文件校验，请重新下载。",
  signature: "更新包未通过签名验证，请重新检查版本。",
  configuration: "更新配置暂时不可用，请重新检查版本。",
  unknown: "暂时无法完成更新，请重新检查或重试下载。",
};
const diagnosticCodes = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "EPIPE",
  "ENOENT", "EACCES", "EPERM", "EBUSY", "ENOSPC", "EIO", "ERR_ABORTED", "ERR_CONNECTION_RESET",
  "ERR_CONNECTION_REFUSED", "ERR_CONNECTION_CLOSED", "ERR_INTERNET_DISCONNECTED", "ERR_NETWORK_CHANGED",
  "ERR_NAME_NOT_RESOLVED", "ERR_TIMED_OUT", "ERR_CONNECTION_TIMED_OUT", "ERR_PROXY_CONNECTION_FAILED",
  "ERR_TUNNEL_CONNECTION_FAILED", "ERR_HTTP_RESPONSE_CODE_FAILURE", "ERR_INVALID_URL",
  "ERR_UPDATER_CHECKSUM_MISMATCH", "ERR_UPDATER_INVALID_SIGNATURE", "ERR_UPDATER_INVALID_RELEASE_FEED",
  "ERR_UPDATER_LATEST_VERSION_NOT_FOUND", "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND", "ERR_UPDATER_NO_PUBLISHED_VERSIONS",
  "ERR_UPDATER_INVALID_PROVIDER_CONFIGURATION", "ERR_UPDATER_INVALID_UPDATE_INFO", "ERR_UPDATER_WEB_INSTALLER_DISABLED",
  "ERR_UPDATER_UNSUPPORTED_PROVIDER", "ERR_CHECKSUM_MISMATCH", "SHA512_MISMATCH", "CHECKSUM_MISMATCH", "DIGEST_MISMATCH",
]);
export function AppUpdateModal({ open, status, busy = false, onClose, onCheck, onDownload, onApply, onDefer, reloadReady = false, onReload }: AppUpdateModalProps) {
  const ref = useDialogFocus(open && Boolean(status), onClose);
  if (!open || !status || typeof document === "undefined") return null;
  const { phase, latest } = status;
  const hasUpdate = Boolean(latest && latest.version !== status.currentVersion);
  const checked = phase === "idle" && Boolean(status.lastSuccessfulCheckAt);
  const working = ["checking", "downloading", "waiting_for_idle", "applying"].includes(phase);
  const title = phase === "failed" ? "更新暂时不可用" : phase === "checking" ? "正在检查更新"
    : phase === "downloading" ? "正在下载新版本" : phase === "ready" ? "更新已准备好"
    : phase === "waiting_for_idle" ? "等待生成任务完成" : phase === "applying" ? "正在安装更新"
    : phase === "disabled" ? "开发模式" : hasUpdate ? "发现新版本" : checked ? "已是最新版本" : "检查软件更新";
  const failureDescription = status.diagnostic && failureDescriptions[status.diagnostic.category];
  const description = phase === "failed" ? (typeof failureDescription === "string" ? failureDescription : failureDescriptions.unknown) : phase === "downloading" ? "正在后台下载更新包，你可以继续使用画布。"
    : phase === "ready" ? "安装包已校验。重启前会保存画布，并等待生成任务完成。"
    : phase === "waiting_for_idle" || phase === "applying" ? "画布保存完成后安全重启，保留本地资料与配置。"
    : hasUpdate ? "新版本已发布，查看本次改进后即可升级。"
    : "启动时自动检查，运行期间每 6 小时检查一次。";
  const notes = hasUpdate ? latest?.notes : status.currentNotes;
  const releaseUrl = "https://github.com/" + status.repository + "/releases" + (latest ? "/tag/" + encodeURIComponent(latest.tag) : "");
  const downloaded = nonNegativeNumber(status.progress?.downloadedBytes);
  const total = nonNegativeNumber(status.progress?.totalBytes);
  const speed = nonNegativeNumber(status.progress?.bytesPerSecond);
  const remaining = nonNegativeNumber(status.progress?.estimatedRemainingSeconds);
  const percent = total && downloaded !== undefined ? Math.min(100, Math.round(downloaded / total * 100)) : null;
  const speedText = speed === undefined ? "正在测量…" : speed === 0 ? "等待传输…" : speed < 1 ? "小于 1 B/s" : `${bytes(speed)}/s`;
  const remainingText = speed && total && remaining !== undefined ? remainingTime(remaining) : "暂无法估计";
  const modeLabel = status.download && downloadLabels[status.download.mode];
  const diagnostic = status.diagnostic;
  const diagnosticStage = diagnostic && stageLabels[diagnostic.stage];
  const diagnosticCategory = diagnostic && categoryLabels[diagnostic.category];
  const diagnosticCode = diagnostic?.code && diagnosticCodes.has(diagnostic.code) ? diagnostic.code : undefined;
  const diagnosticStatus = diagnostic?.statusCode && Number.isInteger(diagnostic.statusCode) && diagnostic.statusCode >= 100 && diagnostic.statusCode <= 599 ? diagnostic.statusCode : undefined;
  const fallbackDiagnostic = phase === "downloading" && status.download?.fallback && diagnostic?.category !== "unknown";
  const canDownload = hasUpdate && status.managerAvailable && ["available", "idle", "failed"].includes(phase);
  const Icon = phase === "failed" ? CircleAlert : working ? RefreshCw : checked || phase === "ready" ? Check : Sparkles;
  return createPortal(<div className={styles.backdrop}>
    <section ref={ref} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="app-update-title" aria-describedby="app-update-description" tabIndex={-1}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>SUPER CANVAS</p><h2 id="app-update-title">超级画布更新</h2></div>
        <button className={styles.close} onClick={onClose} type="button" aria-label="关闭更新窗口"><X size={18} /></button>
      </header>
      <div className={styles.body}>
        <div className={styles.hero} data-error={phase === "failed"}>
          <span className={styles.heroIcon}><Icon size={23} className={working ? styles.spinning : undefined} /></span>
          <div aria-live="polite"><h3>{title}</h3><p id="app-update-description">{description}</p></div>
        </div>
        <div className={styles.versions}>
          <div><span>当前版本</span><strong>v{status.currentVersion}</strong></div><ArrowRight size={18} aria-hidden="true" />
          <div><span>{hasUpdate ? "可用更新" : "最新版本"}</span><strong>{latest ? "v" + latest.version : checked ? "v" + status.currentVersion : phase === "checking" ? "检查中…" : "尚未确认"}</strong></div>
        </div>
        <section className={styles.notes} aria-label="版本更新内容">
          <div className={styles.notesHeader}><h3>{hasUpdate ? "本次更新" : "本版本更新"}</h3><span>{dateLabel(latest?.publishedAt)}</span></div>
          {notes ? <ReleaseNotes notes={notes} /> : <p className={styles.empty}>{hasUpdate ? "发布者未提供更新说明，可前往 GitHub 查看版本详情。" : "检查完成后会显示可用更新。"}</p>}
        </section>
        {phase === "downloading" ? <div className={styles.progress}>
          <div><span>{downloaded !== undefined ? bytes(downloaded) + (total ? " / " + bytes(total) : "") : "正在连接下载服务…"}</span><strong>{percent === null ? "准备中" : percent + "%"}</strong></div>
          <div className={styles.track} role="progressbar" aria-label="下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}><span style={{ width: (percent ?? 0) + "%" }} /></div>
          <dl className={styles.transferStats} aria-label="下载状态">
            <div><dt>下载速度</dt><dd>{speedText}</dd></div>
            <div><dt>预计剩余时间</dt><dd>{remainingText}</dd></div>
          </dl>
        </div> : null}
        {typeof modeLabel === "string" && ["downloading", "ready"].includes(phase) ? <div className={styles.downloadMode}>
          <span>{modeLabel}</span>
          {status.download?.fallback && status.download.mode === "full" ? <p>差分下载未完成，已切换完整安装包。</p> : null}
        </div> : null}
        {(phase === "failed" || fallbackDiagnostic) && typeof diagnosticStage === "string" && typeof diagnosticCategory === "string" ? <details className={styles.diagnostic}>
          <summary>{phase === "failed" ? "查看失败信息" : "查看差分失败信息"}</summary>
          <dl>
            <div><dt>发生阶段</dt><dd>{diagnosticStage}</dd></div>
            <div><dt>原因</dt><dd>{diagnosticCategory}</dd></div>
            {diagnosticStatus ? <div><dt>服务响应</dt><dd>HTTP {diagnosticStatus}</dd></div> : null}
            {diagnosticCode ? <div><dt>错误编号</dt><dd>{diagnosticCode}</dd></div> : null}
          </dl>
          {diagnostic?.retryable === false ? <p>请重新检查更新；再次失败时可提供这些信息协助排查。</p> : null}
        </details> : null}
      </div>
      <footer className={styles.footer}>
        <a href={releaseUrl} target="_blank" rel="noreferrer">GitHub 更新记录 <ExternalLink size={13} /></a>
        <div className={styles.actions}>
          <button className={styles.secondary} type="button" onClick={canDownload && phase !== "failed" ? onDefer : onClose} disabled={busy && !working}>{canDownload && phase !== "failed" ? "稍后提醒" : phase === "downloading" ? "后台下载" : "关闭"}</button>
          {canDownload ? <button className={styles.primary} type="button" onClick={onDownload} disabled={busy}><Download size={15} />{phase === "failed" ? "重试下载" : "下载更新"}</button> : null}
          {phase === "ready" ? <button className={styles.primary} type="button" onClick={onApply} disabled={busy || !status.managerAvailable}><RefreshCw size={15} />重启并更新</button> : null}
          {!canDownload && !working && phase !== "ready" ? <button className={styles.primary} type="button" onClick={onCheck} disabled={busy || !status.enabled}><RefreshCw size={15} />{phase === "failed" ? "重新检查" : "立即检查"}</button> : null}
          {reloadReady && onReload ? <button className={styles.primary} type="button" onClick={onReload}>重新加载画布</button> : null}
        </div>
      </footer>
    </section>
  </div>, document.body);
}
