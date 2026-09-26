"use client";
import { useEffect, useState } from "react";
import { useSettingsDraft } from "./settings-draft-guard";

export function CloudGenerationSettings() {
  const [endpoint, setEndpoint] = useState("");
  const [savedEndpoint, setSavedEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { let alive = true;
    void fetch("/api/desktop/cloud-generation").then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (alive) { setEndpoint(data.endpoint); setSavedEndpoint(data.endpoint); setConfigured(data.tokenConfigured); setLoaded(true); }
    }).catch(error => { if (alive) { setMessage(error.message); setFailed(true); } });
    return () => { alive = false; };
  }, []);
  useSettingsDraft({ label: "云端生图配置", dirty: endpoint !== savedEndpoint || Boolean(token), busy,
    onDiscard: () => { setEndpoint(savedEndpoint); setToken(""); } });
  async function saveAndTest() {
    setBusy(true); setMessage(""); setFailed(false);
    try {
      const saved = await fetch("/api/desktop/cloud-generation", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint, ...(token ? { token } : {}) }) });
      const value = await saved.json(); if (!saved.ok) throw new Error(value.error);
      setEndpoint(value.endpoint); setSavedEndpoint(value.endpoint); setConfigured(value.tokenConfigured); setToken("");
      const checked = await fetch("/api/desktop/cloud-generation", { method: "POST" });
      const health = await checked.json(); if (!checked.ok) throw new Error(health.error);
      setMessage(health.message);
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }
  return <section id="sm-cloud-panel" role="tabpanel" className="sm-basics" style={{ overflow: "auto", padding: 24 }}>
    <h3>Cloudflare 云端生图</h3>
    <p className="sm-muted">云端完成生成后保存结果 24 小时，到期自动删除。画布取回本地后长期保留，断网或重开软件可在有效期内继续取回。每个供应商可单独选择，连接测试不会调用模型生图。</p>
    <div className="sm-form-grid">
      <label className="sm-field"><span>云端服务地址</span><input aria-label="云端服务地址" value={endpoint} placeholder="https://你的云端服务域名" disabled={busy || !loaded} onChange={event => setEndpoint(event.target.value)} /></label>
      <label className="sm-field"><span>服务访问密钥</span><input aria-label="云端服务访问密钥" type="password" autoComplete="off" value={token} placeholder={configured ? "已保存，留空继续使用" : "填写专用访问密钥"} disabled={busy || !loaded} onChange={event => setToken(event.target.value)} /></label>
    </div>
    <p className="sm-muted">勾选供应商的“使用 Cloudflare 云端生图”后，该供应商的新生图与编辑请求会经此服务发送；提示词、参考图和 API Key 会由你自己的 Cloudflare 后台处理。</p>
    <button className="sm-button is-primary" disabled={busy || !loaded || !endpoint.trim()} onClick={() => void saveAndTest()}>{busy ? "正在检查…" : "保存并测试连接"}</button>
    {message && <p className={`sm-notice${failed ? " is-error" : ""}`} role="status">{message}</p>}
  </section>;
}
