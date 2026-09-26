"use client";

import { useEffect, useRef, useState } from "react";
import type { ModelDescriptor } from "@super-canvas/providers";
import { parseCliConnectorConfig } from "@super-canvas/providers/cli-contracts";
import { Plus, RefreshCw, Terminal, Trash2 } from "lucide-react";
import { fetchConnections, saveConnection, type ProviderConnectionView } from "../lib/client-api";
import { CLI_DEFAULT_TIMEOUTS, cliSettings, cliStatusLabel, deleteCliConnection, fetchCliDemoTemplate, runCliConnectionAction, type CliSettings } from "../lib/cli-connections";
import { modelDescriptorsFromConnectionConfig } from "../lib/model-parameters";
import { useSettingsDraft, useSettingsLeaveGuard } from "./settings-draft-guard";
import styles from "./personal-ai-settings.module.css";

type Draft = CliSettings & { name: string; argumentsJson: string };
function newDraft(template: "jimeng" | "custom" | "demo" = "jimeng"): Draft {
  const siteName = template === "jimeng" ? "即梦" : template === "demo" ? "模拟 AI 网站" : "我的 AI 网站";
  return { version: 1, siteId: template, siteName, name: siteName, executable: "", args: [], argumentsJson: "[]", enabled: false, ...CLI_DEFAULT_TIMEOUTS };
}
function draftFrom(connection: ProviderConnectionView): Draft {
  const saved = cliSettings(connection);
  return { ...newDraft("custom"), ...saved, name: connection.name, args: saved.args ?? [], argumentsJson: JSON.stringify(saved.args ?? [], null, 2) };
}

