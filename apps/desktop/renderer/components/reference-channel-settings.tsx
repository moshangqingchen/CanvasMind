"use client";
import { useEffect, useState } from "react";
import type { ReferenceChannelView } from "../lib/desktop-client";

export function ReferenceChannelSettings() {
  const [status, setStatus] = useState<ReferenceChannelView | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [tunnelToken, setTunnelToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const api = window.superCanvasDesktop;
    let alive = true;
    const load = async () => {
      if (!api?.getReferenceChannel || !api.saveReferenceChannel || !api.onReferenceChannel)
        throw new Error("此设置仅在新版桌面程序中可用");
      const value = await api.getReferenceChannel();
      if (alive) { setStatus(value); setEnabled(value.enabled); setBaseUrl(value.baseUrl); }
    };
    void load().catch((failure: unknown) => {
      if (alive) setError(failure instanceof Error ? failure.message : "无法读取通道设置");
    });
    const stop = api?.onReferenceChannel?.(value => { if (alive) setStatus(value); });
    return () => { alive = false; stop?.(); };
  }, []);
  async function save() {
    if (busy || !status) return;
    setBusy(true); setError("");
    try {
      const value = await window.superCanvasDesktop!.saveReferenceChannel({ enabled, baseUrl, tunnelToken });
      setStatus(value); setEnabled(value.enabled); setBaseUrl(value.baseUrl); setTunnelToken("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "保存失败"); }
    finally { setBusy(false); }
  }
  return <div role="tabpanel" id="sm-reference-panel" style={{ padding: "28px 36px", overflowY: "auto", minHeight: 0 }}>
    <h3>本机素材通道</h3>
    <p>素材保存在本机。需要公网参考素材的模型，会通过你的域名读取带签名的临时链接，有效期为 1 小时。</p>
    <p>读取期间需要保持电脑联网、程序运行。素材会经过 Cloudflare 并交给所选供应商处理；持有有效链接的人也可以读取该素材。</p>
    <div style={{ maxWidth: 620, display: "grid", gap: 18, marginTop: 24 }}>
      <label><input type="checkbox" aria-label="启用本机素材通道" checked={enabled} disabled={busy || !status} onChange={event => setEnabled(event.target.checked)} /> 启用本机素材通道</label>
      <label className="field">素材域名<input aria-label="素材域名" placeholder="https://你的域名" value={baseUrl} disabled={busy || !status} onChange={event => setBaseUrl(event.target.value)} /></label>
      <label className="field">Cloudflare 隧道凭据<input aria-label="Cloudflare 隧道凭据" type="password" autoComplete="off" value={tunnelToken} disabled={busy || !status} placeholder={status?.tokenConfigured ? "已加密保存，留空保留原凭据" : "粘贴现有隧道的安装命令或 Token"} onChange={event => setTunnelToken(event.target.value)} /></label>
      <small>凭据由 Windows 加密保存在本机。将此域名的 Cloudflare 隧道服务地址设为 http://127.0.0.1:3210。</small>
      <div role="status">{error || status?.message || (status?.enabled ? "等待连接" : "素材通道已关闭")}</div>
      <button className="button primary" type="button" onClick={() => void save()} disabled={busy || !status}>{busy ? "正在保存…" : enabled ? "保存并连接" : "保存并关闭"}</button>
    </div>
  </div>;
}
