"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Globe2,
  MoreHorizontal,
  Layers3,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { PROVIDER_SUPPLIER_PROFILES } from "@super-canvas/providers/suppliers";
import type { ModelDescriptor } from "@super-canvas/providers";
import {
  fetchConnections,
  invalidateModelCache,
  saveConnection,
  testConnection,
  type ProviderConnectionView,
} from "../lib/client-api";
import {
  providerConnectionGroup,
  providerConnectionSupplierKey,
  providerConnectionUsage,
  type ProviderConnectionUsage,
} from "../lib/provider-connection-options";
import {
  cleanSupplierAddress,
  createSupplier,
  deleteSupplier,
  deleteManualSupplierGroup,
  fetchSupplierImpact,
  restoreSupplierSource,
  fetchSuppliers,
  findSupplierGroupConnection,
  manualModelCapabilities,
  manualModelProtocols,
  manualModelsForConnection,
  readSupplierModels,
  scanSupplier,
  supplierOwnsConnection,
  updateSupplier,
  type ManualSupplierModel,
  type SupplierCatalogGroup,
  type SupplierCatalogModel,
  type SupplierKind,
  type SupplierModelProtocol,
  type SupplierRecord,
} from "../lib/client-suppliers";
import { supplierConnectionDraft } from "../lib/supplier-connection-draft";
import { isScannedSupplierGroup } from "../lib/supplier-group-source";
import "./supplier-manager.css";

const DEFAULT_API_URLS: Record<string, string> = {
  cangyuan: "https://ai.cangyuansuanli.cn",
  cyberafei: "https://api.3365api.cn",
  frimodel: "https://api.frimodel.com/v1",
  chentu: "https://tu.988236.xyz/v1",
  miaowu: "https://api.miaowuai.store",
  mikoto: "https://api.mikoto.vip",
  weai: "https://asian-acc.we-token.cc/v1",
  openai: "https://api.openai.com/v1",
};
const KIND_LABELS: Record<SupplierKind, string> = {
  auto: "自动识别",
  newapi: "NewAPI / OneAPI",
  sub2api: "Sub2API",
  "openai-compatible": "OpenAI 兼容",
};
const PROTOCOL_LABELS: Record<SupplierModelProtocol, string> = {
  "openai-images": "OpenAI Images",
  "openai-videos": "OpenAI Videos",
  "chat-completions": "Chat Completions",
  responses: "Responses",
  gemini: "Gemini 原生",
  rest: "已有 REST 连接器协议",
  "anthropic-messages": "Anthropic Messages",
  "google-generate-content": "Gemini GenerateContent",
  "xai-responses": "xAI Responses",
  "generic-openai-compatible": "OpenAI 兼容对话",
  unknown: "未识别",
};
const CAPABILITY_LABELS = {
  image: "图片",
  video: "视频",
  chat: "对话",
  other: "其他",
};

interface SupplierEntry {
  id: string;
  supplierKey: string;
  name: string;
  siteUrl: string;
  apiUrl: string;
  builtIn: boolean;
  record?: SupplierRecord;
}

function catalogStatus(record?: SupplierRecord): string {
  if (!record || record.scanStatus === "unscanned") return "等待扫描";
  if (record.scanStatus === "live") return "目录已更新";
  if (record.scanStatus === "empty") return "未发现公开目录";
  if (record.scanStatus === "unauthorized") return "目录需要登录";
  return "扫描未完成";
}

function errorMessage(error: unknown, secret?: string): string {
  const message =
    error instanceof Error ? error.message : "操作未完成，请稍后重试。";
  return secret?.trim() ? message.split(secret.trim()).join("[Key]") : message;
}

function savedModels(connection?: ProviderConnectionView): ModelDescriptor[] {
  const value = connection?.config.modelCatalogModels;
  if (Array.isArray(value))
    return value.filter((item): item is ModelDescriptor =>
      Boolean(
        item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        Array.isArray(item.operations),
      ),
    );
  const ids = connection?.config.scannedModelIds;
  return Array.isArray(ids)
    ? ids
        .filter((id): id is string => typeof id === "string")
        .map((id) => ({ id, name: id, operations: [] }))
    : [];
}