export function PersonalAiSettings({ onConnectionsChanged }: { onConnectionsChanged: (connections: ProviderConnectionView[]) => void }) {
  const [connections, setConnections] = useState<ProviderConnectionView[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [baseline, setBaseline] = useState(() => JSON.stringify(newDraft()));
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const active = useRef(true);
  const callback = useRef(onConnectionsChanged);
  const selected = connections.find(connection => connection.id === selectedId);
  const dirty = JSON.stringify(draft) !== baseline;
  const { requestLeave } = useSettingsLeaveGuard();
  useEffect(() => { callback.current = onConnectionsChanged; }, [onConnectionsChanged]);
  useSettingsDraft({ id: "personal-ai-connection", label: `${draft.name || "个人 AI 网站"}的连接配置`, dirty, busy, onDiscard: () => setDraft(JSON.parse(baseline) as Draft) });
  const applyDraft = (value: Draft, id = "") => { setDraft(value); setBaseline(JSON.stringify(value)); setSelectedId(id); setError(""); setMessage(""); };
  const acceptConnections = (items: ProviderConnectionView[]) => { setConnections(items); callback.current(items); };
  useEffect(() => {
    active.current = true;
    void fetchConnections().then(items => {
      if (!active.current) return;
      setConnections(items); callback.current(items);
      const first = items.find(connection => connection.provider === "cli");
      if (first) { const value = draftFrom(first); setDraft(value); setBaseline(JSON.stringify(value)); setSelectedId(first.id); }
    }).catch(cause => { if (active.current) setError(cause instanceof Error ? cause.message : "无法读取个人 AI 网站"); })
      .finally(() => { if (active.current) setLoading(false); });
    return () => { active.current = false; };
  }, []);
  const patch = (value: Partial<Draft>) => setDraft(current => ({ ...current, ...value }));
  async function chooseTemplate(template: "jimeng" | "custom" | "demo") {
    if (!requestLeave(() => undefined, { action: "新建个人 AI 网站连接" })) return;
    setBusy(true); setError("");
    try {
      const value = newDraft(template);
      if (template === "demo") Object.assign(value, await fetchCliDemoTemplate(), { enabled: true });
      value.argumentsJson = JSON.stringify(value.args, null, 2);
      if (active.current) applyDraft(value);
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "无法读取模拟配置"); }
    finally { if (active.current) setBusy(false); }
  }
  async function save() {
    setBusy(true); setError(""); setMessage("");
    try {
      const args: unknown = JSON.parse(draft.argumentsJson);
      if (!Array.isArray(args) || args.some(arg => typeof arg !== "string")) throw new Error("启动参数必须是 JSON 字符串数组，例如 [\"adapter.mjs\"]");
      if (!draft.name.trim() || !draft.siteId.trim() || !draft.siteName.trim()) throw new Error("请填写连接名称、网站名称和网站标识");
      const settings = parseCliConnectorConfig({ ...draft, args });
      const connection = await saveConnection({ id: selectedId || undefined, name: draft.name.trim(), provider: "cli", config: { ...(selected?.config ?? {}), usage: "canvas", cli: { ...settings, siteId: settings.siteId.trim(), siteName: settings.siteName.trim(), executable: settings.executable.trim(), args, cwd: settings.cwd?.trim() || undefined } } });
      if (!active.current) return;
      acceptConnections([...connections.filter(item => item.id !== connection.id), connection]); applyDraft(draftFrom(connection), connection.id);
      setMessage("连接已保存。检测连接和同步模型需要分别点击下方按钮。");
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "保存失败"); }
    finally { if (active.current) setBusy(false); }
  }
  async function run(action: "test" | "describe") {
    if (!selected || dirty) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await runCliConnectionAction(selected.id, action);
      if (!active.current) return;
      acceptConnections(connections.map(item => item.id === result.connection.id ? result.connection : item));
      applyDraft(draftFrom(result.connection), result.connection.id);
      setMessage(action === "describe" ? `已同步 ${result.models?.length ?? modelDescriptorsFromConnectionConfig(result.connection.config).length} 个模型，参数由当前 CLI 返回。` : cliStatusLabel(result.connection));
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "操作失败");
      const items = await fetchConnections().catch(() => null);
      if (active.current && items) acceptConnections(items);
    } finally { if (active.current) setBusy(false); }
  }
  async function remove() {
    if (!selected || !window.confirm(`删除“${selected.name}”连接？画布节点和素材会保留。`)) return;
    setBusy(true); setError("");
    try { const items = await deleteCliConnection(selected.id); if (active.current) { acceptConnections(items); applyDraft(newDraft()); setMessage("连接已删除"); } }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "删除失败"); }
    finally { if (active.current) setBusy(false); }
  }
  const models = Array.isArray(selected?.config.modelCatalogModels) ? selected.config.modelCatalogModels as ModelDescriptor[] : [];
  const cliConnections = connections.filter(connection => connection.provider === "cli");
  return <div id="sm-personal-ai-panel" className={styles.panel} role="tabpanel" aria-label="个人 AI 网站">
    <aside className={styles.sidebar}>
      <h3><Terminal size={17} />个人 AI 网站</h3>
      <p>使用你已登录的本机 CLI，将个人网站账号接入画布。</p>
      <div className={styles.templates} aria-label="新建个人 AI 网站">
        <button disabled={busy || loading} onClick={() => void chooseTemplate("jimeng")}><Plus size={14} />即梦（待接入）</button>
        <button disabled={busy || loading} onClick={() => void chooseTemplate("custom")}><Plus size={14} />自定义网站</button>
        <button disabled={busy || loading} onClick={() => void chooseTemplate("demo")}><Plus size={14} />模拟连接</button>
      </div>
      <div className={styles.connections} aria-label="已保存的个人 AI 网站连接">
        {loading ? <p>正在读取连接…</p> : cliConnections.length === 0 ? <p>尚未保存个人网站连接</p> : cliConnections.map(connection => <button key={connection.id} className={selectedId === connection.id ? styles.selected : ""} disabled={busy} onClick={() => requestLeave(() => applyDraft(draftFrom(connection), connection.id), { action: "切换个人 AI 网站连接" })}><strong>{connection.name}</strong><span>{cliStatusLabel(connection)}</span></button>)}
      </div>
    </aside>
    <section className={styles.content} aria-label="个人 AI 网站连接配置">
      <header><h2>{selected ? selected.name : "新建连接"}</h2><span>{cliStatusLabel(selected)}</span></header>
      <p>先在该 CLI 中登录账号，再填写兼容画布协议的适配器启动配置。即梦模板预留接入位置，真实模型、分辨率和秒数将在接入后同步。</p>
      <fieldset disabled={busy || loading} className={styles.form}>
        <label>连接名称<input value={draft.name} onChange={event => patch({ name: event.target.value })} /></label>
        <label>网站名称<input value={draft.siteName} onChange={event => patch({ siteName: event.target.value })} /></label>
        <label>网站标识<input value={draft.siteId} onChange={event => patch({ siteId: event.target.value })} placeholder="jimeng" /></label>
        <label>账号备注<input value={draft.accountLabel ?? ""} onChange={event => patch({ accountLabel: event.target.value })} placeholder="例如：我的主账号" /></label>
        <label className={styles.wide}>可执行文件<input value={draft.executable} onChange={event => patch({ executable: event.target.value })} placeholder="例如 C:\\Program Files\\nodejs\\node.exe" /></label>
        <label className={styles.wide}>启动参数（JSON 数组）<textarea rows={3} value={draft.argumentsJson} onChange={event => patch({ argumentsJson: event.target.value })} spellCheck={false} /></label>
        <label className={styles.wide}>工作目录（可选）<input value={draft.cwd ?? ""} onChange={event => patch({ cwd: event.target.value })} placeholder="适配器的工作目录" /></label>
        <label className={styles.toggle}><input type="checkbox" checked={draft.enabled} onChange={event => patch({ enabled: event.target.checked })} />启用此连接</label>
        <details className={styles.wide}><summary>高级设置</summary><div className={styles.advanced}>{([['commandTimeoutMs', '检测及查询超时（秒）'], ['submitTimeoutMs', '提交超时（秒）'], ['pollIntervalMs', '查询间隔（秒）'], ['taskTimeoutMs', '任务最长等待（秒）']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min={1} step={1} value={draft[key] / 1000} onChange={event => patch({ [key]: Number(event.target.value) * 1000 })} /></label>)}</div></details>
      </fieldset>
      <p className={styles.note}>沿用 CLI 自己的登录状态；命令配置仅保存在本机连接中，不随画布项目导出。打开画布或读取模型目录不会启动 CLI。</p>
      <div className={styles.actions}>
        <button disabled={busy || loading} onClick={() => void save()}>保存连接</button>
        <button disabled={busy || dirty || !selected || !draft.enabled || !draft.executable.trim()} onClick={() => void run("test")}>检测连接</button>
        <button disabled={busy || dirty || !selected || !draft.enabled || !draft.executable.trim()} onClick={() => void run("describe")}><RefreshCw size={14} />同步模型与参数</button>
        {selected && <button className={styles.delete} disabled={busy} onClick={() => void remove()}><Trash2 size={14} />删除连接</button>}
      </div>
      {dirty && <p className={styles.note}>保存修改后，可以检测或同步。</p>}
      {busy && <p role="status">正在处理…</p>}{message && <p role="status">{message}</p>}{error && <p role="alert" className={styles.error}>{error}</p>}
      <section className={styles.models} aria-label="已同步的模型与参数"><h3>模型与参数 <span>{models.length}</span></h3>{models.length > 0 && (selected?.config.cliStatus as { state?: string } | undefined)?.state !== "ready" && <p>上次同步的目录；连接恢复并检测成功后才能生成。</p>}{models.length ? models.map(model => <article key={model.id}><strong>{model.name}</strong><code>{model.id}</code><p>{(model.parameters ?? []).map(parameter => `${parameter.label}${parameter.options?.length ? `：${parameter.options.map(option => option.label).join(" / ")}` : ""}`).join(" · ") || "此模型未声明可调参数"}</p></article>) : <p>等待接入后同步。画布会按所选模型显示它实际支持的参数。</p>}</section>
    </section>
  </div>;
}
