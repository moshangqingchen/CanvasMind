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
function bytes(value: number) { return (value / 1024 / 1024).toFixed(1) + " MB"; }
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
  const description = phase === "failed" ? status.error : phase === "downloading" ? "正在后台下载更新包，你可以继续使用画布。"
    : phase === "ready" ? "安装包已校验。重启前会保存画布，并等待生成任务完成。"
    : phase === "waiting_for_idle" || phase === "applying" ? "画布保存完成后安全重启，保留本地资料与配置。"
    : hasUpdate ? "新版本已发布，查看本次改进后即可升级。"
    : "启动时自动检查，运行期间每 6 小时检查一次。";
  const notes = hasUpdate ? latest?.notes : status.currentNotes;
  const releaseUrl = "https://github.com/" + status.repository + "/releases" + (latest ? "/tag/" + encodeURIComponent(latest.tag) : "");
  const percent = status.progress?.totalBytes ? Math.min(100, Math.max(0, Math.round(status.progress.downloadedBytes / status.progress.totalBytes * 100))) : null;
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
          <div><span>{status.progress ? bytes(status.progress.downloadedBytes) + (status.progress.totalBytes ? " / " + bytes(status.progress.totalBytes) : "") : "正在连接下载服务…"}</span><strong>{percent === null ? "准备中" : percent + "%"}</strong></div>
          <div className={styles.track} role="progressbar" aria-label="下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}><span style={{ width: (percent ?? 0) + "%" }} /></div>
        </div> : null}
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