export function SupplierManager({
  initialCangyuanGroup,
  onConnectionsChanged,
  onOpenAdvanced,
}: {
  initialCangyuanGroup?: string | null;
  onConnectionsChanged?: (connections: ProviderConnectionView[]) => void;
  onOpenAdvanced?: () => void;
}) {
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [connections, setConnections] = useState<ProviderConnectionView[]>([]);
  const [selectedId, setSelectedId] = useState(
    initialCangyuanGroup ? "template:cangyuan" : "",
  );
  const [query, setQuery] = useState("");
  const [detailSession, setDetailSession] = useState(0);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadVersion = useRef(0);
  const selectedRef = useRef<string | undefined>(undefined);
  const onConnectionsRef = useRef(onConnectionsChanged);
  useEffect(() => {
    onConnectionsRef.current = onConnectionsChanged;
  }, [onConnectionsChanged]);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    const results = await Promise.allSettled([
      fetchSuppliers(),
      fetchConnections(),
    ]);
    if (version !== loadVersion.current) return;
    const messages: string[] = [];
    if (results[0].status === "fulfilled") setSuppliers(results[0].value);
    else messages.push(errorMessage(results[0].reason));
    if (results[1].status === "fulfilled") {
      setConnections(results[1].value);
      onConnectionsRef.current?.(results[1].value);
    } else messages.push(errorMessage(results[1].reason));
    setError(messages.join("；"));
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const [showHidden, setShowHidden] = useState(false);
  const [menu, setMenu] = useState<{
    entry: SupplierEntry;
    x: number;
    y: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (menu)
      menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [menu]);
  function openMenu(entry: SupplierEntry, x: number, y: number) {
    setMenu({
      entry,
      x: Math.min(x, window.innerWidth - 225),
      y: Math.min(y, window.innerHeight - 285),
    });
  }
  async function menuAction(
    action: "rename" | "scan" | "site" | "hide" | "delete",
  ) {
    if (!menu) return;
    const entry = menu.entry;
    setMenu(null);
    if (action === "site") {
      if (entry.siteUrl)
        window.open(entry.siteUrl, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const record =
        entry.record ??
        (await createSupplier({
          name: entry.name,
          supplierKey: entry.supplierKey,
          siteUrl: entry.siteUrl,
          apiUrl: entry.apiUrl,
        }));
      let result: SupplierRecord | undefined;
      if (action === "rename") {
        const name = window.prompt("重命名供应商", record.name)?.trim();
        if (name)
          result = await updateSupplier(record.id, {
            name,
            expectedRevision: record.state?.revision ?? 0,
          });
      } else if (action === "scan")
        result = await scanSupplier(
          record.id,
          undefined,
          record.state?.revision ?? 0,
        );
      else if (action === "hide")
        result = await updateSupplier(record.id, {
          visibility:
            record.state?.visibility === "hidden" ? "visible" : "hidden",
          expectedRevision: record.state?.revision ?? 0,
        });
      else {
        const impact = await fetchSupplierImpact(record.id);
        if (impact.unfinishedRuns)
          throw new Error(
            `供应商仍有 ${impact.unfinishedRuns} 个未完成运行，请先完成或取消。隐藏不影响运行。`,
          );
        if (
          window.confirm(
            `彻底删除“${record.name}”？\n将删除当前及历史配置中的 ${impact.groups} 个分组、${impact.keys} 个 Key。\n${impact.canvasReferences} 个画布节点引用将需要重新选择连接。\n画布节点、素材和生成历史保留，此操作不可撤销。`,
          )
        )
          result = await deleteSupplier(record.id, impact.revision);
      }
      if (result) {
        updateRecord(result, entry.id);
        connections.forEach((c) => invalidateModelCache(c.id));
      }
      await load();
    } catch (error) {
      setError(errorMessage(error));
      await load();
      setError(errorMessage(error));
    }
  }
  const entries = useMemo(() => {
    const savedKeys = new Set(
      suppliers.map((supplier) => supplier.supplierKey),
    );
    const builtIns = PROVIDER_SUPPLIER_PROFILES.filter(
      (profile) => profile.key in DEFAULT_API_URLS,
    );
    const items: SupplierEntry[] = suppliers
      .filter(
        (record) =>
          record.state?.visibility !== "deleted" &&
          (showHidden
            ? record.state?.visibility === "hidden"
            : record.state?.visibility !== "hidden"),
      )
      .map((record) => ({
        ...record,
        record,
        builtIn: builtIns.some((profile) => profile.key === record.supplierKey),
      }));
    for (const profile of builtIns) {
      if (showHidden || savedKeys.has(profile.key)) continue;
      const existing = connections.find(
        (connection) =>
          providerConnectionSupplierKey(connection) === profile.key,
      );
      items.push({
        id: `template:${profile.key}`,
        supplierKey: profile.key,
        name: profile.label,
        siteUrl: profile.websiteUrl ?? "",
        apiUrl:
          typeof existing?.config.baseUrl === "string"
            ? existing.config.baseUrl
            : DEFAULT_API_URLS[profile.key]!,
        builtIn: true,
      });
      savedKeys.add(profile.key);
    }
    for (const connection of connections) {
      if (
        showHidden ||
        connection.config.supplierArchived === true ||
        connection.config.supplierId
      )
        continue;
      const key = providerConnectionSupplierKey(connection);
      if (savedKeys.has(key)) continue;
      savedKeys.add(key);
      const profile = PROVIDER_SUPPLIER_PROFILES.find(
        (item) => item.key === key,
      );
      items.push({
        id: `template:${key}`,
        supplierKey: key,
        name: profile?.label ?? key,
        siteUrl:
          typeof connection.config.supplierWebsiteUrl === "string"
            ? connection.config.supplierWebsiteUrl
            : (profile?.websiteUrl ?? ""),
        apiUrl:
          typeof connection.config.baseUrl === "string"
            ? connection.config.baseUrl
            : "",
        builtIn: Boolean(profile),
      });
    }
    return items;
  }, [suppliers, connections, showHidden]);

  const selected =
    entries.find((entry) => entry.id === selectedId) ??
    (initialCangyuanGroup
      ? entries.find((entry) => entry.supplierKey === "cangyuan")
      : undefined) ??
    entries[0];
  selectedRef.current = selected?.id;
  const visibleEntries = entries.filter((entry) =>
    `${entry.name} ${entry.siteUrl} ${entry.apiUrl}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );

  function updateRecord(record: SupplierRecord, originId?: string) {
    setSuppliers((current) => {
      const previous = current.find((item) => item.id === record.id);
      if ((previous?.state?.revision ?? 0) > (record.state?.revision ?? 0))
        return current;
      return [...current.filter((item) => item.id !== record.id), record];
    });
    if (!originId || selectedRef.current === originId) {
      setSelectedId(record.id);
      setAdding(false);
    }
  }

  async function updateConnections() {
    connections.forEach((c) => invalidateModelCache(c.id));
    const current = await fetchConnections();
    setConnections(current);
    onConnectionsRef.current?.(current);
  }

  return (
    <div className="sm-manager" id="sm-suppliers-panel" role="tabpanel">
      <aside className="sm-sidebar" aria-label="供应商列表">
        <div className="sm-sidebar-heading">
          <div>
            <span className="sm-kicker">YOUR CONNECTIONS</span>
            <h3>模型供应商</h3>
          </div>
          <button
            className="sm-icon"
            type="button"
            title="重新读取已保存配置"
            aria-label="重新读取已保存配置"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? "sm-spin" : ""} />
          </button>
        </div>
        <button
          type="button"
          className="sm-button sm-primary sm-add-supplier"
          onClick={() => {
            setAdding(true);
            setQuery("");
          }}
        >
          <Plus size={16} /> 添加供应商
        </button>
        <label className="sm-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索名称或地址"
            aria-label="搜索供应商"
          />
        </label>
        <div className="sm-supplier-list">
          {visibleEntries.map((entry) => {
            const count = connections.filter((connection) =>
              supplierOwnsConnection(entry, connection),
            ).length;
            return (
              <div
                className="sm-supplier-row"
                key={entry.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openMenu(entry, event.clientX, event.clientY);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "ContextMenu" ||
                    (event.shiftKey && event.key === "F10")
                  ) {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    openMenu(entry, rect.left + 25, rect.bottom);
                  }
                }}
              >
                <button
                  type="button"
                  className={`sm-supplier-item ${!adding && selected?.id === entry.id ? "is-selected" : ""}`}
                  key={entry.id}
                  onClick={() => {
                    if (selected?.id !== entry.id)
                      setDetailSession((current) => current + 1);
                    setSelectedId(entry.id);
                    setAdding(false);
                  }}
                >
                  <span className="sm-supplier-avatar">
                    {entry.name.slice(0, 1)}
                  </span>
                  <span className="sm-supplier-label">
                    <strong>{entry.name}</strong>
                    <small>
                      {count
                        ? `${count} 个已配置连接`
                        : entry.builtIn
                          ? "内置供应商 · 待配置"
                          : "等待添加分组"}
                    </small>
                  </span>
                  <ChevronRight size={14} />
                </button>
                <button
                  className="sm-icon sm-supplier-more"
                  aria-label={`${entry.name} 的更多操作`}
                  aria-haspopup="menu"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    openMenu(entry, rect.left, rect.bottom);
                  }}
                >
                  <MoreHorizontal size={17} />
                </button>
              </div>
            );
          })}
          {!visibleEntries.length && (
            <p className="sm-muted sm-list-empty">没有找到供应商</p>
          )}
        </div>
        <button
          className="sm-button sm-hidden-toggle"
          onClick={() => {
            setShowHidden((v) => !v);
            setSelectedId("");
            setAdding(false);
          }}
        >
          {showHidden
            ? "返回当前供应商"
            : `已隐藏供应商（${suppliers.filter((s) => s.state?.visibility === "hidden").length}）`}
        </button>
        <div className="sm-sidebar-foot">
          <ShieldCheck size={15} />
          <span>
            每个分组独立保存 Key
            <br />
            画布与智能体分别配置
          </span>
        </div>
        {onOpenAdvanced && (
          <button
            className="sm-advanced-link"
            type="button"
            onClick={onOpenAdvanced}
          >
            <SlidersHorizontal size={13} /> 高级连接与旧版配置
          </button>
        )}
      </aside>
      <main className="sm-main">
        {error && (
          <div className="sm-notice is-error" role="alert">
            {error}
            <button type="button" onClick={() => void load()}>
              重试
            </button>
          </div>
        )}
        {loading && !entries.length ? (
          <div className="sm-empty">
            <LoaderCircle className="sm-spin" size={28} />
            <h3>正在读取供应商</h3>
          </div>
        ) : adding ? (
          <NewSupplierForm
            onCreated={updateRecord}
            onCancel={() => setAdding(false)}
          />
        ) : selected ? (
          <SupplierDetail
            key={`${selected.id}:${selected.record?.state?.sourceId ?? "legacy"}:${detailSession}`}
            entry={selected}
            allConnections={connections}
            initialGroup={initialCangyuanGroup}
            onUpdated={(record) => updateRecord(record, selected.id)}
            onConnectionsChanged={updateConnections}
            onOpenAdvanced={onOpenAdvanced}
          />
        ) : (
          <div className="sm-empty">
            <Server size={32} />
            <h3>连接你的第一个模型供应商</h3>
            <p>填入站点地址，自动发现分组与模型。</p>
          </div>
        )}
      </main>
      {menu && (
        <div className="sm-menu-backdrop" onPointerDown={() => setMenu(null)}>
          <div
            className="sm-context-menu"
            ref={menuRef}
            role="menu"
            aria-label={`${menu.entry.name} 操作`}
            style={{ left: Math.max(8, menu.x), top: Math.max(8, menu.y) }}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape" || e.key === "Tab") {
                e.stopPropagation();
                setMenu(null);
              }
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const buttons = Array.from(
                  e.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
                );
                const i = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                buttons[
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? buttons.length - 1
                      : (i +
                          (e.key === "ArrowDown" ? 1 : -1) +
                          buttons.length) %
                        buttons.length
                ]?.focus();
              }
            }}
          >
            <button role="menuitem" onClick={() => void menuAction("rename")}>
              重命名
            </button>
            <button role="menuitem" onClick={() => void menuAction("scan")}>
              扫描当前地址
            </button>
            <button role="menuitem" onClick={() => void menuAction("site")}>
              打开站点
            </button>
            <button role="menuitem" onClick={() => void menuAction("hide")}>
              {showHidden ? "恢复显示" : "隐藏"}
            </button>
            <button
              role="menuitem"
              className="is-danger"
              onClick={() => void menuAction("delete")}
            >
              彻底删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NewSupplierForm({
  onCreated,
  onCancel,
}: {
  onCreated: (record: SupplierRecord) => void;
  onCancel: () => void;
}) {
  const [templateKey, setTemplateKey] = useState("");
  const [name, setName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function create(scan: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const site = cleanSupplierAddress(siteUrl || apiUrl);
      const api = cleanSupplierAddress(apiUrl || siteUrl);
      if (!site) throw new Error("请先填写站点地址或 API 地址。");
      const created = await createSupplier({
        name: name.trim() || new URL(site).hostname,
        ...(templateKey ? { supplierKey: templateKey } : {}),
        siteUrl: site,
        apiUrl: api,
        kind: "auto",
      });
      // Saving succeeds independently of discovery. A failed scan must not lose the new supplier.
      if (scan) {
        try {
          onCreated(
            await scanSupplier(
              created.id,
              undefined,
              created.state?.revision ?? 0,
            ),
          );
        } catch (error) {
          onCreated({
            ...created,
            scanStatus: "failed",
            scanError: errorMessage(error),
          });
        }
      } else onCreated(created);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="sm-new-supplier">
      <span className="sm-kicker">NEW SUPPLIER</span>
      <h2>让创作，连接更多可能。</h2>
      <p className="sm-lead">
        填写你的中转站地址，自动识别平台并读取公开的分组和模型。
      </p>
      <div className="sm-form-card">
        <label className="sm-field">
          <span>供应商模板</span>
          <select
            value={templateKey}
            onChange={(e) => {
              const key = e.target.value;
              setTemplateKey(key);
              const profile = PROVIDER_SUPPLIER_PROFILES.find(
                (p) => p.key === key,
              );
              setName(profile?.label ?? "");
              setSiteUrl(profile?.websiteUrl ?? "");
              setApiUrl(DEFAULT_API_URLS[key] ?? "");
            }}
          >
            <option value="">自定义站点</option>
            {PROVIDER_SUPPLIER_PROFILES.filter(
              (p) => p.key in DEFAULT_API_URLS,
            ).map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="sm-field">
          <span>
            供应商名称 <small>选填</small>
          </span>
          <input
            autoFocus
            placeholder="例如：我的模型供应商"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
        </label>
        <label className="sm-field">
          <span>站点地址</span>
          <input
            type="text"
            inputMode="url"
            placeholder="https://ai.example.com"
            value={siteUrl}
            onChange={(event) => setSiteUrl(event.target.value)}
            disabled={busy}
          />
          <small>支持站点根地址，也可粘贴带 /v1 的地址。</small>
        </label>
        <label className="sm-field">
          <span>
            API 地址 <small>与站点不同时填写</small>
          </span>
          <input
            type="text"
            inputMode="url"
            placeholder="默认使用站点地址"
            value={apiUrl}
            onChange={(event) => setApiUrl(event.target.value)}
            disabled={busy}
          />
        </label>
        <div className="sm-actions">
          <button
            className="sm-button sm-primary"
            type="button"
            disabled={busy}
            onClick={() => void create(true)}
          >
            {busy ? (
              <LoaderCircle className="sm-spin" size={15} />
            ) : (
              <RefreshCw size={15} />
            )}
            添加并扫描
          </button>
          <button
            className="sm-button"
            type="button"
            disabled={busy}
            onClick={() => void create(false)}
          >
            仅添加
          </button>
          <button
            className="sm-button sm-quiet"
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
        </div>
        {message && (
          <p className="sm-notice is-error" role="alert">
            {message}
          </p>
        )}
      </div>
      <div className="sm-guide">
        <span>01 输入地址</span>
        <ChevronRight size={13} />
        <span>02 扫描分组</span>
        <ChevronRight size={13} />
        <span>03 配置 Key</span>
      </div>
      <p className="sm-muted">
        支持 NewAPI、Sub2API 与 OpenAI
        兼容站点。优先读取模型广场，未识别到分组时自动尝试 API
        密钥页面的分组列表。
      </p>
    </section>
  );
}

function SupplierDetail({
  entry,
  allConnections,
  initialGroup,
  onUpdated,
  onConnectionsChanged,
  onOpenAdvanced,
}: {
  entry: SupplierEntry;
  allConnections: ProviderConnectionView[];
  initialGroup?: string | null;
  onUpdated: (record: SupplierRecord) => void;
  onConnectionsChanged: () => Promise<void>;
  onOpenAdvanced?: () => void;
}) {
  const [name, setName] = useState(entry.name);
  const [siteUrl, setSiteUrl] = useState(entry.siteUrl);
  const [apiUrl, setApiUrl] = useState(entry.apiUrl);
  const [kind, setKind] = useState<SupplierKind>(entry.record?.kind ?? "auto");
  const [username, setUsername] = useState(
    entry.record?.siteLogin?.username ?? "",
  );
  const [password, setPassword] = useState("");
  const [clearLogin, setClearLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [addGroup, setAddGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState({
    supplier: false,
    manual: false,
  });
  const [groupQuery, setGroupQuery] = useState("");
  const [appliedGroupQuery, setAppliedGroupQuery] = useState("");
  function clearGroupFilter() {
    setGroupQuery("");
    setAppliedGroupQuery("");
  }
  const record = entry.record;
  const connections = allConnections.filter((connection) =>
    supplierOwnsConnection(entry, connection),
  );
  const groups = useMemo(() => {
    const result = new Map(
      (record?.catalog.groups ?? []).map((group) => [group.id, group]),
    );
    for (const connection of connections) {
      const id = providerConnectionGroup(connection);
      if (!result.has(id))
        result.set(
          id,
          record?.catalog.groups.find((group) => group.id === id) ?? {
            id,
            label: id,
            source: "manual",
            models: [],
          },
        );
    }
    return [...result.values()]
      .map((group): SupplierCatalogGroup => ({
        ...group,
        source: isScannedSupplierGroup(group) ? "catalog" : "manual",
      }))
      .sort((a, b) =>
        a.id === initialGroup
          ? -1
          : b.id === initialGroup
            ? 1
            : a.id.localeCompare(b.id, "zh-CN"),
      );
  }, [record, connections, initialGroup]);
  const normalizedGroupQuery = appliedGroupQuery.trim().toLocaleLowerCase();
  const visibleGroups = groups.filter((group) =>
    `${group.id} ${group.label} ${group.models.map((model) => model.id).join(" ")}`
      .toLocaleLowerCase()
      .includes(normalizedGroupQuery),
  );

  async function saveBasics(): Promise<SupplierRecord> {
    if (password && !username.trim()) throw new Error("请填写站点账号。");
    if (
      !password &&
      !clearLogin &&
      username.trim() !== (record?.siteLogin?.username ?? "")
    )
      throw new Error("填写或更换站点账号时，请同时填写密码。");
    const loginUpdate = clearLogin
      ? { siteLogin: null }
      : password
        ? { siteLogin: { username: username.trim(), password } }
        : {};
    const site = cleanSupplierAddress(siteUrl || apiUrl);
    const api = cleanSupplierAddress(apiUrl || siteUrl);
    if (!site) throw new Error("请填写站点地址或 API 地址。");
    const input = {
      name: name.trim() || new URL(site).hostname,
      siteUrl: site,
      apiUrl: api,
      kind,
      supplierKey: entry.supplierKey,
    };
    let saved = record
      ? await updateSupplier(record.id, {
          ...input,
          ...loginUpdate,
          expectedRevision: record.state?.revision ?? 0,
        })
      : await createSupplier(input);
    if (!record && password && !clearLogin) {
      saved = await updateSupplier(saved.id, {
        ...loginUpdate,
        expectedRevision: saved.state?.revision ?? 0,
      });
    }
    setPassword("");
    setUsername(saved.siteLogin?.username ?? "");
    setClearLogin(false);
    onUpdated(saved);
    await onConnectionsChanged();
    return saved;
  }

  async function save(scan: boolean) {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const saved = await saveBasics();
      if (scan) {
        const scanned = await scanSupplier(
          saved.id,
          undefined,
          saved.state?.revision ?? 0,
        );
        clearGroupFilter();
        onUpdated(scanned);
        await onConnectionsChanged();
        setFailed(
          scanned.scanStatus === "failed" ||
            scanned.scanStatus === "unauthorized",
        );
        setMessage(
          scanned.scanError ||
            (scanned.scanStatus === "live"
              ? `已识别 ${scanned.catalog.groups.filter((group) => group.source !== "manual" && group.status !== "missing").length} 个分组。填写对应 Key，可继续读取实际可用模型。`
              : "模型广场与 API 密钥页面未返回分组。可以填写站点账号密码重试，或手动添加分组后用 Key 读取模型。"),
        );
      } else setMessage("供应商信息已保存。");
    } catch (error) {
      setFailed(true);
      setMessage(errorMessage(error, password));
    } finally {
      setBusy(false);
    }
  }

  async function createGroup() {
    if (!groupName.trim()) {
      setFailed(true);
      setMessage("请填写与供应商后台一致的分组名称。");
      return;
    }
    if (groups.some((group) => group.id === groupName.trim())) {
      setFailed(true);
      setMessage("此分组已存在，请在下方配置 Key。");
      return;
    }
    setBusy(true);
    setFailed(false);
    setMessage("");
    try {
      const saved = await saveBasics();
      onUpdated(
        await updateSupplier(saved.id, {
          expectedRevision: saved.state?.revision ?? 0,
          catalog: {
            groups: [
              {
                id: groupName.trim(),
                label: groupName.trim(),
                source: "manual",
                models: [],
              },
            ],
          },
        }),
      );
      setGroupName("");
      setCollapsedGroups((value) => ({ ...value, manual: false }));
      clearGroupFilter();
      setAddGroup(false);
      setMessage("手动分组已添加，请配置用途与 Key。");
    } catch (error) {
      setFailed(true);
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeManualGroup(group: SupplierCatalogGroup) {
    setBusy(true);
    setFailed(false);
    setMessage("");
    try {
      const saved = record ?? (await saveBasics());
      const updated = await deleteManualSupplierGroup(
        saved.id,
        group.id,
        saved.state?.revision ?? 0,
      );
      connections
        .filter(
          (connection) => providerConnectionGroup(connection) === group.id,
        )
        .forEach((connection) => invalidateModelCache(connection.id));
      onUpdated(updated);
      await onConnectionsChanged();
      setMessage(`已删除手动分组“${group.id}”及其保存的 Key。`);
    } catch (error) {
      setFailed(true);
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sm-detail">
      <header className="sm-detail-heading">
        <div>
          <span className="sm-kicker">SUPPLIER WORKSPACE</span>
          <h2>{entry.name}</h2>
          <p>一个地址，管理所有分组与模型。</p>
        </div>
        <span
          className={`sm-badge ${record?.scanStatus === "live" ? "is-success" : ""}`}
        >
          <span className="sm-status-dot" />
          {catalogStatus(record)}
        </span>
      </header>
      {record && (
        <details className="sm-history">
          <summary>
            历史配置（
            {(record.state?.history.length ?? 0) +
              record.catalog.groups.filter((g) => g.status === "missing")
                .length}
            ）
          </summary>
          <p className="sm-muted">
            历史分组与 Key
            不参与当前地址扫描，也不出现在可执行模型中。恢复会切换地址，并归档当前配置。
          </p>
          {(record.state?.history ?? []).map((h) => (
            <article key={h.id} className="sm-history-card">
              <strong>
                {h.reason === "legacy-unverified" ? "待复核历史" : "已归档配置"}
              </strong>
              <p>
                站点：{h.siteUrl || "未填写"}
                <br />
                API：{h.apiUrl || "未填写"}
              </p>
              <small>
                {new Date(h.archivedAt).toLocaleString()} ·{" "}
                {
                  new Set([
                    ...h.catalog.groups.map((g) => g.id),
                    ...(h.connections ?? []).map((c) => c.group),
                  ]).size
                }{" "}
                个分组 ·{" "}
                {
                  new Set([
                    ...h.catalog.groups.flatMap((g) =>
                      g.models.map((m) => m.id),
                    ),
                    ...(h.connections ?? []).flatMap((c) => c.modelIds),
                  ]).size
                }{" "}
                个模型 · {h.connectionIds.length} 个已保存连接
              </small>
              <details>
                <summary>查看分组与模型</summary>
                {h.catalog.groups.map((g) => (
                  <p key={g.id}>
                    {g.label}：
                    {g.models.map((m) => m.id).join("、") || "无目录模型"}
                  </p>
                ))}
                {h.connections?.map((c) => (
                  <p key={c.id}>
                    {c.name} · {c.usage === "agent" ? "智能体" : "画布"} ·{" "}
                    {c.keyConfigured ? "原 Key 已保存" : "未配置 Key"}
                    <br />
                    {c.modelIds.join("、") || "尚未扫描模型"}
                  </p>
                ))}
              </details>
              <button
                className="sm-button"
                disabled={busy}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `恢复历史配置？\n当前 API：${record.apiUrl}\n将切换到：${h.apiUrl}\n恢复 ${h.connectionIds.length} 个原连接及原 Key，当前配置将归档。${h.reason === "legacy-unverified" ? "此历史来源待复核，请确认地址无误。" : ""}`,
                    )
                  )
                    return;
                  setBusy(true);
                  try {
                    const restored = await restoreSupplierSource(
                      record.id,
                      h.id,
                      record.state?.revision ?? 0,
                    );
                    onUpdated(restored);
                    await onConnectionsChanged();
                  } catch (e) {
                    setFailed(true);
                    setMessage(errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                恢复此配置
              </button>
            </article>
          ))}
          {record.catalog.groups
            .filter((g) => g.status === "missing")
            .map((g) => (
              <p key={g.id}>
                {g.label} · {g.models.length} 个历史模型 · 本次目录未返回
              </p>
            ))}
          {!record.state?.history.length &&
            !record.catalog.groups.some((g) => g.status === "missing") && (
              <p>暂无历史配置</p>
            )}
        </details>
      )}
      <section className="sm-basics">
        <div className="sm-section-title">
          <Globe2 size={17} />
          <h3>连接地址</h3>
          {entry.builtIn && <span className="sm-badge">内置供应商</span>}
        </div>
        <div className="sm-form-grid">
          <label className="sm-field">
            <span>供应商名称</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="sm-field">
            <span>平台类型</span>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as SupplierKind)}
              disabled={busy}
            >
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="sm-field">
            <span>站点地址</span>
            <input
              value={siteUrl}
              onChange={(event) => setSiteUrl(event.target.value)}
              placeholder="https://ai.example.com"
              disabled={busy}
            />
          </label>
          <label className="sm-field">
            <span>API 地址</span>
            <input
              value={apiUrl}
              onChange={(event) => setApiUrl(event.target.value)}
              placeholder="默认与站点相同"
              disabled={busy}
            />
          </label>
        </div>
        <p className="sm-muted">
          站点登录（选填）：密码加密保存，刷新时自动登录查询分组、模型和价格。
        </p>
        <div className="sm-form-grid">
          <label className="sm-field">
            <span>站点账号</span>
            <input
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setClearLogin(false);
              }}
              autoComplete="off"
              placeholder="用户名或邮箱"
              disabled={busy}
            />
          </label>
          <label className="sm-field">
            <span>站点密码</span>
            <input
              type="password"
              name={`supplier-site-password-${entry.id}`}
              autoComplete="new-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setClearLogin(false);
              }}
              placeholder={
                record?.siteLogin?.configured && !clearLogin
                  ? "已保存，留空保持原密码"
                  : "请输入站点登录密码"
              }
              disabled={busy}
            />
          </label>
        </div>
        {record?.siteLogin?.configured && (
          <button
            type="button"
            className="sm-button"
            disabled={busy || clearLogin}
            onClick={() => {
              setClearLogin(true);
              setUsername("");
              setPassword("");
            }}
          >
            {clearLogin ? "保存后清除登录信息" : "清除已保存登录"}
          </button>
        )}
        <div className="sm-basics-footer">
          <div className="sm-actions">
            <button
              type="button"
              className="sm-button sm-primary"
              onClick={() => void save(true)}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="sm-spin" size={14} />
              ) : (
                <RefreshCw size={14} />
              )}
              保存并扫描
            </button>
            <button
              type="button"
              className="sm-button"
              onClick={() => void save(false)}
              disabled={busy}
            >
              仅保存
            </button>
          </div>
          {record?.scannedAt && (
            <span className="sm-muted">
              上次扫描{" "}
              {new Date(record.scannedAt).toLocaleString("zh-CN", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
        {(message || record?.scanError) && (
          <div
            className={`sm-notice ${failed || (!message && (record?.scanStatus === "failed" || record?.scanStatus === "unauthorized")) ? "is-error" : ""}`}
            role="status"
          >
            {message || record?.scanError}
          </div>
        )}
      </section>
      <section className="sm-groups">
        <div className="sm-groups-heading">
          <div>
            <div className="sm-section-title">
              <Layers3 size={17} />
              <h3>分组与模型</h3>
              <span className="sm-count">{groups.length}</span>
            </div>
            <p>各分组分别保存 Key；模型以这把 Key 的扫描结果为准。</p>
          </div>
          <button
            className="sm-button"
            type="button"
            onClick={() => setAddGroup((value) => !value)}
            disabled={busy}
          >
            <Plus size={14} /> 手动添加分组
          </button>
        </div>
        {addGroup && (
          <div className="sm-add-group">
            <label className="sm-field">
              <span>分组名称</span>
              <input
                autoFocus
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="填写后台分组名，例如 default、vip"
                disabled={busy}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createGroup();
                }}
              />
            </label>
            <button
              className="sm-button sm-primary"
              type="button"
              onClick={() => void createGroup()}
              disabled={busy}
            >
              添加
            </button>
            <button
              className="sm-button sm-quiet"
              type="button"
              onClick={() => setAddGroup(false)}
              disabled={busy}
            >
              取消
            </button>
          </div>
        )}
        {(groups.length > 4 || groupQuery || appliedGroupQuery) && (
          <form
            className="sm-search sm-group-search"
            role="search"
            aria-label="分组与模型筛选"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              setAppliedGroupQuery(groupQuery);
              setCollapsedGroups({ supplier: false, manual: false });
            }}
          >
            <Search size={14} />
            <input
              type="search"
              name="supplier-group-filter"
              autoComplete="off"
              spellCheck={false}
              value={groupQuery}
              onChange={(event) => setGroupQuery(event.target.value)}
              placeholder="输入分组或模型 ID，按回车查找"
              aria-label="查找分组或模型"
              onKeyDown={(event) => {
                if (
                  event.key === "Escape" &&
                  (groupQuery || appliedGroupQuery)
                ) {
                  event.stopPropagation();
                  clearGroupFilter();
                }
              }}
            />
            <button className="sm-button" type="submit">
              查找
            </button>
            {(groupQuery || appliedGroupQuery) && (
              <button
                className="sm-icon"
                type="button"
                aria-label="清除分组筛选"
                onClick={clearGroupFilter}
              >
                <X size={14} />
              </button>
            )}
          </form>
        )}
        {normalizedGroupQuery && groups.length > 0 && (
          <p className="sm-muted" role="status">
            显示 {visibleGroups.length} / {groups.length} 个分组
          </p>
        )}
        {(["supplier", "manual"] as const).map((section) => {
          const manual = section === "manual";
          const all = groups.filter(
            (group) => (group.source === "manual") === manual,
          );
          const filtered = visibleGroups.filter(
            (group) => (group.source === "manual") === manual,
          );
          const title = manual ? "手动分组" : "供应商分组";
          return (
            <section
              className="sm-group-section"
              aria-label={title}
              key={section}
            >
              <button
                className="sm-group-section-toggle"
                type="button"
                aria-expanded={!collapsedGroups[section]}
                onClick={() =>
                  setCollapsedGroups((value) => ({
                    ...value,
                    [section]: !value[section],
                  }))
                }
              >
                {collapsedGroups[section] ? (
                  <ChevronRight size={16} />
                ) : (
                  <ChevronDown size={16} />
                )}
                <strong>{title}</strong>
                <span className="sm-count">{all.length}</span>
                <span className="sm-group-section-action">
                  {collapsedGroups[section] ? "展开" : "收起"}
                </span>
              </button>
              <div hidden={collapsedGroups[section]}>
                <p className="sm-muted">
                  {manual
                    ? "自己添加的分组；删除时一并移除该分组在本应用保存的 Key。"
                    : "平台实际扫描返回的分组。"}
                </p>
                {filtered.map((group) => (
                  <SupplierGroup
                    key={group.id}
                    supplier={entry}
                    group={group}
                    connections={connections}
                    ensureSupplier={saveBasics}
                    onConnectionsChanged={onConnectionsChanged}
                    onOpenAdvanced={onOpenAdvanced}
                    onDelete={
                      manual ? () => void removeManualGroup(group) : undefined
                    }
                    deleting={busy}
                  />
                ))}
                {!filtered.length && (
                  <p className="sm-muted">
                    {all.length
                      ? "没有匹配的分组"
                      : manual
                        ? "暂无手动分组"
                        : "暂无供应商分组"}
                  </p>
                )}
              </div>
            </section>
          );
        })}
        {groups.length > 0 && visibleGroups.length === 0 && (
          <div className="sm-empty sm-group-empty" role="status">
            <Search size={27} />
            <h3>没有匹配“{appliedGroupQuery.trim()}”的分组或模型</h3>
            <p>已有 {groups.length} 个分组，当前搜索条件隐藏了它们。</p>
            <button
              className="sm-button"
              type="button"
              onClick={clearGroupFilter}
            >
              显示全部分组
            </button>
          </div>
        )}
        {!groups.length && (
          <div className="sm-empty sm-group-empty">
            <Layers3 size={27} />
            <h3>
              {record?.scanStatus === "unscanned" || !record
                ? "准备好你的第一个分组"
                : "这个站点没有公开分组目录"}
            </h3>
            <p>先扫描站点，或手动填写分组名，再用 Key 读取可用模型。</p>
            <button
              className="sm-button"
              type="button"
              onClick={() => setAddGroup(true)}
            >
              <Plus size={14} /> 手动添加分组
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function SupplierGroup({
  supplier,
  group,
  connections,
  ensureSupplier,
  onConnectionsChanged,
  onOpenAdvanced,
  onDelete,
  deleting,
}: {
  supplier: SupplierEntry;
  group: SupplierCatalogGroup;
  connections: ProviderConnectionView[];
  ensureSupplier: () => Promise<SupplierRecord>;
  onConnectionsChanged: () => Promise<void>;
  onOpenAdvanced?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const initial = connections.find(
    (connection) => providerConnectionGroup(connection) === group.id,
  );
  const [usage, setUsage] = useState<ProviderConnectionUsage>(
    initial
      ? providerConnectionUsage(initial)
      : group.models.length > 0 &&
          group.models.every(
            (model) =>
              model.capability === "chat" || model.capability === "other",
          )
        ? "agent"
        : "canvas",
  );
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const matchingConnections = connections.filter(
    (item) =>
      providerConnectionGroup(item) === group.id &&
      providerConnectionUsage(item) === usage,
  );
  const connection =
    matchingConnections.find((item) => item.id === selectedConnectionId) ??
    findSupplierGroupConnection(connections, group.id, usage);
  return (
    <article className="sm-group-card">
      <header className="sm-group-header">
        <div className="sm-group-identity">
          <h4>{group.id}</h4>
          {group.label !== group.id && <span>{group.label}</span>}
          <span
            className={`sm-badge ${group.source === "manual" ? "is-manual" : ""}`}
          >
            {group.source === "manual"
              ? "手动分组"
              : group.status === "missing"
                ? "本次目录未返回（保留历史）"
                : group.source === "catalog"
                  ? "站点目录"
                  : "已保存分组"}
          </span>
        </div>
        {onDelete && (
          <button
            type="button"
            className="sm-button sm-delete-group"
            disabled={deleting}
            aria-label={`删除手动分组 ${group.id}`}
            title="删除分组及其保存的 Key"
            onClick={onDelete}
          >
            <Trash2 size={14} /> 删除
          </button>
        )}
        <label className="sm-usage">
          <span>用途</span>
          <select
            aria-label={`${group.id} 的用途`}
            value={usage}
            onChange={(event) =>
              setUsage(event.target.value as ProviderConnectionUsage)
            }
          >
            <option value="canvas">画布生图 / 视频</option>
            <option value="agent">智能体对话</option>
            {connections.some(
              (item) =>
                providerConnectionGroup(item) === group.id &&
                providerConnectionUsage(item) === "disabled",
            ) && <option value="disabled">已停用连接</option>}
          </select>
        </label>
      </header>
      {matchingConnections.length > 1 && (
        <label className="sm-field sm-existing-connections">
          <span>已保存的连接</span>
          <select
            value={connection?.id}
            onChange={(event) => setSelectedConnectionId(event.target.value)}
          >
            {matchingConnections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <GroupConnectionEditor
        key={`${supplier.id}:${supplier.record?.state?.sourceId ?? "legacy"}:${group.id}:${usage}:${selectedConnectionId}`}
        supplier={supplier}
        group={group}
        usage={usage}
        connection={connection}
        ensureSupplier={ensureSupplier}
        onConnectionsChanged={onConnectionsChanged}
        onOpenAdvanced={onOpenAdvanced}
      />
    </article>
  );
}

function GroupConnectionEditor({
  supplier,
  group,
  usage,
  connection,
  ensureSupplier,
  onConnectionsChanged,
  onOpenAdvanced,
}: {
  supplier: SupplierEntry;
  group: SupplierCatalogGroup;
  usage: ProviderConnectionUsage;
  connection?: ProviderConnectionView;
  ensureSupplier: () => Promise<SupplierRecord>;
  onConnectionsChanged: () => Promise<void>;
  onOpenAdvanced?: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [addingModel, setAddingModel] = useState(false);
  const [modelId, setModelId] = useState("");
  const [capability, setCapability] = useState<"image" | "video" | "chat">(
    usage === "agent" ? "chat" : "image",
  );
  const [protocol, setProtocol] = useState<SupplierModelProtocol>(
    connection?.config.protocol === "responses"
      ? "responses"
      : connection?.config.protocol === "gemini"
        ? "gemini"
        : usage === "agent"
          ? "chat-completions"
          : "openai-images",
  );
  const [models, setModels] = useState<ModelDescriptor[]>(() =>
    savedModels(connection),
  );
  const [modelStatus, setModelStatus] = useState(
    typeof connection?.config.modelScanStatus === "string"
      ? connection.config.modelScanStatus
      : "unscanned",
  );
  const [defaultModel, setDefaultModel] = useState(
    typeof connection?.config.defaultModel === "string"
      ? connection.config.defaultModel
      : "",
  );
  const alive = useRef(true);
  const requestRevision = useRef(0);
  const latestConnection = useRef(connection);
  useEffect(() => {
    latestConnection.current = connection;
  }, [connection]);
  const draft = connection
    ? undefined
    : supplierConnectionDraft(
        supplier.supplierKey,
        group,
        usage,
        supplier.apiUrl || supplier.siteUrl,
      );
  const provider = connection?.provider ?? draft!.provider;
  const protocols = manualModelProtocols(
    provider,
    usage,
    connection?.config ?? (usage === "agent" ? undefined : draft?.config),
  );
  const capabilities = manualModelCapabilities(
    provider,
    usage,
    connection?.config ?? draft?.config,
  );
  const effectiveProtocol = protocols.includes(protocol)
    ? protocol
    : (protocols[0] ?? protocol);
  const effectiveCapability = capabilities.includes(capability)
    ? capability
    : (capabilities[0] ?? capability);
  const manualModels = manualModelsForConnection(connection);
  const modelReadVersion = `${connection?.config.modelScanCheckedAt ?? ""}:${connection?.config.modelScanRequestId ?? ""}`;
  const connectionId = connection?.id;
  const modelSnapshotVersion = `${connectionId ?? ""}:${modelReadVersion}`;
  const [displayedModelVersion, setDisplayedModelVersion] = useState(modelSnapshotVersion);
  if (displayedModelVersion !== modelSnapshotVersion) {
    setDisplayedModelVersion(modelSnapshotVersion);
    setModels(savedModels(connection));
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      requestRevision.current += 1;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!connectionId || !expanded) return;
    void readSupplierModels(connectionId, false)
      .then(({ models: items, status }) => {
        if (!alive.current || cancelled) return;
        const savedStatus = latestConnection.current?.config.modelScanStatus;
        setModels(items);
        setModelStatus(
          status ??
            (typeof savedStatus === "string" ? savedStatus : "unscanned"),
        );
      })
      .catch((error: unknown) => {
        if (!alive.current || cancelled) return;
        setFailed(true);
        setModelStatus("failed");
        setMessage(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, expanded, modelReadVersion]);

  async function persist(
    extra?: Record<string, unknown>,
  ): Promise<ProviderConnectionView> {
    const parent = supplier.record ?? (await ensureSupplier());
    const current = latestConnection.current;
    const key = apiKey.trim();
    if (!current?.apiKeySet && !key)
      throw new Error("请填写此分组的 API Key。");
    const config: Record<string, unknown> = current
      ? { ...current.config }
      : supplierConnectionDraft(
          parent.supplierKey,
          group,
          usage,
          parent.apiUrl || parent.siteUrl,
        ).config;
    Object.assign(config, {
      supplierId: parent.id,
      supplierSourceId: parent.state?.sourceId,
      supplierKey: parent.supplierKey,
      usage,
      defaultModel:
        defaultModel.trim() || (!current ? (config.defaultModel ?? "") : ""),
      ...extra,
    });
    if (!current && usage === "agent") {
      config.directorProtocol =
        protocol === "responses"
          ? "openai-responses"
          : protocol === "chat-completions"
            ? "openai-chat-completions"
            : protocol;
      config.protocol = protocol;
    }
    const saved = await saveConnection({
      id: current?.id,
      name:
        current?.name ??
        `${parent.name} · ${group.id} · ${usage === "agent" ? "智能体" : "画布"}`,
      provider,
      apiKey: key || undefined,
      config,
    });
    latestConnection.current = saved;
    if (key) {
      setModels(savedModels(saved));
      setModelStatus(
        typeof saved.config.modelScanStatus === "string"
          ? saved.config.modelScanStatus
          : "unscanned",
      );
    }
    setApiKey("");
    setDefaultModel(
      typeof saved.config.defaultModel === "string"
        ? saved.config.defaultModel
        : "",
    );
    await onConnectionsChanged();
    return saved;
  }

  async function runAction(action: "save" | "test" | "refresh") {
    setBusy(true);
    setMessage("");
    setFailed(false);
    const revision = ++requestRevision.current;
    try {
      const current =
        action === "save" || apiKey.trim() || !latestConnection.current
          ? await persist()
          : latestConnection.current;
      if (action === "save") {
        if (alive.current) setMessage("此分组的 Key 与配置已保存。");
        return;
      }
      if (!current.apiKeySet) throw new Error("请先保存此分组的 Key。");
      const testResult =
        action === "test" ? await testConnection(current.id) : "";
      const result = await readSupplierModels(current.id, true);
      if (!alive.current || revision !== requestRevision.current) return;
      setModels(result.models);
      setModelStatus(
        result.status ?? (result.models.length ? "live" : "empty"),
      );
      setExpanded(true);
      setMessage(
        result.models.length
          ? `${testResult ? `${testResult}；` : ""}已读取 ${result.models.length} 个模型。`
          : "Key 模型列表读取成功，返回 0 个模型。",
      );
      await onConnectionsChanged();
    } catch (error) {
      if (alive.current && revision === requestRevision.current) {
        setFailed(true);
        if (action !== "save") setModelStatus("failed");
        setMessage(errorMessage(error, apiKey));
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function addManualModel() {
    const id = modelId.trim();
    if (!id) {
      setFailed(true);
      setMessage("请输入供应商提供的准确模型 ID。");
      return;
    }
    if (
      !protocols.includes(effectiveProtocol) ||
      !capabilities.includes(effectiveCapability)
    ) {
      setFailed(true);
      setMessage("此连接不支持所选协议，请使用高级连接配置。");
      return;
    }
    if (manualModels.some((model) => model.id === id)) {
      setFailed(true);
      setMessage("这个模型已经手动添加。");
      return;
    }
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const manual: ManualSupplierModel = {
        id,
        name: id,
        capability: effectiveCapability,
        protocol: effectiveProtocol,
      };
      await persist({ manualModels: [...manualModels, manual] });
      if (!alive.current) return;
      setModelId("");
      setAddingModel(false);
      setExpanded(true);
      setMessage(
        "模型已手动添加，标记为未验证。模型 ID 与能力是否可用以实际调用结果为准。",
      );
    } catch (error) {
      if (alive.current) {
        setFailed(true);
        setMessage(errorMessage(error, apiKey));
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const grantedIds = Array.isArray(connection?.config.scannedModelIds)
    ? connection.config.scannedModelIds
    : [];
  const actualModels = models.filter(
    (model) =>
      grantedIds.includes(model.id) ||
      (model.metadata?.manual !== true && model.metadata?.source !== "manual"),
  );
  const visibleCatalog = group.models.filter((model) =>
    usage === "agent"
      ? model.capability === "chat"
      : model.capability === "image" || model.capability === "video",
  );
  const realScan = modelStatus === "live" || modelStatus === "empty";
  const modelCount = realScan ? actualModels.length : 0;
  return (
    <form
      className="sm-group-body"
      autoComplete="off"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="sm-key-row">
        <label className="sm-key-field">
          <ShieldCheck size={15} />
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            name={`supplier-api-key-${supplier.id}-${group.id}-${usage}`}
            autoComplete="new-password"
            spellCheck={false}
            placeholder={
              connection?.apiKeySet
                ? "Key 已加密保存 · 留空保留原 Key"
                : `粘贴${usage === "agent" ? "智能体" : "画布"}分组的 API Key`
            }
            aria-label={`${group.id} ${usage === "agent" ? "智能体" : "画布"} API Key`}
            onChange={(event) => setApiKey(event.target.value)}
            disabled={busy}
          />
          <button
            className="sm-icon"
            type="button"
            aria-label={showKey ? "隐藏新输入的 Key" : "显示新输入的 Key"}
            onClick={() => setShowKey((value) => !value)}
          >
            {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </label>
        <button
          className="sm-button"
          type="button"
          onClick={() => void runAction("save")}
          disabled={busy}
        >
          {busy ? (
            <LoaderCircle className="sm-spin" size={13} />
          ) : (
            <Check size={13} />
          )}
          保存
        </button>
        <button
          className="sm-button sm-primary-soft"
          type="button"
          onClick={() => void runAction("test")}
          disabled={busy || (!connection?.apiKeySet && !apiKey.trim())}
        >
          测试并读取
        </button>
      </div>
      <div className="sm-key-meta">
        <span className={connection?.apiKeySet ? "sm-key-saved" : ""}>
          {connection?.apiKeySet ? "● 已配置独立 Key" : "○ 尚未配置 Key"}
        </span>
        <span>
          {usage === "agent"
            ? "仅供智能体对话使用"
            : usage === "disabled"
              ? "此连接已停用"
              : "供画布图片 / 视频模型使用"}
        </span>
        {connection?.provider && <span>接口：{connection.provider}</span>}
      </div>
      {message && (
        <p className={`sm-notice ${failed ? "is-error" : ""}`} role="status">
          {message}
        </p>
      )}
      {connection?.apiKeySet &&
        typeof connection.config.disabledReason === "string" && (
          <p className="sm-notice" role="status">
            Key 已保存。{connection.config.disabledReason}
          </p>
        )}
      <div className="sm-model-toolbar">
        <button
          type="button"
          className="sm-model-toggle"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          模型清单{" "}
          <span>
            {realScan ? `Key 结果 ${modelCount}` : "Key 未验证"}
            {manualModels.length ? ` · 手动 ${manualModels.length}` : ""}
          </span>
        </button>
        <div className="sm-actions">
          <button
            className="sm-text-button"
            type="button"
            onClick={() => void runAction("refresh")}
            disabled={busy || (!connection?.apiKeySet && !apiKey.trim())}
          >
            <RefreshCw size={12} /> 刷新模型
          </button>
          <button
            className="sm-text-button"
            type="button"
            onClick={() => {
              setAddingModel((value) => !value);
              setExpanded(true);
            }}
            disabled={busy}
          >
            <Plus size={12} /> 手动添加模型
          </button>
        </div>
      </div>
      {addingModel && (
        <div className="sm-manual-model-form">
          {protocols.length ? (
            <>
              <div className="sm-form-grid">
                <label className="sm-field">
                  <span>准确模型 ID</span>
                  <input
                    autoFocus
                    value={modelId}
                    onChange={(event) => setModelId(event.target.value)}
                    placeholder="完整粘贴供应商的模型 ID"
                    spellCheck={false}
                    disabled={busy}
                  />
                </label>
                <label className="sm-field">
                  <span>能力类型</span>
                  <select
                    value={effectiveCapability}
                    onChange={(event) =>
                      setCapability(
                        event.target.value as "image" | "video" | "chat",
                      )
                    }
                    disabled={busy}
                  >
                    {capabilities.map((value) => (
                      <option key={value} value={value}>
                        {CAPABILITY_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="sm-field">
                  <span>调用协议</span>
                  <select
                    value={effectiveProtocol}
                    onChange={(event) =>
                      setProtocol(event.target.value as SupplierModelProtocol)
                    }
                    disabled={busy}
                  >
                    {protocols.map((value) => (
                      <option key={value} value={value}>
                        {PROTOCOL_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="sm-actions">
                <button
                  className="sm-button sm-primary"
                  type="button"
                  onClick={() => void addManualModel()}
                  disabled={busy}
                >
                  保存为未验证模型
                </button>
                <button
                  className="sm-button sm-quiet"
                  type="button"
                  onClick={() => setAddingModel(false)}
                  disabled={busy}
                >
                  取消
                </button>
              </div>
              <p className="sm-muted">
                {provider === "rest" && usage === "canvas"
                  ? "复用当前连接已配置的协议。模型 ID 须在连接器目录内，图片与视频能力分别验证。"
                  : "仅添加到当前用途。图片和对话可直接配置，视频需使用已有 REST 连接器协议。"}
              </p>
              {usage === "canvas" && provider !== "rest" && onOpenAdvanced && (
                <button
                  className="sm-text-button"
                  type="button"
                  onClick={onOpenAdvanced}
                >
                  配置视频 / 其他 REST 协议 <ArrowUpRight size={12} />
                </button>
              )}
            </>
          ) : (
            <div className="sm-notice">
              此连接使用专用协议，请在高级连接中配置准确模型与调用方式。
              {onOpenAdvanced && (
                <button type="button" onClick={onOpenAdvanced}>
                  打开高级连接 <ArrowUpRight size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {expanded && (
        <div className="sm-model-lists">
          <ModelList
            title="Key 实际读取"
            badge={
              realScan
                ? modelStatus === "empty"
                  ? "成功 · 空列表"
                  : "已读取"
                : actualModels.length
                  ? "上次结果 · 本次未确认"
                  : "未验证"
            }
            models={actualModels.map((model) => ({
              id: model.id,
              name: model.name,
              capability: "other",
            }))}
            empty={
              realScan
                ? "这把 Key 当前没有返回可用模型。"
                : "保存 Key 后测试或刷新，读取这把 Key 的实际模型。"
            }
          />
          {visibleCatalog.length > 0 && (
            <ModelList
              title={group.source === "manual" ? "手动目录" : "站点目录"}
              badge="目录参考 · 未验证 Key"
              models={visibleCatalog}
              empty="目录未提供对应模型。"
            />
          )}
          <ModelList
            title="手动添加"
            badge="未验证"
            models={manualModels}
            empty="没有手动模型。扫描不到时可填写准确模型 ID。"
          />
          {connection && (
            <label className="sm-field sm-default-model">
              <span>
                默认模型 ID <small>可留空，在创作时选择</small>
              </span>
              <div className="sm-default-model-row">
                <input
                  value={defaultModel}
                  onChange={(event) => setDefaultModel(event.target.value)}
                  placeholder="选择或填写准确模型 ID"
                  list={`sm-models-${connection.id}`}
                  disabled={busy}
                />
                <datalist id={`sm-models-${connection.id}`}>
                  {[
                    ...new Set([
                      ...actualModels.map((model) => model.id),
                      ...manualModels.map((model) => model.id),
                    ]),
                  ].map((id) => (
                    <option key={id} value={id} />
                  ))}
                </datalist>
                <button
                  className="sm-button"
                  type="button"
                  onClick={() => void runAction("save")}
                  disabled={busy}
                >
                  保存默认
                </button>
              </div>
            </label>
          )}
        </div>
      )}
    </form>
  );
}

function ModelList({
  title,
  badge,
  models,
  empty,
}: {
  title: string;
  badge: string;
  models: readonly SupplierCatalogModel[];
  empty: string;
}) {
  return (
    <section className="sm-model-section">
      <div className="sm-model-section-title">
        <strong>{title}</strong>
        <span>{models.length} 个</span>
        <small>{badge}</small>
      </div>
      {models.length ? (
        <div className="sm-model-items">
          {models.map((model) => (
            <div className="sm-model-item" key={model.id}>
              <code title={model.id}>{model.id}</code>
              <span>
                {model.capability !== "other"
                  ? CAPABILITY_LABELS[model.capability]
                  : ""}
              </span>
              {model.protocol && model.protocol !== "unknown" && (
                <small>{PROTOCOL_LABELS[model.protocol]}</small>
              )}
              {model.priceLabel && <small>{model.priceLabel}</small>}
            </div>
          ))}
        </div>
      ) : (
        <p className="sm-model-empty">{empty}</p>
      )}
    </section>
  );
}
