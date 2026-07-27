"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Clock3,
  Film,
  KeyRound,
  Pin,
  PlugZap,
  Plus,
  RefreshCw,
  Server,
  X,
} from "lucide-react";
import {
  deleteConnection,
  fetchCangyuanCatalog,
  fetchCangyuanMarketplace,
  fetchConnections,
  fetchRuns,
  saveConnection,
  testConnection,
  type ProviderConnectionView,
  type CangyuanMarketplaceGroupView,
} from "../lib/client-api";
import type { ModelDescriptor } from "@super-canvas/providers";
import {
  CANGYUAN_ALL_MODELS_GROUP,
  CANGYUAN_BACKUP_IMAGE_GROUP,
  CANGYUAN_IMAGE_GROUP,
  CANGYUAN_IMAGE_GROUP_OPTIONS,
  CANGYUAN_IMAGE_BASE_URL,
  CANGYUAN_IMAGE_PRESET_ID,
  cangyuanDefaultModelForGroup,
  cangyuanImageConnectorForGroup,
  isCangyuanImagePreset,
  isCangyuanImageGroup,
  type CangyuanImageGroup,
} from "../lib/provider-presets";
import {
  providerConnectionGroup,
  providerConnectionSupplierKey,
  providerConnectionUsage,
  providerSupplierLabel,
  type ProviderConnectionUsage,
} from "../lib/provider-connection-options";
import { localizeRunError } from "../lib/error-localization";
import type { AssetView, RunSnapshot } from "./types";

interface ModalProps {
  open: boolean;
  onClose: () => void;
}

interface SettingsModalProps extends ModalProps {
  initialCangyuanGroup?: string | null;
}

function cangyuanGroupUsage(
  group: CangyuanMarketplaceGroupView | undefined,
): ProviderConnectionUsage {
  return group &&
    !group.canvasSupported &&
    group.models.some((model) => model.capability === "chat")
    ? "agent"
    : "canvas";
}

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter(
    (element) =>
      !element.hidden &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );
}

function useDialogFocus(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const focusDialog = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      (getFocusableElements(dialog)[0] ?? dialog).focus({
        preventScroll: true,
      });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (
        !event.shiftKey &&
        (active === last || !dialog.contains(active))
      ) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusDialog);
      document.removeEventListener("keydown", handleKeyDown, true);
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [open]);

  return dialogRef;
}

const defaultRestConfig = {
  baseUrl: "https://api.example.com",
  connector: {
    auth: { type: "bearer" },
    allowedHosts: ["api.example.com"],
    submit: {
      path: "/generate",
      method: "POST",
      bodyMode: "json",
      template: {},
      mappings: [
        { source: { kind: "request", path: "$.prompt" }, target: "/prompt" },
      ],
      response: { taskIdPath: "$.id", statusPath: "$.status" },
    },
    poll: {
      path: "/tasks/{taskId}",
      method: "GET",
      bodyMode: "none",
      response: { statusPath: "$.status" },
    },
    statusMap: {
      queued: "queued",
      running: "running",
      processing: "running",
      succeeded: "succeeded",
      completed: "succeeded",
      failed: "failed",
      error: "failed",
      cancelled: "cancelled",
    },
    output: { path: "$.output", kind: "image", defaultMimeType: "image/png" },
  },
};

export function SettingsModal({
  open,
  onClose,
  initialCangyuanGroup,
}: SettingsModalProps) {
  const [connections, setConnections] = useState<ProviderConnectionView[]>([]);
  const [selectedSupplierKey, setSelectedSupplierKey] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [name, setName] = useState("OpenAI 图片");
  const [provider, setProvider] = useState("openai");
  const [presetId, setPresetId] = useState<string | null>(null);
  const [modelGroup, setModelGroup] = useState<CangyuanImageGroup>(
    CANGYUAN_ALL_MODELS_GROUP,
  );
  const [cangyuanModels, setCangyuanModels] = useState<ModelDescriptor[]>(
    () => [
      ...(cangyuanImageConnectorForGroup(CANGYUAN_ALL_MODELS_GROUP).models ??
        []),
    ],
  );
  const [cangyuanGroups, setCangyuanGroups] = useState<
    CangyuanMarketplaceGroupView[]
  >([]);
  const [selectedMarketplaceGroup, setSelectedMarketplaceGroup] =
    useState<string>(CANGYUAN_ALL_MODELS_GROUP);
  const [selectedMarketplaceModel, setSelectedMarketplaceModel] =
    useState<string>("");
  const [catalogSource, setCatalogSource] = useState<
    "live" | "stale" | "fallback"
  >("fallback");
  const catalogRequestRef = useRef(0);
  const [apiKey, setApiKey] = useState("");
  const [editingCangyuanKey, setEditingCangyuanKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [preservedConfig, setPreservedConfig] = useState<
    Record<string, unknown>
  >({});
  const [connectorJson, setConnectorJson] = useState(
    JSON.stringify(defaultRestConfig.connector, null, 2),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useDialogFocus(open, onClose);
  const supplierKeys = Array.from(
    new Set([
      ...(cangyuanGroups.length > 0 ? ["cangyuan"] : []),
      ...connections.map(providerConnectionSupplierKey),
    ]),
  );
  const selectedConnection = selectedId
    ? connections.find((connection) => connection.id === selectedId)
    : undefined;
  const activeSupplierKey = supplierKeys.includes(selectedSupplierKey)
    ? selectedSupplierKey
    : selectedConnection
      ? providerConnectionSupplierKey(selectedConnection)
      : (supplierKeys[0] ?? "");
  const activeSupplierConnections = connections.filter(
    (connection) =>
      providerConnectionSupplierKey(connection) === activeSupplierKey,
  );
  const activeMarketplaceGroup = cangyuanGroups.find(
    (group) => group.id === selectedMarketplaceGroup,
  );
  const activeMarketplaceModel = activeMarketplaceGroup?.models.find(
    (model) => model.id === selectedMarketplaceModel,
  );
  const activeConnectionUsage = cangyuanGroupUsage(activeMarketplaceGroup);
  const activeCangyuanConnection = connections.find(
    (connection) =>
      providerConnectionSupplierKey(connection) === "cangyuan" &&
      providerConnectionGroup(connection) === selectedMarketplaceGroup &&
      providerConnectionUsage(connection) === activeConnectionUsage,
  );
  const activeGroupKeyAvailable = Boolean(
    activeCangyuanConnection?.apiKeyUsable,
  );
  const activeGroupHasUnreadableKey = Boolean(
    activeCangyuanConnection?.apiKeySet &&
    !activeCangyuanConnection.apiKeyUsable,
  );
  const activeRuntimeModel = cangyuanModels.find(
    (model) => model.id === selectedMarketplaceModel,
  );

  function applyCangyuanGroup(
    group: CangyuanImageGroup,
    models: readonly ModelDescriptor[],
    preferredDefault?: string,
  ) {
    const connector = cangyuanImageConnectorForGroup(group);
    connector.models = structuredClone(models);
    const defaultModel =
      preferredDefault && models.some((model) => model.id === preferredDefault)
        ? preferredDefault
        : models.some(
              (model) => model.id === cangyuanDefaultModelForGroup(group),
            )
          ? cangyuanDefaultModelForGroup(group)
          : (models.find((model) => model.isDefault)?.id ??
            models[0]?.id ??
            "");
    setModelGroup(group);
    setCangyuanModels([...models]);
    setDefaultModel(defaultModel);
    setConnectorJson(JSON.stringify(connector, null, 2));
    return { connector, defaultModel };
  }

  async function refreshCangyuanGroup(
    group: CangyuanImageGroup,
    preferredDefault?: string,
    connectionToSync?: ProviderConnectionView,
  ) {
    const requestId = ++catalogRequestRef.current;
    try {
      const catalog = await fetchCangyuanCatalog(group);
      if (requestId !== catalogRequestRef.current || catalog.group !== group)
        return;
      const next = applyCangyuanGroup(group, catalog.models, preferredDefault);
      if (connectionToSync) {
        const config = {
          ...connectionToSync.config,
          modelGroup: group,
          defaultModel: next.defaultModel,
          connector: next.connector,
          catalogCheckedAt: catalog.checkedAt,
          catalogSource: catalog.source,
        };
        if (
          JSON.stringify(config) !== JSON.stringify(connectionToSync.config)
        ) {
          const saved = await saveConnection({
            id: connectionToSync.id,
            name: connectionToSync.name,
            provider: connectionToSync.provider,
            config,
          });
          setConnections((current) =>
            current.map((connection) =>
              connection.id === saved.id ? saved : connection,
            ),
          );
          setPreservedConfig(saved.config);
        }
      }
    } catch (error) {
      if (requestId === catalogRequestRef.current) {
        setMessage(
          error instanceof Error ? error.message : "沧元模型广场读取失败",
        );
      }
    }
  }

  const reload = async () => setConnections(await fetchConnections());
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all([fetchConnections(), fetchCangyuanMarketplace()]).then(
      ([items, marketplace]) => {
        if (cancelled) return;
        setConnections(items);
        setCangyuanGroups(marketplace.groups);
        setCatalogSource(marketplace.source);
        setSelectedMarketplaceGroup((current) =>
          initialCangyuanGroup &&
          marketplace.groups.some((group) => group.id === initialCangyuanGroup)
            ? initialCangyuanGroup
            : marketplace.groups.some((group) => group.id === current)
              ? current
              : (marketplace.groups.find(
                  (group) => group.id === CANGYUAN_ALL_MODELS_GROUP,
                )?.id ??
                marketplace.groups[0]?.id ??
                CANGYUAN_IMAGE_GROUP),
        );
        setSelectedMarketplaceModel((current) => {
          if (initialCangyuanGroup) {
            const initialGroup = marketplace.groups.find(
              (group) => group.id === initialCangyuanGroup,
            );
            if (initialGroup) return initialGroup.models[0]?.id ?? "";
          }
          if (
            marketplace.groups.some((group) =>
              group.models.some((model) => model.id === current),
            )
          )
            return current;
          return (
            marketplace.groups
              .find((group) => group.id === CANGYUAN_ALL_MODELS_GROUP)
              ?.models.find(
                (model) =>
                  model.id ===
                  cangyuanDefaultModelForGroup(CANGYUAN_ALL_MODELS_GROUP),
              )?.id ??
            marketplace.groups[0]?.models[0]?.id ??
            ""
          );
        });
        setSelectedSupplierKey((current) =>
          items.some(
            (connection) =>
              providerConnectionSupplierKey(connection) === current,
          )
            ? current
            : items[0]
              ? providerConnectionSupplierKey(items[0])
              : "cangyuan",
        );
      },
      (error: unknown) => {
        if (!cancelled)
          setMessage(error instanceof Error ? error.message : "读取失败");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [initialCangyuanGroup, open]);

  function selectConnection(selected: ProviderConnectionView) {
    const cangyuanPreset = isCangyuanImagePreset(selected.config.preset);
    const configuredGroup =
      typeof selected.config.modelGroup === "string" &&
      selected.config.modelGroup.trim()
        ? selected.config.modelGroup.trim()
        : selected.name.includes("备用")
          ? CANGYUAN_BACKUP_IMAGE_GROUP
          : CANGYUAN_IMAGE_GROUP;
    const runtimeGroup = isCangyuanImageGroup(configuredGroup)
      ? configuredGroup
      : CANGYUAN_IMAGE_GROUP;
    setSelectedId(selected.id);
    setCreatingNew(false);
    setSelectedSupplierKey(providerConnectionSupplierKey(selected));
    setName(selected.name);
    setProvider(selected.provider);
    setPresetId(cangyuanPreset ? CANGYUAN_IMAGE_PRESET_ID : null);
    setModelGroup(runtimeGroup);
    setSelectedMarketplaceGroup(configuredGroup);
    setApiKey("");
    setPreservedConfig(selected.config);
    setBaseUrl(
      typeof selected.config.baseUrl === "string"
        ? selected.config.baseUrl
        : "",
    );
    const configuredDefault =
      typeof selected.config.defaultModel === "string"
        ? selected.config.defaultModel
        : undefined;
    setDefaultModel(configuredDefault ?? "");
    if (cangyuanPreset && isCangyuanImageGroup(configuredGroup)) {
      const configuredConnector = selected.config.connector;
      const configuredModels =
        configuredConnector &&
        typeof configuredConnector === "object" &&
        !Array.isArray(configuredConnector) &&
        Array.isArray((configuredConnector as Record<string, unknown>).models)
          ? ((configuredConnector as Record<string, unknown>)
              .models as ModelDescriptor[])
          : [...(cangyuanImageConnectorForGroup(configuredGroup).models ?? [])];
      applyCangyuanGroup(configuredGroup, configuredModels, configuredDefault);
      setSelectedMarketplaceModel(
        configuredDefault ?? configuredModels[0]?.id ?? "",
      );
      void refreshCangyuanGroup(configuredGroup, configuredDefault, selected);
    } else if (cangyuanPreset) {
      setCangyuanModels([]);
      setSelectedMarketplaceModel(configuredDefault ?? "");
    } else if (selected.config.connector) {
      setConnectorJson(JSON.stringify(selected.config.connector, null, 2));
    }
  }

  function selectCangyuanMarketplaceGroup(groupId: string) {
    const marketplaceGroup = cangyuanGroups.find(
      (group) => group.id === groupId,
    );
    if (!marketplaceGroup) return;
    const usage = cangyuanGroupUsage(marketplaceGroup);
    setSelectedSupplierKey("cangyuan");
    setSelectedMarketplaceGroup(groupId);
    setSelectedMarketplaceModel(
      isCangyuanImageGroup(groupId)
        ? (marketplaceGroup.models.find(
            (model) => model.id === cangyuanDefaultModelForGroup(groupId),
          )?.id ??
            marketplaceGroup.models[0]?.id ??
            "")
        : (marketplaceGroup.models[0]?.id ?? ""),
    );
    const connection = connections.find(
      (item) =>
        providerConnectionSupplierKey(item) === "cangyuan" &&
        providerConnectionGroup(item) === groupId &&
        providerConnectionUsage(item) === usage,
    );
    if (connection) {
      selectConnection(connection);
      return;
    }
    setSelectedId(null);
    setCreatingNew(marketplaceGroup.canvasSupported || usage === "agent");
    setApiKey("");
    setMessage(null);
    if (usage === "agent") {
      setPresetId(CANGYUAN_IMAGE_PRESET_ID);
      setProvider("rest");
      setName(`沧元算力 · ${groupId} · 导演台`);
      setBaseUrl(CANGYUAN_IMAGE_BASE_URL);
      setPreservedConfig({ usage: "agent" });
      setDefaultModel(
        marketplaceGroup.models.find((model) => model.capability === "chat")
          ?.id ?? "",
      );
      setCangyuanModels([]);
      return;
    }
    if (!marketplaceGroup.canvasSupported || !isCangyuanImageGroup(groupId))
      return;
    setPresetId(CANGYUAN_IMAGE_PRESET_ID);
    setProvider("rest");
    setName(`沧元算力 · ${groupId}`);
    setBaseUrl(CANGYUAN_IMAGE_BASE_URL);
    setPreservedConfig({});
    applyCangyuanGroup(
      groupId,
      cangyuanImageConnectorForGroup(groupId).models ?? [],
    );
    void refreshCangyuanGroup(groupId);
  }

  function applyCangyuanPreset() {
    const nextGroup = CANGYUAN_ALL_MODELS_GROUP;
    setPresetId(CANGYUAN_IMAGE_PRESET_ID);
    setSelectedSupplierKey("cangyuan");
    setProvider("rest");
    setName("沧元算力图像 API");
    setSelectedMarketplaceGroup(nextGroup);
    setBaseUrl(CANGYUAN_IMAGE_BASE_URL);
    applyCangyuanGroup(
      nextGroup,
      cangyuanImageConnectorForGroup(nextGroup).models ?? [],
    );
    void refreshCangyuanGroup(nextGroup);
    setMessage(null);
  }

  function startNewConnection(supplierKey = activeSupplierKey) {
    setSelectedId(null);
    setCreatingNew(true);
    setSelectedSupplierKey(supplierKey);
    setApiKey("");
    setBaseUrl("");
    setDefaultModel("");
    setPreservedConfig({});
    setConnectorJson(JSON.stringify(defaultRestConfig.connector, null, 2));
    setMessage(null);

    if (supplierKey === "cangyuan") {
      applyCangyuanPreset();
      return;
    }

    const nextProvider = supplierKey || "openai";
    setPresetId(null);
    setProvider(nextProvider);
    setModelGroup(CANGYUAN_IMAGE_GROUP);
    setCangyuanModels([]);
    setName(
      nextProvider === "runway"
        ? "Runway 视频"
        : nextProvider === "rest"
          ? "自定义 REST"
          : nextProvider === "fake"
            ? "Fake 演示连接"
            : "OpenAI 图片",
    );
  }
  if (!open) return null;

  async function handleSave() {
    setBusy(true);
    setMessage(null);
    try {
      const connector =
        provider === "rest"
          ? (JSON.parse(connectorJson) as Record<string, unknown>)
          : undefined;
      const remainingConfig = Object.fromEntries(
        Object.entries(preservedConfig).filter(
          ([key]) =>
            ![
              "baseUrl",
              "defaultModel",
              "connector",
              "preset",
              "modelGroup",
            ].includes(key),
        ),
      );
      const saved = await saveConnection({
        id: selectedId ?? undefined,
        name,
        provider,
        apiKey: apiKey || undefined,
        config: {
          ...remainingConfig,
          ...(baseUrl ? { baseUrl } : {}),
          ...(defaultModel.trim() ? { defaultModel: defaultModel.trim() } : {}),
          ...(presetId ? { preset: presetId } : {}),
          ...(presetId === CANGYUAN_IMAGE_PRESET_ID ? { modelGroup } : {}),
          ...(connector ? { connector } : {}),
        },
      });
      setSelectedId(saved.id);
      setCreatingNew(false);
      setSelectedSupplierKey(providerConnectionSupplierKey(saved));
      if (presetId === CANGYUAN_IMAGE_PRESET_ID)
        setSelectedMarketplaceGroup(modelGroup);
      setPreservedConfig(saved.config);
      setApiKey("");
      setEditingCangyuanKey(false);
      await reload();
      setMessage("连接已加密保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleConnectCangyuanGroup(group: CangyuanImageGroup) {
    setBusy(true);
    setMessage(null);
    try {
      const catalog = await fetchCangyuanCatalog(group);
      const connector = cangyuanImageConnectorForGroup(group);
      connector.models = structuredClone(catalog.models);
      const preferredDefault = cangyuanDefaultModelForGroup(group);
      const nextDefault = catalog.models.some(
        (model) => model.id === preferredDefault,
      )
        ? preferredDefault
        : (catalog.models[0]?.id ?? "");
      const existing = connections.find(
        (connection) =>
          providerConnectionSupplierKey(connection) === "cangyuan" &&
          providerConnectionGroup(connection) === group &&
          providerConnectionUsage(connection) === "canvas",
      );
      const saved = await saveConnection({
        id: existing?.id,
        name: existing?.name ?? `沧元算力 · ${group}`,
        provider: "rest",
        apiKey: apiKey || undefined,
        config: {
          ...(existing?.config ?? {}),
          preset: CANGYUAN_IMAGE_PRESET_ID,
          usage: "canvas",
          modelGroup: group,
          baseUrl: CANGYUAN_IMAGE_BASE_URL,
          defaultModel: nextDefault,
          connector,
          catalogCheckedAt: catalog.checkedAt,
          catalogSource: catalog.source,
        },
      });
      setApiKey("");
      setEditingCangyuanKey(false);
      await reload();
      selectConnection(saved);
      setMessage(
        apiKey
          ? `${group} 分组的 API Key 已独立加密保存`
          : existing
            ? `${group} 分组已更新`
            : `${group} 分组已接入`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "分组接入失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleConnectCangyuanAgentGroup(groupId: string) {
    const marketplaceGroup = cangyuanGroups.find(
      (group) => group.id === groupId,
    );
    const chatModels =
      marketplaceGroup?.models.filter((model) => model.capability === "chat") ??
      [];
    if (!marketplaceGroup || chatModels.length === 0) {
      setMessage("当前分组没有可接入导演台的对话模型");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const existing = connections.find(
        (connection) =>
          providerConnectionSupplierKey(connection) === "cangyuan" &&
          providerConnectionGroup(connection) === groupId &&
          providerConnectionUsage(connection) === "agent",
      );
      const configuredDefault =
        typeof existing?.config.defaultModel === "string"
          ? existing.config.defaultModel
          : "";
      const defaultModel = chatModels.some(
        (model) => model.id === configuredDefault,
      )
        ? configuredDefault
        : chatModels[0]!.id;
      const saved = await saveConnection({
        id: existing?.id,
        name: existing?.name ?? `沧元算力 · ${groupId} · 导演台`,
        provider: "rest",
        apiKey: apiKey || undefined,
        config: {
          ...(existing?.config ?? {}),
          preset: CANGYUAN_IMAGE_PRESET_ID,
          usage: "agent",
          modelGroup: groupId,
          baseUrl: CANGYUAN_IMAGE_BASE_URL,
          defaultModel,
          catalogSource,
        },
      });
      setApiKey("");
      setEditingCangyuanKey(false);
      await reload();
      setSelectedId(saved.id);
      setSelectedMarketplaceGroup(groupId);
      setSelectedMarketplaceModel(defaultModel);
      setPreservedConfig(saved.config);
      setMessage(
        apiKey
          ? `${groupId} 导演台 API Key 已独立加密保存`
          : existing
            ? `${groupId} 导演台连接已更新`
            : `${groupId} 已接入右侧导演台`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "导演台对话分组接入失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    if (!selectedId) {
      setMessage("请先保存连接");
      return;
    }
    await handleTestConnection(selectedId);
  }

  async function handleTestConnection(connectionId: string) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await testConnection(connectionId));
    } catch (error) {
      const nextMessage =
        error instanceof Error ? error.message : "连接测试失败";
      if (nextMessage.includes("无法解密")) setEditingCangyuanKey(true);
      setMessage(nextMessage);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!selectedId) return;
    setBusy(true);
    try {
      await deleteConnection(selectedId);
      await reload();
      setSelectedId(null);
      setCreatingNew(false);
      setMessage("连接已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="modal-window settings-modal-window"
        role="dialog"
        aria-modal="true"
        aria-label="供应商设置"
        tabIndex={-1}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">连接管理</span>
            <h2>供应商与密钥</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={17} />
          </button>
        </header>
        <div className="settings-layout">
          <aside className="supplier-list" aria-label="API 供应商列表">
            <div className="settings-nav-title">
              <span>API 供应商</span>
              <small>按供应商查看群组</small>
            </div>
            {supplierKeys.map((supplierKey) => {
              const supplierConnections = connections.filter(
                (connection) =>
                  providerConnectionSupplierKey(connection) === supplierKey,
              );
              return (
                <button
                  type="button"
                  className={`supplier-item ${activeSupplierKey === supplierKey ? "active" : ""}`}
                  onClick={() => {
                    if (supplierKey === "cangyuan") {
                      selectCangyuanMarketplaceGroup(
                        selectedMarketplaceGroup ||
                          cangyuanGroups[0]?.id ||
                          CANGYUAN_IMAGE_GROUP,
                      );
                      return;
                    }
                    setSelectedSupplierKey(supplierKey);
                    setSelectedId(null);
                    setCreatingNew(false);
                  }}
                  key={supplierKey}
                >
                  <span className="provider-dot" />
                  <span>
                    <strong>{providerSupplierLabel(supplierKey)}</strong>
                    <small>
                      {supplierKey === "cangyuan"
                        ? `${cangyuanGroups.length} 个平台分组`
                        : `${supplierConnections.length} 个已建立群组`}
                    </small>
                  </span>
                </button>
              );
            })}
          </aside>
          <aside className="connection-list" aria-label="供应商群组列表">
            <div className="settings-nav-title">
              <span>供应商分组</span>
              <small>
                {activeSupplierKey
                  ? providerSupplierLabel(activeSupplierKey)
                  : "暂无供应商"}
              </small>
            </div>
            {activeSupplierKey === "cangyuan" ? (
              cangyuanGroups.map((group) => {
                const usage = cangyuanGroupUsage(group);
                const connection = connections.find(
                  (item) =>
                    providerConnectionSupplierKey(item) === "cangyuan" &&
                    providerConnectionGroup(item) === group.id &&
                    providerConnectionUsage(item) === usage,
                );
                return (
                  <button
                    type="button"
                    className={`connection-item ${selectedMarketplaceGroup === group.id ? "active" : ""}`}
                    onClick={() => selectCangyuanMarketplaceGroup(group.id)}
                    key={group.id}
                  >
                    <span
                      className={`provider-dot ${connection?.apiKeyUsable ? "" : "muted"}`}
                    />
                    <span>
                      <strong>{group.id}</strong>
                      <small>
                        {group.models.length} 个模型 · x{group.ratio}
                        {usage === "agent"
                          ? " · 导演台可用"
                          : group.canvasSupported
                            ? " · 画布可用"
                            : " · 模型信息"}
                      </small>
                    </span>
                  </button>
                );
              })
            ) : (
              <>
                <button
                  type="button"
                  className={`connection-item ${creatingNew ? "active" : ""}`}
                  onClick={() => startNewConnection(activeSupplierKey)}
                >
                  <Plus size={14} />
                  <span>新建群组连接</span>
                </button>
                {activeSupplierConnections.map((connection) => (
                  <button
                    type="button"
                    className={`connection-item ${selectedId === connection.id ? "active" : ""}`}
                    onClick={() => selectConnection(connection)}
                    key={connection.id}
                  >
                    <span className="provider-dot" />
                    <span>
                      <strong>{providerConnectionGroup(connection)}</strong>
                      <small>
                        {connection.name} ·{" "}
                        {connection.apiKeyUsable
                          ? "密钥可用"
                          : connection.apiKeySet
                            ? "密钥需要重新填写"
                            : "未设置密钥"}
                      </small>
                    </span>
                  </button>
                ))}
              </>
            )}
          </aside>
          {activeSupplierKey === "cangyuan" && activeMarketplaceGroup ? (
            <div className="settings-form cangyuan-catalog-detail">
              <header className="cangyuan-group-detail-head">
                <div>
                  <span className="eyebrow">沧元算力供应商分组</span>
                  <h3>{activeMarketplaceGroup.id}</h3>
                  <p>
                    {activeMarketplaceGroup.description ||
                      "该分组说明以沧元模型广场当前配置为准。"}
                  </p>
                </div>
                <div className="cangyuan-group-stats">
                  <span>
                    {activeConnectionUsage === "agent"
                      ? "导演台对话"
                      : "画布生成"}
                  </span>
                  <span>x{activeMarketplaceGroup.ratio} 倍率</span>
                  <span>{activeMarketplaceGroup.models.length} 个模型</span>
                  <span>
                    {catalogSource === "live"
                      ? "实时目录"
                      : catalogSource === "stale"
                        ? "缓存目录"
                        : "备用目录"}
                  </span>
                </div>
              </header>

              <section className="cangyuan-key-panel">
                <div className="field">
                  <label htmlFor="cangyuan-shared-api-key">
                    <KeyRound size={12} /> 当前分组 API Key
                  </label>
                  {activeGroupKeyAvailable && !editingCangyuanKey ? (
                    <input
                      id="cangyuan-shared-api-key"
                      value={`${activeMarketplaceGroup.id} 分组密钥已加密保存`}
                      readOnly
                      aria-describedby="cangyuan-key-help"
                    />
                  ) : (
                    <input
                      id="cangyuan-shared-api-key"
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={`填写 ${activeMarketplaceGroup.id} 分组对应的 API Key`}
                      autoComplete="off"
                    />
                  )}
                  <small id="cangyuan-key-help">
                    {activeGroupHasUnreadableKey
                      ? "当前分组的旧密文无法解密，请重新填写该分组对应的 API Key。"
                      : activeConnectionUsage === "agent"
                        ? "此 Key 仅供右侧导演台对话使用，不与画布图片/视频连接复用；明文不会下发到浏览器。"
                        : "此 Key 仅供画布图片/视频节点使用，不与右侧导演台复用；明文不会下发到浏览器。"}
                  </small>
                </div>
                <div className="cangyuan-key-actions">
                  {activeGroupKeyAvailable ? (
                    <button
                      className="button"
                      type="button"
                      onClick={() => {
                        setEditingCangyuanKey((current) => !current);
                        setApiKey("");
                      }}
                      disabled={busy}
                    >
                      {editingCangyuanKey ? "取消更换" : "重新填写密钥"}
                    </button>
                  ) : null}
                  {activeConnectionUsage === "agent" ||
                  (activeMarketplaceGroup.canvasSupported &&
                    isCangyuanImageGroup(activeMarketplaceGroup.id)) ? (
                    <button
                      className="button primary"
                      type="button"
                      onClick={() =>
                        void (activeConnectionUsage === "agent"
                          ? handleConnectCangyuanAgentGroup(
                              activeMarketplaceGroup.id,
                            )
                          : handleConnectCangyuanGroup(
                              activeMarketplaceGroup.id as CangyuanImageGroup,
                            ))
                      }
                      disabled={
                        busy ||
                        (editingCangyuanKey
                          ? !apiKey
                          : !activeGroupKeyAvailable && !apiKey)
                      }
                    >
                      {busy ? (
                        <RefreshCw className="spin" size={13} />
                      ) : (
                        <Check size={13} />
                      )}{" "}
                      {activeCangyuanConnection
                        ? activeConnectionUsage === "agent"
                          ? "更新导演台连接"
                          : "更新画布分组"
                        : activeConnectionUsage === "agent"
                          ? "接入右侧导演台"
                          : "接入画布分组"}
                    </button>
                  ) : (
                    <span className="cangyuan-readonly-hint">
                      当前分组仅展示模型信息，暂不用于画布或导演台调用。
                    </span>
                  )}
                  {activeCangyuanConnection ? (
                    <button
                      className="button"
                      type="button"
                      onClick={() =>
                        void handleTestConnection(activeCangyuanConnection.id)
                      }
                      disabled={busy}
                    >
                      <RefreshCw size={13} /> 测试连接
                    </button>
                  ) : null}
                </div>
              </section>

              <section className="cangyuan-model-browser">
                <div className="cangyuan-model-list" aria-label="分组模型列表">
                  {activeMarketplaceGroup.models.length > 0 ? (
                    activeMarketplaceGroup.models.map((model) => (
                      <button
                        type="button"
                        className={`cangyuan-model-item ${activeMarketplaceModel?.id === model.id ? "active" : ""}`}
                        onClick={() => setSelectedMarketplaceModel(model.id)}
                        key={model.id}
                      >
                        <span>
                          {model.capability === "video"
                            ? "视频"
                            : model.capability === "image"
                              ? "图片"
                              : model.capability === "chat"
                                ? "对话"
                                : "模型"}
                        </span>
                        <strong>{model.name}</strong>
                        <small>{model.priceLabel}</small>
                      </button>
                    ))
                  ) : (
                    <p className="cangyuan-empty-models">
                      模型广场当前没有向此分组发布模型。
                    </p>
                  )}
                </div>
                <article className="cangyuan-model-info">
                  {activeMarketplaceModel ? (
                    <>
                      <div className="cangyuan-model-info-head">
                        <span>
                          {activeMarketplaceModel.capability === "video"
                            ? "视频模型"
                            : activeMarketplaceModel.capability === "image"
                              ? "图片模型"
                              : activeMarketplaceModel.capability === "chat"
                                ? "对话模型"
                                : "模型"}
                        </span>
                        <h3>{activeMarketplaceModel.name}</h3>
                        <code>{activeMarketplaceModel.id}</code>
                      </div>
                      <p className="cangyuan-model-description">
                        {activeMarketplaceModel.description ||
                          "模型广场暂未提供更多文字说明。"}
                      </p>
                      <dl className="cangyuan-model-facts">
                        <div>
                          <dt>价格</dt>
                          <dd>{activeMarketplaceModel.priceLabel}</dd>
                        </div>
                        <div>
                          <dt>计费</dt>
                          <dd>{activeMarketplaceModel.billingLabel}</dd>
                        </div>
                        <div>
                          <dt>分组</dt>
                          <dd>{activeMarketplaceGroup.id}</dd>
                        </div>
                        <div>
                          <dt>接口</dt>
                          <dd>
                            {activeMarketplaceModel.endpointTypes.join("、") ||
                              (activeMarketplaceModel.capability === "video"
                                ? "OpenAI Video"
                                : activeMarketplaceModel.capability === "image"
                                  ? "OpenAI Images"
                                  : "以模型文档为准")}
                          </dd>
                        </div>
                      </dl>
                      {activeRuntimeModel?.parameters?.length ? (
                        <div className="cangyuan-parameter-list">
                          <strong>画布参数</strong>
                          <div>
                            {activeRuntimeModel.parameters.map((parameter) => (
                              <span key={parameter.key}>{parameter.label}</span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {activeMarketplaceModel.tags.length > 0 ? (
                        <div className="cangyuan-model-tags">
                          {activeMarketplaceModel.tags.map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="settings-empty-detail">
                      <strong>选择模型查看详细信息</strong>
                    </div>
                  )}
                </article>
              </section>
              <div className="modal-message" role="status" aria-live="polite">
                {message ? <Check size={14} /> : <PlugZap size={14} />}
                <span>
                  {message ??
                    "分组和模型随沧元模型广场更新；API Key 仅在服务端加密保存。"}
                </span>
              </div>
            </div>
          ) : selectedId || creatingNew ? (
            <div className="settings-form">
              <div className="field-row">
                <div className="field">
                  <label htmlFor="provider-connection-name">连接名称</label>
                  <input
                    id="provider-connection-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="provider-kind">供应商</label>
                  <select
                    id="provider-kind"
                    value={presetId ?? provider}
                    onChange={(event) => {
                      const nextProvider = event.target.value;
                      if (nextProvider === CANGYUAN_IMAGE_PRESET_ID) {
                        applyCangyuanPreset();
                        return;
                      }
                      setPresetId(null);
                      setProvider(nextProvider);
                      setSelectedSupplierKey(nextProvider);
                      setDefaultModel("");
                      if (nextProvider === "runway") setName("Runway 视频");
                      if (nextProvider === "rest") setName("自定义 REST");
                    }}
                  >
                    <option value={CANGYUAN_IMAGE_PRESET_ID}>沧元算力</option>
                    <option value="openai">OpenAI 兼容（图片）</option>
                    <option value="runway">Runway（视频）</option>
                    <option value="rest">通用 REST（图片 / 视频）</option>
                    <option value="fake">Fake 演示</option>
                  </select>
                </div>
              </div>
              {provider === "rest" && presetId === CANGYUAN_IMAGE_PRESET_ID ? (
                <div className="field">
                  <label htmlFor="provider-model-group">模型分组</label>
                  <select
                    id="provider-model-group"
                    value={modelGroup}
                    onChange={(event) => {
                      const nextGroup = event.target.value;
                      if (!isCangyuanImageGroup(nextGroup)) return;
                      applyCangyuanGroup(
                        nextGroup,
                        cangyuanImageConnectorForGroup(nextGroup).models ?? [],
                      );
                      void refreshCangyuanGroup(nextGroup);
                    }}
                  >
                    {CANGYUAN_IMAGE_GROUP_OPTIONS.map((group) => (
                      <option key={group.value} value={group.value}>
                        {group.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="field">
                <label htmlFor="provider-api-key">
                  <KeyRound size={12} /> API Key
                </label>
                <input
                  id="provider-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    selectedId
                      ? "留空则保留原密钥"
                      : "仅发送到本机服务端并加密保存"
                  }
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label htmlFor="provider-base-url">
                  <Server size={12} /> API Base URL
                </label>
                <input
                  id="provider-base-url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder={
                    provider === "openai"
                      ? "https://api.openai.com/v1"
                      : provider === "runway"
                        ? "https://api.dev.runwayml.com/v1"
                        : "https://api.example.com"
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="provider-default-model">默认模型</label>
                {provider === "rest" &&
                presetId === CANGYUAN_IMAGE_PRESET_ID ? (
                  <select
                    id="provider-default-model"
                    value={defaultModel}
                    onChange={(event) => setDefaultModel(event.target.value)}
                  >
                    {cangyuanModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="provider-default-model"
                    value={defaultModel}
                    onChange={(event) => setDefaultModel(event.target.value)}
                    placeholder={
                      provider === "openai"
                        ? "gpt-image-2 或中转站提供的模型 ID"
                        : provider === "runway"
                          ? "gen4.5"
                          : "连接器 models 中的默认模型"
                    }
                  />
                )}
              </div>
              {provider === "rest" && presetId === CANGYUAN_IMAGE_PRESET_ID ? (
                <div className="provider-preset-summary" role="status">
                  <Check size={14} />
                  <span>
                    {modelGroup} · 当前可用 {cangyuanModels.length} 个模型
                  </span>
                </div>
              ) : provider === "rest" ? (
                <div className="field">
                  <label htmlFor="provider-connector-json">
                    声明式 Connector JSON
                  </label>
                  <textarea
                    id="provider-connector-json"
                    className="connector-editor"
                    value={connectorJson}
                    onChange={(event) => setConnectorJson(event.target.value)}
                    spellCheck={false}
                  />
                </div>
              ) : null}
              <div className="modal-message" role="status" aria-live="polite">
                {message ? (
                  message.includes("成功") || message.includes("保存") ? (
                    <Check size={14} />
                  ) : (
                    <CircleAlert size={14} />
                  )
                ) : (
                  <PlugZap size={14} />
                )}
                <span>
                  {message ?? "密钥不会下发到浏览器，也不会写入普通日志。"}
                </span>
              </div>
              <footer className="modal-actions">
                {selectedId ? (
                  <button
                    className="button danger"
                    type="button"
                    onClick={handleDelete}
                    disabled={busy}
                  >
                    删除
                  </button>
                ) : null}
                <button
                  className="button"
                  type="button"
                  onClick={handleTest}
                  disabled={busy || !selectedId}
                >
                  <RefreshCw size={13} /> 测试连接
                </button>
                <button
                  className="button primary"
                  type="button"
                  onClick={handleSave}
                  disabled={busy || !name}
                >
                  {busy ? (
                    <RefreshCw className="spin" size={13} />
                  ) : (
                    <Check size={13} />
                  )}{" "}
                  保存连接
                </button>
              </footer>
            </div>
          ) : (
            <div className="settings-empty-detail">
              <span className="settings-empty-icon">
                <Server size={22} />
              </span>
              <strong>选择一个群组查看连接详情</strong>
              <p>
                先在左侧选择供应商，再从中间选择已建立群组；连接名称、密钥、地址和默认模型会显示在这里。
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export function RunHistoryModal({
  open,
  onClose,
  canvasId,
  onReuseAsset,
  onResumeRun,
}: ModalProps & {
  canvasId: string | null;
  onReuseAsset: (assetId: string) => void;
  onResumeRun: (runId: string) => Promise<void>;
}) {
  const [runs, setRuns] = useState<RunSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const dialogRef = useDialogFocus(open, onClose);
  const reload = async () => {
    if (!canvasId) return;
    setBusy(true);
    setLoadError(null);
    try {
      setRuns(await fetchRuns(canvasId));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "无法读取运行历史");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!open || !canvasId) return;
    let cancelled = false;
    void fetchRuns(canvasId)
      .then((items) => {
        if (cancelled) return;
        setRuns(items);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error ? error.message : "无法读取运行历史",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [open, canvasId]);
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="modal-window history-modal"
        role="dialog"
        aria-modal="true"
        aria-label="历史生成"
        tabIndex={-1}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">生成记录</span>
            <h2>历史生成</h2>
          </div>
          <div className="modal-head-actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => void reload()}
              aria-label="刷新"
            >
              <RefreshCw className={busy ? "spin" : ""} size={16} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={onClose}
              aria-label="关闭"
            >
              <X size={17} />
            </button>
          </div>
        </header>
        <div className="history-list">
          {loadError ? (
            <div className="modal-message history-load-error" role="alert">
              <CircleAlert size={15} />
              <span>{loadError}</span>
              <button
                className="button small"
                type="button"
                onClick={() => void reload()}
                disabled={busy}
              >
                <RefreshCw className={busy ? "spin" : ""} size={12} />
                重试
              </button>
            </div>
          ) : runs.length === 0 ? (
            <div className="empty-state">
              <Clock3 size={24} />
              <span>还没有运行记录</span>
            </div>
          ) : (
            runs.map(({ run, nodes }) => {
              const outputAssetIds = [
                ...new Set(nodes.flatMap((node) => node.outputAssetIds)),
              ];
              const nodeErrors = nodes.filter((node) =>
                Boolean(node.errorJson?.message),
              );
              return (
                <article className="history-row" key={run.id}>
                  <span className={`history-status ${run.status}`} />
                  <div className="history-main">
                    <strong>
                      {run.scope === "all"
                        ? "整张画布"
                        : run.scope === "downstream"
                          ? "运行下游"
                          : "运行当前节点"}
                    </strong>
                    <small>
                      {new Date(run.createdAt).toLocaleString("zh-CN")} ·{" "}
                      {
                        nodes.filter((node) => node.status === "succeeded")
                          .length
                      }
                      /{nodes.length} 节点完成
                    </small>
                    {nodeErrors.length > 0 ? (
                      <details className="history-errors">
                        <summary className="history-error">
                          {nodeErrors.length} 个节点错误
                        </summary>
                        <ul className="history-error-list">
                          {nodeErrors.map((node) => (
                            <li key={node.id}>
                              <strong>{node.nodeId}</strong>
                              <span>
                                {localizeRunError(node.errorJson)?.message}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {outputAssetIds.length > 0 ? (
                      <div className="history-output-actions">
                        {outputAssetIds.map((assetId, index) => (
                          <button
                            className="button ghost small"
                            type="button"
                            key={assetId}
                            onClick={() => onReuseAsset(assetId)}
                            title="固定为画布素材输入"
                          >
                            <Pin size={11} /> 固定输出 {index + 1}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {run.status === "failed" ||
                    run.status === "needs_attention" ? (
                      <div className="history-output-actions">
                        <button
                          className="button small"
                          type="button"
                          disabled={busy || resumingId !== null}
                          onClick={async () => {
                            setResumingId(run.id);
                            try {
                              await onResumeRun(run.id);
                              await reload();
                            } finally {
                              setResumingId(null);
                            }
                          }}
                        >
                          <RefreshCw
                            className={resumingId === run.id ? "spin" : ""}
                            size={11}
                          />
                          {resumingId === run.id ? "恢复中" : "恢复任务"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <span className={`status-label ${run.status}`}>
                    {run.status}
                  </span>
                </article>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

export function GenerationHistoryModal({
  open,
  onClose,
  assets,
  onPreview,
  onReuseAsset,
  onDropAsset,
}: ModalProps & {
  assets: AssetView[];
  onPreview: (asset: AssetView) => void;
  onReuseAsset: (assetId: string) => void;
  onDropAsset: (assetId: string, position: { x: number; y: number }) => void;
}) {
  const dialogRef = useDialogFocus(open, onClose);
  const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null);
  const dragStartRef = useRef<{
    assetId: string;
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const dragMovedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const generatedImages = assets.filter(
    (asset) =>
      asset.kind === "image" && typeof asset.metadata.runId === "string",
  );
  if (!open) return null;
  return (
    <div
      className={`modal-backdrop generation-history-backdrop ${draggingAssetId ? "asset-dragging" : ""}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="modal-window generation-history-modal"
        role="dialog"
        aria-modal="true"
        aria-label="历史生成"
        tabIndex={-1}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">生成图片</span>
            <h2>历史生成</h2>
            <small className="generation-history-hint">
              点击预览，或直接拖到画布
            </small>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={17} />
          </button>
        </header>
        {generatedImages.length === 0 ? (
          <div className="empty-state generation-history-empty">
            <span>还没有生成过图片</span>
          </div>
        ) : (
          <div className="generation-history-grid">
            {generatedImages.map((asset) => (
              <article className="generation-history-card" key={asset.id}>
                <button
                  className="generation-history-preview"
                  type="button"
                  onClick={(event) => {
                    if (suppressClickRef.current) {
                      event.preventDefault();
                      suppressClickRef.current = false;
                      return;
                    }
                    onPreview(asset);
                  }}
                  aria-label={`预览 ${asset.name}`}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    suppressClickRef.current = false;
                    dragMovedRef.current = false;
                    dragStartRef.current = {
                      assetId: asset.id,
                      pointerId: event.pointerId,
                      x: event.clientX,
                      y: event.clientY,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    const start = dragStartRef.current;
                    if (!start || start.pointerId !== event.pointerId) return;
                    const distance = Math.hypot(
                      event.clientX - start.x,
                      event.clientY - start.y,
                    );
                    if (distance < 7 && !dragMovedRef.current) return;
                    event.preventDefault();
                    dragMovedRef.current = true;
                    setDraggingAssetId(start.assetId);
                  }}
                  onPointerUp={(event) => {
                    const start = dragStartRef.current;
                    if (!start || start.pointerId !== event.pointerId) return;
                    if (event.currentTarget.hasPointerCapture(event.pointerId))
                      event.currentTarget.releasePointerCapture(
                        event.pointerId,
                      );
                    if (dragMovedRef.current) {
                      event.preventDefault();
                      suppressClickRef.current = true;
                      onDropAsset(start.assetId, {
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }
                    dragStartRef.current = null;
                    dragMovedRef.current = false;
                    setDraggingAssetId(null);
                  }}
                  onPointerCancel={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId))
                      event.currentTarget.releasePointerCapture(
                        event.pointerId,
                      );
                    dragStartRef.current = null;
                    dragMovedRef.current = false;
                    setDraggingAssetId(null);
                  }}
                >
                  <img
                    src={`/api/assets/${encodeURIComponent(asset.id)}/preview?size=640`}
                    alt={asset.name}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                  />
                </button>
                <footer>
                  <div>
                    <strong>{asset.name}</strong>
                    <small>
                      {new Date(asset.createdAt).toLocaleString("zh-CN")}
                    </small>
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => onReuseAsset(asset.id)}
                    aria-label={`放入画布 ${asset.name}`}
                    title="放入画布"
                  >
                    <Pin size={13} />
                  </button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function AssetPreviewModal({
  asset,
  onClose,
  onBack,
}: {
  asset: AssetView | null;
  onClose: () => void;
  onBack?: () => void;
}) {
  const dialogRef = useDialogFocus(Boolean(asset), onClose);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageDragging, setImageDragging] = useState(false);
  if (!asset) return null;
  const url = `/api/assets/${encodeURIComponent(asset.id)}/content`;
  const stopImageDrag = (pointerId: number, releaseCapture = true) => {
    const stage = stageRef.current;
    if (imageDragRef.current?.pointerId !== pointerId) return;
    imageDragRef.current = null;
    setImageDragging(false);
    if (releaseCapture && stage?.hasPointerCapture(pointerId))
      stage.releasePointerCapture(pointerId);
  };
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="modal-window asset-modal"
        role="dialog"
        aria-modal="true"
        aria-label="素材预览"
        tabIndex={-1}
      >
        <header className="modal-head">
          <div className="asset-modal-heading">
            {onBack ? (
              <button
                className="icon-button asset-back-button"
                type="button"
                onClick={onBack}
                aria-label="返回历史生成"
                title="返回历史生成"
              >
                <ArrowLeft size={17} />
              </button>
            ) : null}
            <div>
              <span className="eyebrow">素材预览</span>
              <h2>{asset.name}</h2>
            </div>
          </div>
          <div className="modal-head-actions">
            {asset.kind === "image" ? (
              <span className="asset-zoom-level">
                {Math.round(imageZoom * 100)}%
              </span>
            ) : null}
            <button
              className="icon-button"
              type="button"
              onClick={onClose}
              aria-label="关闭"
            >
              <X size={17} />
            </button>
          </div>
        </header>
        <div
          ref={stageRef}
          className={`asset-stage ${asset.kind === "image" ? "image-zoom-stage" : ""} ${asset.kind === "image" && imageZoom > 1 ? "can-pan" : ""} ${imageDragging ? "is-dragging" : ""}`}
          onPointerDown={(event) => {
            if (asset.kind !== "image" || imageZoom <= 1 || event.button !== 0)
              return;
            const stage = stageRef.current;
            if (!stage) return;
            event.preventDefault();
            event.stopPropagation();
            stage.setPointerCapture(event.pointerId);
            imageDragRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              scrollLeft: stage.scrollLeft,
              scrollTop: stage.scrollTop,
            };
            setImageDragging(true);
          }}
          onPointerMove={(event) => {
            const drag = imageDragRef.current;
            const stage = stageRef.current;
            if (!drag || !stage || drag.pointerId !== event.pointerId) return;
            event.preventDefault();
            stage.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
            stage.scrollTop = drag.scrollTop - (event.clientY - drag.startY);
          }}
          onPointerUp={(event) => stopImageDrag(event.pointerId)}
          onPointerCancel={(event) => stopImageDrag(event.pointerId)}
          onLostPointerCapture={(event) =>
            stopImageDrag(event.pointerId, false)
          }
          onWheel={(event) => {
            if (asset.kind !== "image") return;
            event.preventDefault();
            event.stopPropagation();
            const stage = stageRef.current;
            if (!stage) return;
            const previousZoom = imageZoom;
            const nextZoom = Math.min(
              5,
              Math.max(
                0.25,
                Number(
                  (previousZoom + (event.deltaY < 0 ? 0.15 : -0.15)).toFixed(2),
                ),
              ),
            );
            if (nextZoom === previousZoom) return;
            const bounds = stage.getBoundingClientRect();
            const cursorX = event.clientX - bounds.left;
            const cursorY = event.clientY - bounds.top;
            const contentX = stage.scrollLeft + cursorX;
            const contentY = stage.scrollTop + cursorY;
            setImageZoom(nextZoom);
            window.requestAnimationFrame(() => {
              const scale = nextZoom / previousZoom;
              stage.scrollLeft = contentX * scale - cursorX;
              stage.scrollTop = contentY * scale - cursorY;
            });
          }}
        >
          {asset.kind === "video" && asset.metadata.fake !== true ? (
            <video src={url} controls preload="metadata" />
          ) : asset.kind === "video" ? (
            <div className="fake-video-stage">
              <Film size={42} />
              <strong>Fake Provider 视频结果</strong>
              <span>接入 Runway 或 REST 视频 API 后将在这里播放真实视频。</span>
            </div>
          ) : asset.kind === "audio" ? (
            <audio src={url} controls preload="metadata" />
          ) : (
            <div
              className={`asset-image-canvas ${imageZoom > 1 ? "is-zoomed" : ""}`}
              style={{
                width: `${imageZoom * 100}%`,
                height: `${imageZoom * 100}%`,
              }}
            >
              <img src={url} alt={asset.name} draggable={false} />
            </div>
          )}
        </div>
        <footer className="asset-footer">
          <span>
            {asset.mimeType} · {Math.max(1, Math.round(asset.size / 1024))} KB
          </span>
          <a className="button primary" href={url} download={asset.name}>
            下载原文件
          </a>
        </footer>
      </section>
    </div>
  );
}
