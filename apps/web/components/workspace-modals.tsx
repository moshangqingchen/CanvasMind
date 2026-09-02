"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Clock3,
  ExternalLink,
  Film,
  KeyRound,
  Pin,
  PlugZap,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  X,
} from "lucide-react";
import {
  deleteConnection,
  fetchCangyuanCatalog,
  fetchCangyuanAvailability,
  fetchCangyuanMarketplace,
  fetchChentuCatalog,
  fetchChentuMarketplace,
  fetchCyberAfeiCatalog,
  fetchCyberAfeiMarketplace,
  fetchConnections,
  fetchMiaowuCatalog,
  fetchMiaowuMarketplace,
  fetchModels,
  refreshModels,
  fetchRuns,
  saveConnection,
  testConnection,
  type DeleteAssetsResult,
  type ProviderConnectionView,
  type CangyuanMarketplaceGroupView,
  type CangyuanAvailabilityView,
} from "../lib/client-api";
import {
  intersectingSelectionIds,
  selectionRectBetween,
  type SelectionRect,
} from "../lib/generation-history";
import {
  assetDownloadPath,
  downloadAssetPreferLocal,
} from "../lib/asset-download";
import type { ModelDescriptor } from "@super-canvas/providers";
import type {
  DirectorModelCapabilities,
  DirectorProtocol,
} from "@super-canvas/director";
import {
  CANGYUAN_ALL_MODELS_GROUP,
  CANGYUAN_BACKUP_IMAGE_GROUP,
  CANGYUAN_IMAGE_GROUP,
  CANGYUAN_IMAGE_GROUP_OPTIONS,
  CANGYUAN_IMAGE_BASE_URL,
  CANGYUAN_IMAGE_PRESET_ID,
  WEAI_IMAGE_BASE_URL,
  WEAI_IMAGE_DEFAULT_MODEL,
  cangyuanDefaultModelForGroup,
  cangyuanImageConnectorForGroup,
  isCangyuanImagePreset,
  isCangyuanImageGroup,
  normalizeCangyuanImageGroup,
  type CangyuanImageGroup,
} from "../lib/provider-presets";
import {
  CYBERAFEI_API_BASE_URL,
  CYBERAFEI_BASE_URL,
  CYBERAFEI_PRESET_ID,
  CYBERAFEI_SUPPLIER_KEY,
  cyberAfeiConnectorForModels,
  cyberAfeiDefaultModelForGroup,
} from "../lib/cyberafei-catalog";
import {
  providerConnectionGroup,
  providerConnectionSupplierKey,
  providerConnectionSupplierWebsite,
  providerConnectionUsage,
  providerSupplierLabel,
  providerSupplierWebsite,
  type ProviderConnectionUsage,
} from "../lib/provider-connection-options";
import {
  WEAI_BASE_URL,
  WEAI_CATALOG,
  WEAI_CATALOG_CAPTURED_AT,
  WEAI_CODEX_TOKEN_GROUP,
  WEAI_CURRENCY_NOTE,
  WEAI_GEMINI_GROUP,
  WEAI_MARKETPLACE_SOURCE_NOTE,
  WEAI_ROUTE_SOURCE_NOTE,
  isWeAiGroupId,
  readWeAiSavedModelScan,
  resolveWeAiDefaultModel,
  resolveWeAiProtocol,
  weAiCanvasModelDescriptorsFromSavedScan,
  weAiCatalogGroup,
  type WeAiCatalogModel,
  type WeAiGroupId,
  type WeAiProtocol,
  type WeAiRouteStatus,
} from "../lib/weai-catalog";
import {
  MIKOTO_BASE_URL,
  MIKOTO_DEFAULT_MODEL,
  MIKOTO_GROUPS,
  MIKOTO_GROUP_IDS,
  MIKOTO_IMAGE_1K_GROUP,
  MIKOTO_PRESET_ID,
  MIKOTO_CONNECTOR,
  MIKOTO_MODELS,
  isMikotoGroupId,
  MIKOTO_SUPPLIER_KEY,
  isMikotoPreset,
  mikotoConnectorForGroup,
  mikotoGroup,
  mikotoConnectionConfig,
  type MikotoGroupId,
} from "../lib/mikoto-presets";
import {
  MIAOWU_BASE_URL,
  MIAOWU_CONNECTOR,
  MIAOWU_DEFAULT_MODEL,
  MIAOWU_MODEL_GROUP,
  MIAOWU_MODELS,
  MIAOWU_PRESET_ID,
  MIAOWU_SUPPLIER_KEY,
  isMiaowuPreset,
  miaowuConnectionConfig,
} from "../lib/miaowu-presets";
import {
  FRIMODEL_BASE_URL,
  FRIMODEL_DEFAULT_MODEL,
  FRIMODEL_DOCS_URL,
  FRIMODEL_MODEL_GROUP,
  FRIMODEL_PLATFORM_GROUPS,
  FRIMODEL_PRESET_ID,
  FRIMODEL_SUPPLIER_KEY,
  friModelDefaultModelForGroup,
  friModelConnectionConfig,
  friModelMarketplaceGroup,
  isFriModelImageGroup,
  isFriModelPreset,
} from "../lib/frimodel-presets";
import {
  CHENTU_BASE_URL,
  CHENTU_DEFAULT_MODEL,
  CHENTU_DOCS_URL,
  CHENTU_MODEL_GROUP,
  CHENTU_MODEL_STATUS_URL,
  CHENTU_PLATFORM_GROUPS,
  CHENTU_PRESET_ID,
  CHENTU_SUPPLIER_KEY,
  chentuConnectionConfig,
  chentuDefaultModelForGroup,
  chentuMarketplaceGroup,
  isChentuImageGroup,
  isChentuPreset,
} from "../lib/chentu-presets";
import { localizeRunError } from "../lib/error-localization";
import {
  fetchDirectorProfile,
  saveDirectorProfile,
} from "../lib/director-client";
import {
  directorBrainConnections,
  directorConfiguredModelInventory,
  directorModelSupportsText,
  ensureDirectorModel,
  findProviderGroupConnection,
  mergeDirectorModelInventory,
  preferredDirectorModelId,
  type DirectorMarketplaceGroups,
} from "../lib/director-provider-options";
import {
  directorReasoningOptions,
  type DirectorReasoningEffort,
} from "../lib/director-reasoning";
import type { AssetView, RunSnapshot } from "./types";

interface ModalProps {
  open: boolean;
  onClose: () => void;
}

interface SettingsModalProps extends ModalProps {
  initialCangyuanGroup?: string | null;
}

interface WeAiModelScanState {
  status: "loading" | "ready" | "error";
  items: ModelDescriptor[];
  message?: string;
}

function savedWeAiModelScanState(
  connection: ProviderConnectionView,
): WeAiModelScanState | null {
  const scan = readWeAiSavedModelScan(connection.config);
  const items = weAiCanvasModelDescriptorsFromSavedScan(connection.config);
  return scan && items ? { status: "ready", items } : null;
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

function cyberAfeiScanLabel(
  group:
    | Pick<
        CangyuanMarketplaceGroupView,
        "models" | "scanStatus" | "scannedModelCount"
      >
    | undefined,
): string {
  if (!group || group.scanStatus === "unconfigured") return "尚未用 Key 扫描";
  if (group.scanStatus === "live")
    return `Key 实时扫描 ${group.scannedModelCount ?? group.models.length} 个`;
  if (group.scanStatus === "empty") return "Key 扫描成功 · 0 个模型";
  if (group.scanStatus === "unauthorized") return "Key 无权限 · 已隐藏旧模型";
  return "扫描失败 · 已隐藏旧模型";
}

function connectionScanLabel(connection: ProviderConnectionView): string {
  const status = connection.config.modelScanStatus;
  const scanned = Array.isArray(connection.config.scannedModelIds)
    ? connection.config.scannedModelIds.length
    : 0;
  if (status === "live") return `实时扫描 ${scanned} 个模型`;
  if (status === "empty") return "实时扫描成功 · 0 个模型";
  if (status === "failed") return "扫描失败 · 已隐藏旧模型";
  if (status === "unauthorized") return "Key 无权限 · 已隐藏旧模型";
  return "等待 Key 扫描";
}

function modelPriceLabel(model: ModelDescriptor): string | undefined {
  const value = model.metadata?.priceLabel;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cangyuanAvailabilityLabel(
  status: CangyuanAvailabilityView["latestStatus"],
): string {
  if (status === "operational") return "正常";
  if (status === "degraded") return "降级";
  if (status === "unavailable") return "不可用";
  return "未知";
}

function cangyuanAvailabilityClass(
  status: CangyuanAvailabilityView["latestStatus"],
): string {
  return `cangyuan-availability-${status}`;
}

function cangyuanAvailabilitySummary(
  availability: CangyuanAvailabilityView | undefined,
): string | null {
  if (!availability) return null;
  const parts = [cangyuanAvailabilityLabel(availability.latestStatus)];
  if (availability.availability !== null)
    parts.push(`可用率 ${availability.availability}%`);
  if (availability.averageLatencyMs !== null)
    parts.push(`${Math.round(availability.averageLatencyMs)}ms`);
  return parts.join(" · ");
}

function customModelDisplayLabel(model: ModelDescriptor): string {
  const price = modelPriceLabel(model);
  return `${model.name}${price && !model.name.includes(price) ? ` · ${price}` : ""}`;
}

function customModelGroupSummary(models: readonly ModelDescriptor[]): string {
  const groups = new Map<string, number>();
  for (const model of models) {
    const value = model.metadata?.catalogGroup;
    const group =
      typeof value === "string" && value.trim() ? value.trim() : "默认群组";
    groups.set(group, (groups.get(group) ?? 0) + 1);
  }
  return [...groups.entries()]
    .map(([group, count]) => `${group}（${count}）`)
    .join("、");
}

function formatWeAiMoney(value: number): string {
  let formatted = value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "");
  if (value > 0 && value < 1) {
    const fractionLength = formatted.split(".")[1]?.length ?? 0;
    if (fractionLength === 0) formatted += ".00";
    if (fractionLength === 1) formatted += "0";
  }
  return `$${formatted}`;
}

function formatWeAiPrice(model: WeAiCatalogModel): string {
  const pricing = model.pricing;
  if (pricing.kind === "token") {
    return `输入 ${formatWeAiMoney(pricing.input)}/1M · 输出 ${formatWeAiMoney(pricing.output)}/1M · 图片 ${formatWeAiMoney(pricing.imageOutput)}/1M`;
  }
  if (pricing.kind === "per-request" && pricing.dimension === "fixed") {
    const price = pricing.tiers[0]?.price;
    const sizes = pricing.supportedSizes?.join(" / ");
    return [
      price === undefined ? "按次计费" : `${formatWeAiMoney(price)}/次`,
      sizes ? `${sizes} 同价` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const unit = pricing.kind === "per-request" ? "次" : "张";
  const tiers = pricing.tiers
    .map((tier) => `${tier.label} ${formatWeAiMoney(tier.price)}/${unit}`)
    .join(" · ");
  return pricing.kind === "per-request" && pricing.supportedSizes?.length
    ? `${tiers} · 支持 ${pricing.supportedSizes.join(" / ")}`
    : tiers;
}

function formatWeAiPriceDetails(model: WeAiCatalogModel): string {
  const pricing = model.pricing;
  if (pricing.kind === "token") {
    return [
      `输入 ${formatWeAiMoney(pricing.input)}/1M token`,
      `输出 ${formatWeAiMoney(pricing.output)}/1M token`,
      `缓存读 ${formatWeAiMoney(pricing.cacheRead)}/1M token`,
      `图片输出 ${formatWeAiMoney(pricing.imageOutput)}/1M token`,
    ].join(" · ");
  }
  if (pricing.kind === "per-request" && pricing.dimension === "fixed") {
    const price = pricing.tiers[0]?.price;
    return [
      price === undefined ? "按次计费" : `单次 ${formatWeAiMoney(price)}/次`,
      pricing.supportedSizes?.length
        ? `支持 ${pricing.supportedSizes.join("、")}，价格相同`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const unit = pricing.kind === "per-request" ? "次" : "张";
  const tiers = pricing.tiers
    .map((tier) => `${tier.label} ${formatWeAiMoney(tier.price)}/${unit}`)
    .join(" · ");
  return pricing.kind === "per-request" && pricing.supportedSizes?.length
    ? `${tiers} · 支持 ${pricing.supportedSizes.join("、")}`
    : tiers;
}

function weAiRouteStatusLabel(status: WeAiRouteStatus): string {
  switch (status) {
    case "callable":
      return "可调用";
    case "alias":
      return "别名可调用";
    case "marketplace-only":
      return "仅广场";
    case "route-disabled":
      return "路由禁用";
  }
}

function normalizeLoadedWeAiConnections(
  connections: readonly ProviderConnectionView[],
): ProviderConnectionView[] {
  // Loading settings must not mutate a saved connection. Legacy We-AI values
  // are normalized when the user explicitly saves or refreshes that connection.
  return [...connections];
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

const DIRECTOR_PROTOCOL_OPTIONS: ReadonlyArray<{
  value: DirectorProtocol;
  label: string;
}> = [
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "openai-chat-completions", label: "OpenAI Chat Completions" },
  { value: "anthropic-messages", label: "Anthropic Messages / Claude" },
  { value: "xai-responses", label: "xAI Responses / Grok" },
  { value: "google-generate-content", label: "Google Gemini generateContent" },
  { value: "generic-openai-compatible", label: "通用 OpenAI-compatible" },
];

const DIRECTOR_CONNECTION_PRESETS: Record<
  DirectorProtocol,
  { name: string; baseUrl: string; supplierKey: string }
> = {
  "openai-responses": {
    name: "OpenAI 导演大脑",
    baseUrl: "https://api.openai.com/v1",
    supplierKey: "openai",
  },
  "openai-chat-completions": {
    name: "OpenAI Chat 导演大脑",
    baseUrl: "https://api.openai.com/v1",
    supplierKey: "openai",
  },
  "anthropic-messages": {
    name: "Claude 导演大脑",
    baseUrl: "https://api.anthropic.com/v1",
    supplierKey: "anthropic",
  },
  "xai-responses": {
    name: "Grok 导演大脑",
    baseUrl: "https://api.x.ai/v1",
    supplierKey: "xai",
  },
  "google-generate-content": {
    name: "Gemini 导演大脑",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    supplierKey: "google",
  },
  "generic-openai-compatible": {
    name: "自定义导演大脑",
    baseUrl: "",
    supplierKey: "rest",
  },
};

function inferredDirectorProtocol(
  connection: ProviderConnectionView | undefined,
): DirectorProtocol {
  const configured = connection?.config.directorProtocol;
  if (
    typeof configured === "string" &&
    DIRECTOR_PROTOCOL_OPTIONS.some((option) => option.value === configured)
  ) {
    return configured as DirectorProtocol;
  }
  const protocol = connection?.config.protocol;
  if (protocol === "responses" || protocol === "openai-responses")
    return "openai-responses";
  if (protocol === "chat-completions" || protocol === "openai-chat-completions")
    return "openai-chat-completions";
  if (protocol === "anthropic-messages") return "anthropic-messages";
  if (protocol === "google-generate-content") return "google-generate-content";
  if (protocol === "xai-responses") return "xai-responses";
  return "generic-openai-compatible";
}

function directorConnectionOptionLabel(
  connection: ProviderConnectionView,
): string {
  const supplier = providerSupplierLabel(
    providerConnectionSupplierKey(connection),
  );
  const group = providerConnectionGroup(connection);
  const base = `${supplier} · ${group}`;
  return connection.name.includes(group)
    ? base
    : `${base} · ${connection.name}`;
}

function defaultDirectorCapabilities(
  protocol: DirectorProtocol,
): DirectorModelCapabilities {
  return {
    text: true,
    imageInput: false,
    audioInput: false,
    videoInput: false,
    structuredOutput: true,
    toolCalling: protocol === "anthropic-messages",
    nativeWebSearch: false,
    reasoning: false,
    probeSource: "manual",
  };
}

// Legacy settings renderer retained for serialized-layout compatibility; the
// live workbench uses the inline composer configuration below.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function DirectorBrainSettings({
  connections,
  marketplaceGroups,
  onConnectionCreated,
}: {
  connections: ProviderConnectionView[];
  marketplaceGroups: DirectorMarketplaceGroups;
  onConnectionCreated: (connection: ProviderConnectionView) => void;
}) {
  const brainConnections = directorBrainConnections(connections);
  const tavilyConnections = connections.filter((connection) => {
    const identity =
      `${connection.name} ${connection.provider} ${providerConnectionSupplierKey(connection)}`.toLowerCase();
    return identity.includes("tavily");
  });
  const [connectionId, setConnectionId] = useState("");
  const [modelId, setModelId] = useState("");
  const [protocol, setProtocol] = useState<DirectorProtocol>(
    "generic-openai-compatible",
  );
  const [capabilities, setCapabilities] = useState<DirectorModelCapabilities>(
    () => defaultDirectorCapabilities("generic-openai-compatible"),
  );
  const [reasoningEffort, setReasoningEffort] =
    useState<DirectorReasoningEffort>("auto");
  const [researchConnectionId, setResearchConnectionId] = useState("");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [modelsStatus, setModelsStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [creatingConnection, setCreatingConnection] = useState(false);
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [newProtocol, setNewProtocol] =
    useState<DirectorProtocol>("openai-responses");
  const [newName, setNewName] = useState(
    DIRECTOR_CONNECTION_PRESETS["openai-responses"].name,
  );
  const [newBaseUrl, setNewBaseUrl] = useState(
    DIRECTOR_CONNECTION_PRESETS["openai-responses"].baseUrl,
  );
  const [newModelId, setNewModelId] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const modelRequestRef = useRef(0);
  const textModelCount = models.filter(directorModelSupportsText).length;
  const selectedModel = models.find((model) => model.id === modelId);
  const availableReasoningOptions = directorReasoningOptions(
    selectedModel,
    protocol,
    capabilities,
  );

  useEffect(() => {
    if (
      !availableReasoningOptions.some(
        (option) => option.value === reasoningEffort,
      )
    )
      queueMicrotask(() => setReasoningEffort("auto"));
  }, [availableReasoningOptions, reasoningEffort]);

  const loadDirectorModels = useCallback(
    async (
      connection: ProviderConnectionView | undefined,
      preferredModel?: string,
    ) => {
      const requestId = ++modelRequestRef.current;
      const configured = ensureDirectorModel(
        directorConfiguredModelInventory(connection, marketplaceGroups),
        preferredModel,
      );
      const initialModel = preferredDirectorModelId(
        configured.models,
        preferredModel,
      );
      setModels([...configured.models]);
      setModelId(initialModel);
      setModelsStatus(null);
      if (!connection) {
        setModelsLoading(false);
        return;
      }
      setModelsLoading(true);
      try {
        const fetched = await fetchModels(connection.id);
        if (modelRequestRef.current !== requestId) return;
        const merged = mergeDirectorModelInventory(configured, fetched);
        setModels(merged);
        setModelId(
          preferredDirectorModelId(merged, preferredModel || initialModel),
        );
        if (!merged.some(directorModelSupportsText))
          setModelsStatus("这个分组没有可作为导演大脑的文本模型");
      } catch (error) {
        if (modelRequestRef.current !== requestId) return;
        setModelsStatus(
          configured.models.some(directorModelSupportsText)
            ? "实时目录暂不可用，当前显示已保存的分组模型"
            : error instanceof Error
              ? error.message
              : "分组模型读取失败",
        );
      } finally {
        if (modelRequestRef.current === requestId) setModelsLoading(false);
      }
    },
    [marketplaceGroups],
  );

  useEffect(() => {
    let cancelled = false;
    const availableConnections = directorBrainConnections(connections);
    void fetchDirectorProfile().then(
      (profile) => {
        if (cancelled) return;
        const nextConnectionId =
          profile.brainConnectionId ?? availableConnections[0]?.id ?? "";
        const nextConnection = availableConnections.find(
          (connection) => connection.id === nextConnectionId,
        );
        setConnectionId(nextConnectionId);
        void loadDirectorModels(nextConnection, profile.brainModelId);
        setProtocol(
          profile.protocol ?? inferredDirectorProtocol(nextConnection),
        );
        setCapabilities(
          profile.capabilities ??
            defaultDirectorCapabilities(
              profile.protocol ?? inferredDirectorProtocol(nextConnection),
            ),
        );
        setReasoningEffort(
          (profile.reasoningEffort as DirectorReasoningEffort | undefined) ??
            "auto",
        );
        setResearchConnectionId(profile.researchConnectionId ?? "");
        setConnected(
          profile.connected && nextConnectionId === profile.brainConnectionId,
        );
        setLoading(false);
      },
      (error: unknown) => {
        if (cancelled) return;
        setStatus(error instanceof Error ? error.message : "导演配置读取失败");
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
      modelRequestRef.current += 1;
    };
  }, [connections, loadDirectorModels]);

  function selectBrainConnection(nextConnectionId: string) {
    const connection = brainConnections.find(
      (item) => item.id === nextConnectionId,
    );
    setConnectionId(nextConnectionId);
    void loadDirectorModels(connection);
    const nextProtocol = inferredDirectorProtocol(connection);
    setProtocol(nextProtocol);
    setCapabilities(defaultDirectorCapabilities(nextProtocol));
    setReasoningEffort("auto");
    setConnected(false);
    setStatus(null);
  }

  async function handleSaveDirector() {
    if (!connectionId || !modelId.trim()) return;
    setSaving(true);
    setStatus(null);
    try {
      const profile = await saveDirectorProfile({
        brainConnectionId: connectionId,
        brainModelId: modelId.trim(),
        protocol,
        capabilities: { ...capabilities, probeSource: "manual" },
        researchConnectionId: researchConnectionId || null,
        reasoningEffort: reasoningEffort === "auto" ? null : reasoningEffort,
      });
      setConnected(profile.connected);
      setStatus("导演大脑配置已保存；供应商连接配置未改动");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导演配置保存失败");
    } finally {
      setSaving(false);
    }
  }

  function selectNewProtocol(nextProtocol: DirectorProtocol) {
    const preset = DIRECTOR_CONNECTION_PRESETS[nextProtocol];
    setNewProtocol(nextProtocol);
    setNewName(preset.name);
    setNewBaseUrl(preset.baseUrl);
  }

  async function handleCreateDirectorConnection() {
    if (
      !newName.trim() ||
      !newBaseUrl.trim() ||
      !newModelId.trim() ||
      !newApiKey
    ) {
      setStatus("请填完连接名称、API 地址、模型 ID 和 API Key");
      return;
    }
    setCreatingConnection(true);
    setStatus(null);
    const nextCapabilities = defaultDirectorCapabilities(newProtocol);
    let saved: ProviderConnectionView | undefined;
    try {
      const preset = DIRECTOR_CONNECTION_PRESETS[newProtocol];
      saved = await saveConnection({
        name: newName.trim(),
        provider: "rest",
        apiKey: newApiKey,
        config: {
          usage: "agent",
          supplierKey: preset.supplierKey,
          baseUrl: newBaseUrl.trim(),
          defaultModel: newModelId.trim(),
          directorProtocol: newProtocol,
        },
      });
      const profile = await saveDirectorProfile({
        brainConnectionId: saved.id,
        brainModelId: newModelId.trim(),
        protocol: newProtocol,
        capabilities: nextCapabilities,
        researchConnectionId: researchConnectionId || null,
      });
      onConnectionCreated(saved);
      setConnectionId(saved.id);
      setModelId(newModelId.trim());
      setProtocol(newProtocol);
      setCapabilities(nextCapabilities);
      setReasoningEffort("auto");
      setConnected(profile.connected);
      void loadDirectorModels(saved, newModelId.trim());
      setNewApiKey("");
      setCreateFormOpen(false);
      setStatus("已新建独立导演连接并设为当前大脑");
    } catch (error) {
      if (saved) onConnectionCreated(saved);
      setStatus(
        saved
          ? `连接已新建，但导演配置保存失败：${error instanceof Error ? error.message : "未知错误"}`
          : error instanceof Error
            ? error.message
            : "导演连接新建失败",
      );
    } finally {
      setCreatingConnection(false);
    }
  }

  return (
    <div className="director-brain-settings">
      <div className="director-brain-settings-head">
        <div>
          <span className="eyebrow">独立路由配置</span>
          <h3>固定导演大脑</h3>
          <p>
            自动读取供应商设置中已保存 Key
            的分组，并加载所选分组的完整模型目录；这里不会改写供应商密钥、地址或默认参数。
          </p>
        </div>
        <span
          className={`director-connection-state ${connected ? "online" : ""}`}
        >
          <span className="provider-dot" />
          {connected ? "连接可用" : "待配置或待验证"}
        </span>
      </div>

      <section className="director-connection-create">
        <header>
          <div>
            <strong>补充独立连接</strong>
            <small>
              现有供应商没有合适分组时，可新增 GPT、Claude、Grok、Gemini
              或兼容接口
            </small>
          </div>
          <button
            className="button small"
            type="button"
            onClick={() => setCreateFormOpen((current) => !current)}
            disabled={creatingConnection || saving}
            aria-expanded={createFormOpen}
          >
            {createFormOpen ? <X size={13} /> : <Plus size={13} />}
            {createFormOpen ? "收起" : "新增连接"}
          </button>
        </header>
        {createFormOpen ? (
          <div className="director-connection-create-body">
            <div className="field">
              <label htmlFor="director-new-protocol">接口协议</label>
              <select
                id="director-new-protocol"
                value={newProtocol}
                onChange={(event) =>
                  selectNewProtocol(event.target.value as DirectorProtocol)
                }
                disabled={creatingConnection}
              >
                {DIRECTOR_PROTOCOL_OPTIONS.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="director-new-name">连接名称</label>
              <input
                id="director-new-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                disabled={creatingConnection}
              />
            </div>
            <div className="field director-connection-create-wide">
              <label htmlFor="director-new-base-url">API Base URL</label>
              <input
                id="director-new-base-url"
                value={newBaseUrl}
                onChange={(event) => setNewBaseUrl(event.target.value)}
                placeholder="https://api.example.com/v1"
                disabled={creatingConnection}
              />
            </div>
            <div className="field">
              <label htmlFor="director-new-model">模型 ID</label>
              <input
                id="director-new-model"
                value={newModelId}
                onChange={(event) => setNewModelId(event.target.value)}
                placeholder="例如 gpt-5"
                disabled={creatingConnection}
              />
            </div>
            <div className="field">
              <label htmlFor="director-new-api-key">API Key</label>
              <input
                id="director-new-api-key"
                type="password"
                value={newApiKey}
                onChange={(event) => setNewApiKey(event.target.value)}
                autoComplete="off"
                disabled={creatingConnection}
              />
            </div>
            <div className="director-connection-create-submit">
              <button
                className="button primary"
                type="button"
                onClick={() => void handleCreateDirectorConnection()}
                disabled={
                  creatingConnection ||
                  !newName.trim() ||
                  !newBaseUrl.trim() ||
                  !newModelId.trim() ||
                  !newApiKey
                }
              >
                {creatingConnection ? (
                  <RefreshCw className="spin" size={13} />
                ) : (
                  <Plus size={13} />
                )}
                新增并设为导演大脑
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {brainConnections.length === 0 ? (
        <div className="settings-empty-detail">
          <span className="settings-empty-icon">
            <Film size={22} />
          </span>
          <strong>还没有已配置 Key 的供应商分组</strong>
          <p>
            先在“供应商”中为任意文本模型分组保存
            Key，导演连接会自动出现在这里；也可以点击上方新增独立连接。
          </p>
        </div>
      ) : (
        <>
          <div className="director-brain-grid">
            <div className="field">
              <label htmlFor="director-brain-connection">
                导演连接（已接入分组）
              </label>
              <select
                id="director-brain-connection"
                value={connectionId}
                onChange={(event) => selectBrainConnection(event.target.value)}
                disabled={loading || saving}
              >
                {brainConnections.map((connection) => (
                  <option value={connection.id} key={connection.id}>
                    {directorConnectionOptionLabel(connection)}
                    {connection.apiKeyUsable ? "" : "（密钥待验证）"}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="director-brain-model">导演模型</label>
              <select
                id="director-brain-model"
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
                disabled={loading || saving || modelsLoading}
              >
                {modelsLoading || textModelCount === 0 ? (
                  <option value="">
                    {modelsLoading ? "正在读取分组模型…" : "没有可用文本模型"}
                  </option>
                ) : null}
                {models.map((model) => (
                  <option
                    value={model.id}
                    key={model.id}
                    disabled={!directorModelSupportsText(model)}
                  >
                    {model.name === model.id
                      ? model.id
                      : `${model.name} · ${model.id}`}
                    {directorModelSupportsText(model) ? "" : "（非文本模型）"}
                  </option>
                ))}
              </select>
              <small className="director-model-inventory-status">
                {modelsStatus ??
                  (modelsLoading
                    ? "正在合并平台目录、已保存目录与实时模型列表"
                    : `分组共 ${models.length} 个模型，${textModelCount} 个可用于导演`)}
              </small>
            </div>
            <div className="field">
              <label htmlFor="director-brain-protocol">
                接口协议（自动适配）
              </label>
              <select
                id="director-brain-protocol"
                value={protocol}
                onChange={(event) =>
                  setProtocol(event.target.value as DirectorProtocol)
                }
                disabled={loading || saving}
              >
                {DIRECTOR_PROTOCOL_OPTIONS.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {availableReasoningOptions.length > 1 ? (
              <div className="field">
                <label htmlFor="director-brain-reasoning">推理强度</label>
                <select
                  id="director-brain-reasoning"
                  value={reasoningEffort}
                  onChange={(event) =>
                    setReasoningEffort(
                      event.target.value as DirectorReasoningEffort,
                    )
                  }
                  disabled={loading || saving || modelsLoading}
                >
                  {availableReasoningOptions.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small className="director-model-inventory-status">
                  仅在当前模型支持时发送推理参数；自动不会额外发送参数
                </small>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="director-research-connection">
                Tavily 研究连接（可选）
              </label>
              <select
                id="director-research-connection"
                value={researchConnectionId}
                onChange={(event) =>
                  setResearchConnectionId(event.target.value)
                }
                disabled={loading || saving}
              >
                <option value="">未配置，优先使用模型原生搜索</option>
                {tavilyConnections.map((connection) => (
                  <option value={connection.id} key={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="director-capabilities-auto">
            模型能力由供应商目录和实际探测自动读取；不支持的输入、工具和搜索能力不会加入导演流程。
          </p>
        </>
      )}

      <div className="director-brain-actions">
        {status ? <span role="status">{status}</span> : <span />}
        <button
          className="button primary"
          type="button"
          onClick={() => void handleSaveDirector()}
          disabled={saving || loading || !connectionId || !modelId.trim()}
        >
          {saving ? (
            <RefreshCw className="spin" size={13} />
          ) : (
            <Check size={13} />
          )}
          保存导演配置
        </button>
      </div>
    </div>
  );
}

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
  const [cyberAfeiModels, setCyberAfeiModels] = useState<ModelDescriptor[]>([]);
  const [cyberAfeiGroups, setCyberAfeiGroups] = useState<
    CangyuanMarketplaceGroupView[]
  >([]);
  const [chentuModels, setChentuModels] = useState<ModelDescriptor[]>([]);
  const [chentuGroups, setChentuGroups] = useState<
    CangyuanMarketplaceGroupView[]
  >([]);
  const [miaowuModels, setMiaowuModels] = useState<ModelDescriptor[]>([]);
  const [miaowuGroups, setMiaowuGroups] = useState<
    CangyuanMarketplaceGroupView[]
  >([]);
  const [selectedMarketplaceGroup, setSelectedMarketplaceGroup] =
    useState<string>(CANGYUAN_ALL_MODELS_GROUP);
  const [selectedMarketplaceModel, setSelectedMarketplaceModel] =
    useState<string>("");
  const [selectedWeAiGroup, setSelectedWeAiGroup] = useState<WeAiGroupId>(
    WEAI_CODEX_TOKEN_GROUP,
  );
  const [selectedWeAiModel, setSelectedWeAiModel] =
    useState<string>("gpt-image-2");
  const [selectedWeAiProtocol, setSelectedWeAiProtocol] =
    useState<WeAiProtocol>("openai-images");
  const [weAiModelScans, setWeAiModelScans] = useState<
    Record<string, WeAiModelScanState>
  >({});
  const [selectedMikotoGroup, setSelectedMikotoGroup] = useState<MikotoGroupId>(
    MIKOTO_IMAGE_1K_GROUP,
  );
  const [selectedMikotoModel, setSelectedMikotoModel] =
    useState(MIKOTO_DEFAULT_MODEL);
  const [catalogSource, setCatalogSource] = useState<
    "live" | "stale" | "fallback"
  >("fallback");
  const [cangyuanAvailability, setCangyuanAvailability] = useState<
    Record<string, CangyuanAvailabilityView>
  >({});
  const [cangyuanAvailabilityState, setCangyuanAvailabilityState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [cangyuanAvailabilityRefresh, setCangyuanAvailabilityRefresh] =
    useState(0);
  const [cyberAfeiCatalogSource, setCyberAfeiCatalogSource] = useState<
    "live" | "unavailable" | "stale" | "fallback"
  >("fallback");
  const [chentuCatalogSource, setChentuCatalogSource] = useState<
    "live" | "stale" | "fallback"
  >("fallback");
  const [miaowuCatalogSource, setMiaowuCatalogSource] = useState<
    "live" | "stale" | "fallback"
  >("fallback");
  const cangyuanRequestRef = useRef(0);
  const cangyuanAvailabilityRequestRef = useRef(0);
  const cyberAfeiRequestRef = useRef(0);
  const chentuRequestRef = useRef(0);
  const miaowuRequestRef = useRef(0);
  const [apiKey, setApiKey] = useState("");
  const [editingCangyuanKey, setEditingCangyuanKey] = useState(false);
  const [editingCyberAfeiKey, setEditingCyberAfeiKey] = useState(false);
  const [editingWeAiKey, setEditingWeAiKey] = useState(false);
  const [editingMikotoKey, setEditingMikotoKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [customGroupName, setCustomGroupName] = useState("");
  const [customModels, setCustomModels] = useState<ModelDescriptor[]>([]);
  const [customModelsLoading, setCustomModelsLoading] = useState(false);
  const customModelsRequestRef = useRef(0);
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
      ...(cyberAfeiGroups.length > 0 ? [CYBERAFEI_SUPPLIER_KEY] : []),
      MIKOTO_SUPPLIER_KEY,
      MIAOWU_SUPPLIER_KEY,
      FRIMODEL_SUPPLIER_KEY,
      CHENTU_SUPPLIER_KEY,
      "weai",
      "openai",
      CYBERAFEI_SUPPLIER_KEY,
      "runway",
      "rest",
      "fake",
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
  // 辰途实时目录加载完成前使用内置快照兜底，避免打开设置时分组列表闪空。
  const effectiveChentuGroups = useMemo<CangyuanMarketplaceGroupView[]>(
    () =>
      chentuGroups.length > 0
        ? chentuGroups
        : CHENTU_PLATFORM_GROUPS.map((group) => ({
            ...group,
            models: [...group.models],
          })),
    [chentuGroups],
  );
  const activeMarketplaceGroups =
    activeSupplierKey === CYBERAFEI_SUPPLIER_KEY
      ? cyberAfeiGroups
      : activeSupplierKey === FRIMODEL_SUPPLIER_KEY
        ? FRIMODEL_PLATFORM_GROUPS
        : activeSupplierKey === CHENTU_SUPPLIER_KEY
          ? effectiveChentuGroups
          : activeSupplierKey === MIAOWU_SUPPLIER_KEY
            ? miaowuGroups
            : cangyuanGroups;
  const activeMarketplaceGroup = activeMarketplaceGroups.find(
    (group) => group.id === selectedMarketplaceGroup,
  );
  const activeMarketplaceModel = activeMarketplaceGroup?.models.find(
    (model) => model.id === selectedMarketplaceModel,
  );
  const activeCangyuanAvailability =
    activeSupplierKey === "cangyuan" && activeMarketplaceModel
      ? cangyuanAvailability[activeMarketplaceModel.id]
      : undefined;
  const miaowuMarketplaceModelCount = new Set(
    miaowuGroups.flatMap((group) => group.models.map((model) => model.id)),
  ).size;
  const activeConnectionUsage = cangyuanGroupUsage(activeMarketplaceGroup);
  const activeMarketplaceConnection = findProviderGroupConnection(
    connections,
    activeSupplierKey,
    selectedMarketplaceGroup,
    activeConnectionUsage,
  );
  const activeBuiltInGroupIds = new Set(
    activeSupplierKey === "cangyuan"
      ? cangyuanGroups.map((group) => group.id)
      : activeSupplierKey === CYBERAFEI_SUPPLIER_KEY
        ? cyberAfeiGroups.map((group) => group.id)
        : activeSupplierKey === FRIMODEL_SUPPLIER_KEY
          ? FRIMODEL_PLATFORM_GROUPS.map((group) => group.id)
          : activeSupplierKey === CHENTU_SUPPLIER_KEY
            ? effectiveChentuGroups.map((group) => group.id)
            : activeSupplierKey === MIAOWU_SUPPLIER_KEY
              ? miaowuGroups.map((group) => group.id)
              : activeSupplierKey === "weai"
                ? WEAI_CATALOG.map((group) => group.id)
                : activeSupplierKey === MIKOTO_SUPPLIER_KEY
                  ? [...MIKOTO_GROUP_IDS]
                  : [],
  );
  const isCustomConnection = (connection: ProviderConnectionView) =>
    !activeBuiltInGroupIds.has(providerConnectionGroup(connection));
  const activeCustomConnections =
    activeSupplierConnections.filter(isCustomConnection);
  const customGroupFormActive =
    creatingNew && preservedConfig.customGroup === true;
  const activeGroupKeyAvailable = Boolean(
    activeMarketplaceConnection?.apiKeyUsable,
  );
  const activeGroupHasUnreadableKey = Boolean(
    activeMarketplaceConnection?.apiKeySet &&
    !activeMarketplaceConnection.apiKeyUsable,
  );
  const activeRuntimeModel = (
    activeSupplierKey === CYBERAFEI_SUPPLIER_KEY
      ? cyberAfeiModels
      : activeSupplierKey === FRIMODEL_SUPPLIER_KEY
        ? []
        : activeSupplierKey === CHENTU_SUPPLIER_KEY
          ? chentuModels
          : activeSupplierKey === MIAOWU_SUPPLIER_KEY
            ? miaowuModels
            : cangyuanModels
  ).find((model) => model.id === selectedMarketplaceModel);
  const activeWeAiGroup = weAiCatalogGroup(selectedWeAiGroup);
  const activeWeAiConnection = connections.find(
    (connection) =>
      providerConnectionSupplierKey(connection) === "weai" &&
      providerConnectionGroup(connection) === selectedWeAiGroup,
  );
  const activeWeAiScan = activeWeAiConnection
    ? weAiModelScans[activeWeAiConnection.id]
    : undefined;
  const activeWeAiLiveIds = new Set(
    activeWeAiScan?.status === "ready"
      ? activeWeAiScan.items.map((model) => model.id)
      : [],
  );
  const activeWeAiVisibleModels = activeWeAiGroup
    ? !activeWeAiConnection
      ? activeWeAiGroup.models
      : activeWeAiConnection.apiKeyUsable && activeWeAiScan?.status === "ready"
        ? activeWeAiGroup.models.filter((model) =>
            activeWeAiLiveIds.has(model.id),
          )
        : []
    : [];
  const activeWeAiModel = activeWeAiVisibleModels.find(
    (model) => model.id === selectedWeAiModel,
  );
  const displayedWeAiModel = activeWeAiModel ?? activeWeAiVisibleModels[0];
  const activeWeAiCallableCount = activeWeAiVisibleModels.filter(
    (model) => model.canvasCallable,
  ).length;
  const resolvedWeAiDefaultModelId = activeWeAiGroup
    ? resolveWeAiDefaultModel(activeWeAiGroup, defaultModel)
    : "";
  const activeWeAiDefaultModel =
    activeWeAiVisibleModels.find(
      (model) => model.id === resolvedWeAiDefaultModelId,
    ) ?? activeWeAiVisibleModels.find((model) => model.canvasCallable);
  const activeWeAiProtocol = activeWeAiGroup
    ? resolveWeAiProtocol(activeWeAiGroup, selectedWeAiProtocol)
    : selectedWeAiProtocol;
  const activeWeAiProtocolOption = activeWeAiGroup?.protocols.find(
    (protocol) => protocol.id === activeWeAiProtocol,
  );
  const activeWeAiKeyAvailable = Boolean(activeWeAiConnection?.apiKeyUsable);
  const activeWeAiKeyUnreadable = Boolean(
    activeWeAiConnection?.apiKeySet && !activeWeAiConnection.apiKeyUsable,
  );
  const activeMikotoGroup = mikotoGroup(selectedMikotoGroup);
  const activeMikotoModel = activeMikotoGroup?.models.find(
    (model) => model.id === selectedMikotoModel,
  );
  const activeMikotoConnection = connections.find(
    (connection) =>
      providerConnectionSupplierKey(connection) === MIKOTO_SUPPLIER_KEY &&
      providerConnectionGroup(connection) === selectedMikotoGroup &&
      providerConnectionUsage(connection) === "canvas",
  );
  const activeMikotoKeyAvailable = Boolean(
    activeMikotoConnection?.apiKeyUsable,
  );
  const activeMikotoKeyUnreadable = Boolean(
    activeMikotoConnection?.apiKeySet && !activeMikotoConnection.apiKeyUsable,
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

  /** Start a fresh form when changing supplier, so an empty key cannot retain
   * or overwrite the previously selected connection's encrypted secret. */
  function beginProviderFormSwitch() {
    setSelectedId(null);
    setCreatingNew(true);
    setApiKey("");
    setEditingCangyuanKey(false);
    setEditingCyberAfeiKey(false);
    setEditingWeAiKey(false);
    setEditingMikotoKey(false);
    setPreservedConfig({});
    setConnectorJson(JSON.stringify(defaultRestConfig.connector, null, 2));
    setSelectedMarketplaceModel("");
    setCangyuanModels([]);
    setCyberAfeiModels([]);
    setChentuModels([]);
    setDefaultModel("");
    setBaseUrl("");
    setMessage(null);
  }

  function applyMikotoGroup(groupId: MikotoGroupId) {
    const group = mikotoGroup(groupId) ?? mikotoGroup(MIKOTO_IMAGE_1K_GROUP)!;
    const config = mikotoConnectionConfig(group.id);
    setPresetId(MIKOTO_PRESET_ID);
    setSelectedSupplierKey(MIKOTO_SUPPLIER_KEY);
    setProvider(group.provider);
    setSelectedMikotoGroup(group.id);
    setSelectedMikotoModel(group.defaultModel);
    setName(`MikotoPro · ${group.label}`);
    setBaseUrl(MIKOTO_BASE_URL);
    setDefaultModel(group.defaultModel);
    if ("connector" in config && config.connector)
      setConnectorJson(JSON.stringify(config.connector, null, 2));
    setPreservedConfig({
      supplierKey: MIKOTO_SUPPLIER_KEY,
      usage: "canvas",
      modelGroup: group.id,
      ...(group.protocol ? { protocol: group.protocol } : {}),
    });
    setCangyuanModels([]);
    setMessage(null);
  }

  function applyMikotoPreset() {
    applyMikotoGroup(MIKOTO_IMAGE_1K_GROUP);
  }

  function applyMiaowuPreset() {
    const marketplaceGroup =
      miaowuGroups.find((group) => group.id === selectedMarketplaceGroup) ??
      miaowuGroups[0];
    if (marketplaceGroup) {
      selectMiaowuMarketplaceGroup(marketplaceGroup.id);
      return;
    }
    const config = miaowuConnectionConfig();
    setPresetId(MIAOWU_PRESET_ID);
    setSelectedSupplierKey(MIAOWU_SUPPLIER_KEY);
    setProvider("rest");
    setName("喵呜 API · OpenAI Videos");
    setBaseUrl(MIAOWU_BASE_URL);
    setDefaultModel(MIAOWU_DEFAULT_MODEL);
    setConnectorJson(JSON.stringify(config.connector, null, 2));
    setPreservedConfig({
      supplierKey: MIAOWU_SUPPLIER_KEY,
      supplierWebsiteUrl: "https://api.miaowuai.store/pricing",
      usage: "canvas",
      modelGroup: MIAOWU_MODEL_GROUP,
    });
    setCangyuanModels([]);
    setMessage(null);
  }

  function applyFriModelPreset() {
    const config = friModelConnectionConfig();
    setPresetId(FRIMODEL_PRESET_ID);
    setSelectedSupplierKey(FRIMODEL_SUPPLIER_KEY);
    setProvider("openai");
    setName("FriModel 图片 API");
    setBaseUrl(FRIMODEL_BASE_URL);
    setDefaultModel(FRIMODEL_DEFAULT_MODEL);
    setPreservedConfig({
      supplierKey: FRIMODEL_SUPPLIER_KEY,
      supplierWebsiteUrl: config.supplierWebsiteUrl,
      usage: "canvas",
      modelGroup: FRIMODEL_MODEL_GROUP,
    });
    setCangyuanModels([]);
    setMessage(null);
  }

  function startNewFriModelConnection() {
    setSelectedId(null);
    setCreatingNew(true);
    setSelectedMarketplaceGroup(FRIMODEL_MODEL_GROUP);
    setSelectedMarketplaceModel(FRIMODEL_DEFAULT_MODEL);
    setApiKey("");
    applyFriModelPreset();
    setName("FriModel · 自定义图片连接");
    setPreservedConfig({
      ...friModelConnectionConfig(),
      modelGroup: FRIMODEL_MODEL_GROUP,
    });
  }

  function applyChentuPreset() {
    const config = chentuConnectionConfig();
    setPresetId(CHENTU_PRESET_ID);
    setSelectedSupplierKey(CHENTU_SUPPLIER_KEY);
    setProvider("openai");
    setName("辰途 API 图片");
    setBaseUrl(CHENTU_BASE_URL);
    setDefaultModel(CHENTU_DEFAULT_MODEL);
    setPreservedConfig({
      supplierKey: CHENTU_SUPPLIER_KEY,
      supplierWebsiteUrl: config.supplierWebsiteUrl,
      usage: "canvas",
      modelGroup: CHENTU_MODEL_GROUP,
      requestTimeoutMs: config.requestTimeoutMs,
    });
    setCangyuanModels([]);
    setMessage(null);
  }

  function startNewChentuConnection() {
    setSelectedId(null);
    setCreatingNew(true);
    setSelectedMarketplaceGroup(CHENTU_MODEL_GROUP);
    setSelectedMarketplaceModel(CHENTU_DEFAULT_MODEL);
    setApiKey("");
    applyChentuPreset();
    setName("辰途 API · 实时图片连接");
    setPreservedConfig(chentuConnectionConfig());
  }

  async function refreshCangyuanGroup(
    group: CangyuanImageGroup,
    preferredDefault?: string,
    connectionToSync?: ProviderConnectionView,
    persist = false,
  ) {
    const requestId = ++cangyuanRequestRef.current;
    try {
      const catalog = await fetchCangyuanCatalog(group, { refresh: persist });
      if (requestId !== cangyuanRequestRef.current || catalog.group !== group)
        return;
      // An explicit refresh asks the server to reconcile the saved connector
      // and retain models that are temporarily absent from the marketplace
      // response. Selection and settings initialization stay snapshot-only.
      const models =
        connectionToSync && persist
          ? await refreshModels(connectionToSync.id)
          : catalog.models;
      if (requestId !== cangyuanRequestRef.current) return;
      const next = applyCangyuanGroup(group, models, preferredDefault);
      if (connectionToSync && persist) {
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
      if (requestId === cangyuanRequestRef.current) {
        setMessage(
          error instanceof Error ? error.message : "沧元模型广场读取失败",
        );
      }
    }
  }

  function applyCyberAfeiGroup(
    group: string,
    models: readonly ModelDescriptor[],
    preferredDefault?: string,
  ) {
    const connector = cyberAfeiConnectorForModels(models);
    const defaultModel =
      preferredDefault && models.some((model) => model.id === preferredDefault)
        ? preferredDefault
        : cyberAfeiDefaultModelForGroup(group, models);
    setModelGroup(CANGYUAN_IMAGE_GROUP);
    setCyberAfeiModels([...models]);
    setDefaultModel(defaultModel);
    setConnectorJson(JSON.stringify(connector, null, 2));
    return { connector, defaultModel };
  }

  async function refreshCyberAfeiGroup(
    group: string,
    preferredDefault?: string,
    connectionToSync?: ProviderConnectionView,
  ) {
    const requestId = ++cyberAfeiRequestRef.current;
    try {
      const catalog = await fetchCyberAfeiCatalog(group);
      if (requestId !== cyberAfeiRequestRef.current || catalog.group !== group)
        return;
      setCyberAfeiCatalogSource(catalog.source);
      if (catalog.inventoryModels) {
        setCyberAfeiGroups((current) =>
          current.map((item) =>
            item.id === group
              ? {
                  ...item,
                  models: catalog.inventoryModels!,
                  canvasSupported: catalog.models.length > 0,
                  canvasModelCount: catalog.models.length,
                  scanStatus: catalog.scanStatus,
                  scanError: catalog.scanError,
                  scannedModelCount: catalog.scannedModelCount,
                  scanCheckedAt: catalog.checkedAt,
                }
              : item,
          ),
        );
      }
      applyCyberAfeiGroup(group, catalog.models, preferredDefault);
      if (connectionToSync) {
        const refreshed = await fetchConnections();
        const saved = refreshed.find(
          (connection) => connection.id === connectionToSync.id,
        );
        setConnections(refreshed);
        if (saved) setPreservedConfig(saved.config);
      }
    } catch (error) {
      if (requestId === cyberAfeiRequestRef.current)
        setMessage(
          error instanceof Error ? error.message : "赛博阿飞模型广场读取失败",
        );
    }
  }

  async function refreshChentuGroup(
    group: string,
    preferredDefault?: string,
    connectionToSync?: ProviderConnectionView,
  ) {
    const requestId = ++chentuRequestRef.current;
    try {
      const catalog = await fetchChentuCatalog(group);
      if (requestId !== chentuRequestRef.current || catalog.group !== group)
        return;
      setChentuCatalogSource(catalog.source);
      if (catalog.inventoryModels) {
        setChentuGroups((current) =>
          current.map((item) =>
            item.id === group
              ? {
                  ...item,
                  models: catalog.inventoryModels!,
                  canvasSupported: catalog.models.length > 0,
                  canvasModelCount: catalog.models.length,
                  scanStatus: catalog.scanStatus,
                  scanError: catalog.scanError,
                  scannedModelCount: catalog.scannedModelCount,
                  scanCheckedAt: catalog.checkedAt,
                }
              : item,
          ),
        );
      }
      setChentuModels([...catalog.models]);
      const nextDefault =
        preferredDefault &&
        catalog.models.some((model) => model.id === preferredDefault)
          ? preferredDefault
          : (catalog.models[0]?.id ?? "");
      if (nextDefault) setDefaultModel(nextDefault);
      if (connectionToSync) {
        const refreshed = await fetchConnections();
        const saved = refreshed.find(
          (connection) => connection.id === connectionToSync.id,
        );
        setConnections(refreshed);
        if (saved) setPreservedConfig(saved.config);
      }
    } catch (error) {
      if (requestId === chentuRequestRef.current)
        setMessage(
          error instanceof Error ? error.message : "辰途模型广场读取失败",
        );
    }
  }

  async function refreshMiaowuGroup(
    group: string,
    preferredDefault?: string,
    connectionToSync?: ProviderConnectionView,
    force = false,
  ) {
    const requestId = ++miaowuRequestRef.current;
    try {
      const catalog = await fetchMiaowuCatalog(group, { refresh: force });
      if (requestId !== miaowuRequestRef.current || catalog.group !== group)
        return;
      setMiaowuCatalogSource(catalog.source);
      let models = catalog.models;
      if (connectionToSync?.apiKeyUsable) {
        models = await refreshModels(connectionToSync.id);
        if (requestId !== miaowuRequestRef.current) return;
      }
      setMiaowuModels([...models]);
      const nextDefault =
        preferredDefault &&
        models.some((model) => model.id === preferredDefault)
          ? preferredDefault
          : (models[0]?.id ?? "");
      if (nextDefault) setDefaultModel(nextDefault);
      if (connectionToSync) {
        const refreshed = await fetchConnections();
        const saved = refreshed.find(
          (connection) => connection.id === connectionToSync.id,
        );
        setConnections(refreshed);
        if (saved) setPreservedConfig(saved.config);
      }
    } catch (error) {
      if (requestId === miaowuRequestRef.current)
        setMessage(
          error instanceof Error ? error.message : "喵呜模型分组读取失败",
        );
    }
  }

  const reload = async () => setConnections(await fetchConnections());
  useEffect(() => {
    // Director settings also need the marketplace inventories so a selected
    // supplier group can expose every model. Keep this request alive when the
    // user switches tabs while catalogs are still loading.
    if (!open) return;
    let cancelled = false;
    void Promise.all([
      fetchConnections(),
      fetchCangyuanMarketplace(),
      fetchCyberAfeiMarketplace().catch(
        () =>
          ({ checkedAt: "", source: "unavailable", groups: [] }) as Awaited<
            ReturnType<typeof fetchCyberAfeiMarketplace>
          >,
      ),
      fetchChentuMarketplace().catch(
        () =>
          ({ checkedAt: "", source: "fallback", groups: [] }) as Awaited<
            ReturnType<typeof fetchChentuMarketplace>
          >,
      ),
      fetchMiaowuMarketplace().catch(
        () =>
          ({ checkedAt: "", source: "fallback", groups: [] }) as Awaited<
            ReturnType<typeof fetchMiaowuMarketplace>
          >,
      ),
    ]).then(
      async ([
        loadedItems,
        marketplace,
        cyberAfeiMarketplace,
        chentuMarketplace,
        miaowuMarketplace,
      ]) => {
        if (cancelled) return;
        // Catalog overview requests are read-only. Keep the connection list
        // returned by the same batch; explicit refresh actions re-read it after
        // their scoped scan completes.
        const items = normalizeLoadedWeAiConnections(loadedItems);
        if (cancelled) return;
        setConnections(items);
        setCangyuanGroups(marketplace.groups);
        setCatalogSource(marketplace.source);
        setCyberAfeiGroups(cyberAfeiMarketplace.groups);
        setCyberAfeiCatalogSource(cyberAfeiMarketplace.source);
        if (chentuMarketplace.groups.length > 0) {
          setChentuGroups(chentuMarketplace.groups);
          setChentuCatalogSource(chentuMarketplace.source);
        }
        setMiaowuGroups(miaowuMarketplace.groups);
        setMiaowuCatalogSource(miaowuMarketplace.source);
        const weAiConnection = items.find(
          (connection) =>
            providerConnectionSupplierKey(connection) === "weai" &&
            isWeAiGroupId(providerConnectionGroup(connection)),
        );
        const weAiGroup: WeAiGroupId = isWeAiGroupId(
          weAiConnection ? providerConnectionGroup(weAiConnection) : "",
        )
          ? (providerConnectionGroup(weAiConnection!) as WeAiGroupId)
          : WEAI_CODEX_TOKEN_GROUP;
        const weAiCatalog = weAiCatalogGroup(weAiGroup);
        setSelectedWeAiGroup(weAiGroup);
        const safeWeAiDefault = weAiCatalog
          ? resolveWeAiDefaultModel(
              weAiCatalog,
              typeof weAiConnection?.config.defaultModel === "string"
                ? weAiConnection.config.defaultModel
                : undefined,
            )
          : "";
        setSelectedWeAiModel(safeWeAiDefault);
        setDefaultModel(safeWeAiDefault);
        if (weAiCatalog) {
          setSelectedWeAiProtocol(
            resolveWeAiProtocol(weAiCatalog, weAiConnection?.config.protocol),
          );
        }
        const mikotoConnection = items.find(
          (connection) =>
            providerConnectionSupplierKey(connection) === MIKOTO_SUPPLIER_KEY &&
            providerConnectionUsage(connection) === "canvas" &&
            isMikotoGroupId(providerConnectionGroup(connection)),
        );
        const mikotoGroupId: MikotoGroupId = isMikotoGroupId(
          mikotoConnection ? providerConnectionGroup(mikotoConnection) : "",
        )
          ? (providerConnectionGroup(mikotoConnection!) as MikotoGroupId)
          : MIKOTO_IMAGE_1K_GROUP;
        const mikotoCatalogGroup = mikotoGroup(mikotoGroupId);
        setSelectedMikotoGroup(mikotoGroupId);
        setSelectedMikotoModel(
          typeof mikotoConnection?.config.defaultModel === "string" &&
            mikotoCatalogGroup?.models.some(
              (model) => model.id === mikotoConnection.config.defaultModel,
            )
            ? mikotoConnection.config.defaultModel
            : (mikotoCatalogGroup?.defaultModel ?? MIKOTO_DEFAULT_MODEL),
        );
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
              : marketplace.groups.length > 0
                ? "cangyuan"
                : cyberAfeiMarketplace.groups.length > 0
                  ? CYBERAFEI_SUPPLIER_KEY
                  : "weai",
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

  useEffect(() => {
    if (
      !open ||
      activeSupplierKey !== "cangyuan" ||
      !activeMarketplaceConnection?.apiKeyUsable
    ) {
      setCangyuanAvailabilityState("idle");
      return;
    }
    const connectionId = activeMarketplaceConnection.id;
    const requestId = ++cangyuanAvailabilityRequestRef.current;
    let cancelled = false;
    setCangyuanAvailabilityState("loading");
    void fetchCangyuanAvailability(connectionId, { windowDays: 7 }).then(
      (snapshot) => {
        if (
          cancelled ||
          requestId !== cangyuanAvailabilityRequestRef.current
        )
          return;
        setCangyuanAvailability(
          Object.fromEntries(snapshot.items.map((item) => [item.name, item])),
        );
        setCangyuanAvailabilityState("ready");
      },
      () => {
        if (
          cancelled ||
          requestId !== cangyuanAvailabilityRequestRef.current
        )
          return;
        setCangyuanAvailabilityState("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    activeMarketplaceConnection,
    activeSupplierKey,
    cangyuanAvailabilityRefresh,
    open,
  ]);

  useEffect(() => {
    if (!open) return;
    const targets = connections.filter(
      (connection) =>
        providerConnectionSupplierKey(connection) === "weai" &&
        connection.apiKeyUsable,
    );
    if (targets.length === 0) return;
    // Settings initialization is read-only. A user-triggered refresh button
    // is the only path that may scan a supplier key and persist availability.
    setWeAiModelScans((current) => {
      const next = { ...current };
      for (const connection of targets)
        next[connection.id] = savedWeAiModelScanState(connection) ??
          current[connection.id] ?? { status: "loading", items: [] };
      return next;
    });
  }, [connections, open]);

  function selectConnection(selected: ProviderConnectionView) {
    const supplierKey = providerConnectionSupplierKey(selected);
    // Every branch below may replace this with a supplier-specific connector.
    // Reset first so a connector-less connection can never inherit JSON from
    // the connection selected immediately before it.
    setConnectorJson(JSON.stringify(defaultRestConfig.connector, null, 2));
    if (supplierKey === "weai" && selected.config.customGroup !== true) {
      const configuredGroup = providerConnectionGroup(selected);
      const group: WeAiGroupId = isWeAiGroupId(configuredGroup)
        ? configuredGroup
        : WEAI_CODEX_TOKEN_GROUP;
      const catalog = weAiCatalogGroup(group);
      const configuredDefault =
        typeof selected.config.defaultModel === "string"
          ? selected.config.defaultModel.trim()
          : "";
      const nextModel = catalog
        ? resolveWeAiDefaultModel(catalog, configuredDefault)
        : "";
      setSelectedId(selected.id);
      setCreatingNew(false);
      setSelectedSupplierKey("weai");
      setSelectedWeAiGroup(group);
      setSelectedWeAiModel(nextModel);
      if (catalog) {
        setSelectedWeAiProtocol(
          resolveWeAiProtocol(catalog, selected.config.protocol),
        );
      }
      setName(selected.name);
      setProvider("weai");
      setPresetId(null);
      setApiKey("");
      setEditingWeAiKey(false);
      setPreservedConfig(selected.config);
      setBaseUrl(
        typeof selected.config.baseUrl === "string"
          ? selected.config.baseUrl
          : WEAI_BASE_URL,
      );
      setDefaultModel(nextModel);
      setCangyuanModels([]);
      setMessage(
        configuredDefault && configuredDefault !== nextModel
          ? `旧默认模型 ${configuredDefault} 不在专属路由可调用名单，已自动改为 ${nextModel}。`
          : null,
      );
      return;
    }
    if (
      supplierKey === MIKOTO_SUPPLIER_KEY &&
      isMikotoGroupId(providerConnectionGroup(selected))
    ) {
      const configuredGroup = providerConnectionGroup(selected);
      const groupId = isMikotoGroupId(configuredGroup)
        ? configuredGroup
        : MIKOTO_IMAGE_1K_GROUP;
      const group = mikotoGroup(groupId)!;
      const configuredDefault =
        typeof selected.config.defaultModel === "string"
          ? selected.config.defaultModel.trim()
          : "";
      const nextModel = group.models.some(
        (model) => model.id === configuredDefault,
      )
        ? configuredDefault
        : group.defaultModel;
      setSelectedId(selected.id);
      setCreatingNew(false);
      setSelectedSupplierKey(MIKOTO_SUPPLIER_KEY);
      setSelectedMikotoGroup(groupId);
      setSelectedMikotoModel(nextModel);
      setName(selected.name);
      setProvider(selected.provider);
      setPresetId(MIKOTO_PRESET_ID);
      setApiKey("");
      setEditingMikotoKey(false);
      setPreservedConfig(selected.config);
      setBaseUrl(
        typeof selected.config.baseUrl === "string"
          ? selected.config.baseUrl
          : MIKOTO_BASE_URL,
      );
      setDefaultModel(nextModel);
      if (selected.config.connector)
        setConnectorJson(JSON.stringify(selected.config.connector, null, 2));
      setCangyuanModels([]);
      setMessage(
        configuredDefault && configuredDefault !== nextModel
          ? `旧默认模型 ${configuredDefault} 不在 ${group.label} 分组，已自动改为 ${nextModel}。`
          : null,
      );
      return;
    }
    const cangyuanPreset = isCangyuanImagePreset(selected.config.preset);
    const cyberAfeiPreset = selected.config.preset === CYBERAFEI_PRESET_ID;
    const mikotoPreset = isMikotoPreset(selected.config.preset);
    const miaowuPreset = isMiaowuPreset(selected.config.preset);
    const friModelPreset = isFriModelPreset(selected.config.preset);
    const chentuPreset = isChentuPreset(selected.config.preset);
    const configuredGroup =
      typeof selected.config.modelGroup === "string" &&
      selected.config.modelGroup.trim()
        ? selected.config.modelGroup.trim()
        : selected.name.includes("备用")
          ? CANGYUAN_BACKUP_IMAGE_GROUP
          : CANGYUAN_IMAGE_GROUP;
    const normalizedConfiguredGroup =
      normalizeCangyuanImageGroup(configuredGroup);
    const runtimeGroup = normalizedConfiguredGroup ?? CANGYUAN_IMAGE_GROUP;
    setSelectedId(selected.id);
    setCreatingNew(false);
    setSelectedSupplierKey(providerConnectionSupplierKey(selected));
    setName(selected.name);
    setProvider(selected.provider);
    setPresetId(
      cangyuanPreset
        ? CANGYUAN_IMAGE_PRESET_ID
        : cyberAfeiPreset
          ? CYBERAFEI_PRESET_ID
          : mikotoPreset
            ? MIKOTO_PRESET_ID
            : miaowuPreset
              ? MIAOWU_PRESET_ID
              : friModelPreset
                ? FRIMODEL_PRESET_ID
                : chentuPreset
                  ? CHENTU_PRESET_ID
                  : null,
    );
    setModelGroup(runtimeGroup);
    setSelectedMarketplaceGroup(
      cangyuanPreset ? runtimeGroup : configuredGroup,
    );
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
    if (cyberAfeiPreset) {
      setSelectedMarketplaceGroup(configuredGroup);
      if (selected.config.usage === "agent") {
        setCyberAfeiModels([]);
        setSelectedMarketplaceModel(configuredDefault ?? "");
      } else {
        // Never render the saved connector as a current inventory. The keyed
        // server scan below is authoritative, including a successful empty
        // result or a failure that must hide old models.
        setCyberAfeiModels([]);
        setSelectedMarketplaceModel(configuredDefault ?? "");
        void refreshCyberAfeiGroup(
          configuredGroup,
          configuredDefault,
          selected,
        );
      }
      setEditingCyberAfeiKey(false);
    } else if (cangyuanPreset && normalizedConfiguredGroup) {
      const configuredConnector = selected.config.connector;
      const configuredModels =
        configuredConnector &&
        typeof configuredConnector === "object" &&
        !Array.isArray(configuredConnector) &&
        Array.isArray((configuredConnector as Record<string, unknown>).models)
          ? ((configuredConnector as Record<string, unknown>)
              .models as ModelDescriptor[])
          : [
              ...(cangyuanImageConnectorForGroup(normalizedConfiguredGroup)
                .models ?? []),
            ];
      applyCangyuanGroup(
        normalizedConfiguredGroup,
        configuredModels,
        configuredDefault,
      );
      setSelectedMarketplaceModel(
        configuredDefault ?? configuredModels[0]?.id ?? "",
      );
    } else if (cangyuanPreset) {
      setCangyuanModels([]);
      setSelectedMarketplaceModel(configuredDefault ?? "");
    } else if (mikotoPreset) {
      setCangyuanModels([]);
      setDefaultModel(configuredDefault ?? MIKOTO_DEFAULT_MODEL);
      setConnectorJson(
        JSON.stringify(selected.config.connector ?? MIKOTO_CONNECTOR, null, 2),
      );
    } else if (miaowuPreset) {
      setCangyuanModels([]);
      setDefaultModel(configuredDefault ?? MIAOWU_DEFAULT_MODEL);
      setConnectorJson(
        JSON.stringify(selected.config.connector ?? MIAOWU_CONNECTOR, null, 2),
      );
    } else if (friModelPreset) {
      setCangyuanModels([]);
      const nextDefault =
        configuredDefault ?? friModelDefaultModelForGroup(configuredGroup);
      setDefaultModel(nextDefault);
      setSelectedMarketplaceModel(nextDefault);
      setMessage(
        "使用“测试连接”实时扫描当前 Key 可用的图片模型；不会发起付费生成请求。",
      );
    } else if (chentuPreset) {
      setCangyuanModels([]);
      setChentuModels([]);
      const nextDefault =
        configuredDefault ?? chentuDefaultModelForGroup(configuredGroup);
      setDefaultModel(nextDefault);
      setSelectedMarketplaceModel(nextDefault);
      void refreshChentuGroup(configuredGroup, configuredDefault, selected);
      setMessage(null);
    } else if (selected.config.connector) {
      setConnectorJson(JSON.stringify(selected.config.connector, null, 2));
    } else {
      setConnectorJson(JSON.stringify(defaultRestConfig.connector, null, 2));
    }
    if (selected.config.customGroup === true) {
      setCustomGroupName(configuredGroup);
      setCustomModels([]);
      if (selected.apiKeyUsable) loadCustomModels(selected.id);
    }
  }

  function selectWeAiGroup(groupId: string) {
    if (!isWeAiGroupId(groupId)) return;
    const group = weAiCatalogGroup(groupId);
    if (!group) return;
    const connection = connections.find(
      (item) =>
        providerConnectionSupplierKey(item) === "weai" &&
        providerConnectionGroup(item) === groupId,
    );
    const configuredDefault =
      typeof connection?.config.defaultModel === "string"
        ? connection.config.defaultModel.trim()
        : "";
    const nextModel = resolveWeAiDefaultModel(group, configuredDefault);
    const nextProtocol = resolveWeAiProtocol(
      group,
      connection?.config.protocol,
    );
    setSelectedSupplierKey("weai");
    setSelectedWeAiGroup(groupId);
    setSelectedWeAiModel(nextModel);
    setSelectedWeAiProtocol(nextProtocol);
    setDefaultModel(nextModel);
    setMessage(null);
    if (connection) {
      selectConnection(connection);
      return;
    }
    setSelectedId(null);
    setCreatingNew(false);
    setName(`We-AI · ${groupId}`);
    setProvider("weai");
    setPresetId(null);
    setApiKey("");
    setEditingWeAiKey(false);
    setBaseUrl(WEAI_BASE_URL);
    setDefaultModel(group.defaultModel);
    setPreservedConfig({
      usage: "canvas",
      modelGroup: groupId,
      protocol: nextProtocol,
    });
    setCangyuanModels([]);
  }

  function selectMikotoGroup(groupId: string) {
    if (!isMikotoGroupId(groupId)) return;
    const group = mikotoGroup(groupId);
    if (!group) return;
    const connection = connections.find(
      (item) =>
        providerConnectionSupplierKey(item) === MIKOTO_SUPPLIER_KEY &&
        providerConnectionGroup(item) === groupId &&
        providerConnectionUsage(item) === "canvas",
    );
    const configuredDefault =
      typeof connection?.config.defaultModel === "string"
        ? connection.config.defaultModel.trim()
        : "";
    const nextModel = group.models.some(
      (model) => model.id === configuredDefault,
    )
      ? configuredDefault
      : group.defaultModel;
    setSelectedSupplierKey(MIKOTO_SUPPLIER_KEY);
    setSelectedMikotoGroup(groupId);
    setSelectedMikotoModel(nextModel);
    setDefaultModel(nextModel);
    setMessage(null);
    if (connection) {
      selectConnection(connection);
      return;
    }
    setSelectedId(null);
    setCreatingNew(false);
    setName(`MikotoPro · ${group.label}`);
    setProvider(group.provider);
    setPresetId(MIKOTO_PRESET_ID);
    setApiKey("");
    setEditingMikotoKey(false);
    setBaseUrl(MIKOTO_BASE_URL);
    setDefaultModel(group.defaultModel);
    const config = mikotoConnectionConfig(groupId);
    if ("connector" in config && config.connector)
      setConnectorJson(JSON.stringify(config.connector, null, 2));
    setPreservedConfig({
      supplierKey: MIKOTO_SUPPLIER_KEY,
      usage: "canvas",
      modelGroup: groupId,
      ...(group.protocol ? { protocol: group.protocol } : {}),
    });
    setCangyuanModels([]);
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
    const connection = findProviderGroupConnection(
      connections,
      "cangyuan",
      groupId,
      usage,
    );
    if (connection) {
      selectConnection(connection);
      // Keep the clicked marketplace group authoritative. Older connection
      // records can carry a stale preset/runtime group that must not undo the
      // user's selection after the group button has already matched its key.
      setSelectedSupplierKey("cangyuan");
      setSelectedMarketplaceGroup(groupId);
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

  function selectCyberAfeiMarketplaceGroup(groupId: string) {
    const marketplaceGroup = cyberAfeiGroups.find(
      (group) => group.id === groupId,
    );
    if (!marketplaceGroup) return;
    const usage = cangyuanGroupUsage(marketplaceGroup);
    setSelectedSupplierKey(CYBERAFEI_SUPPLIER_KEY);
    setSelectedMarketplaceGroup(groupId);
    setSelectedMarketplaceModel(
      marketplaceGroup.models.find(
        (model) =>
          model.id === cyberAfeiDefaultModelForGroup(groupId, cyberAfeiModels),
      )?.id ??
        marketplaceGroup.models[0]?.id ??
        "",
    );
    const connection = connections.find(
      (item) =>
        providerConnectionSupplierKey(item) === CYBERAFEI_SUPPLIER_KEY &&
        providerConnectionGroup(item) === groupId,
    );
    if (connection) {
      selectConnection(connection);
      setSelectedSupplierKey(CYBERAFEI_SUPPLIER_KEY);
      setSelectedMarketplaceGroup(groupId);
      return;
    }
    setSelectedId(null);
    setCreatingNew(marketplaceGroup.canvasSupported || usage === "agent");
    setApiKey("");
    setEditingCyberAfeiKey(false);
    setMessage(null);
    setPresetId(CYBERAFEI_PRESET_ID);
    setProvider("rest");
    setBaseUrl(usage === "agent" ? CYBERAFEI_API_BASE_URL : CYBERAFEI_BASE_URL);
    setName(`赛博阿飞 API · ${groupId}${usage === "agent" ? " · 导演台" : ""}`);
    setPreservedConfig({
      supplierKey: CYBERAFEI_SUPPLIER_KEY,
      usage,
      modelGroup: groupId,
    });
    const chatModel = marketplaceGroup.models.find(
      (model) => model.capability === "chat",
    );
    if (usage === "agent") {
      setCyberAfeiModels([]);
      setDefaultModel(chatModel?.id ?? "");
      return;
    }
    setCyberAfeiModels([]);
    setDefaultModel("");
  }

  function selectFriModelMarketplaceGroup(groupId: string) {
    const marketplaceGroup = friModelMarketplaceGroup(groupId);
    if (!marketplaceGroup) return;
    setSelectedSupplierKey(FRIMODEL_SUPPLIER_KEY);
    setSelectedMarketplaceGroup(groupId);
    setSelectedMarketplaceModel(
      marketplaceGroup.models[0]?.id ?? friModelDefaultModelForGroup(groupId),
    );
    const connection = connections.find(
      (item) =>
        providerConnectionSupplierKey(item) === FRIMODEL_SUPPLIER_KEY &&
        providerConnectionGroup(item) === groupId &&
        providerConnectionUsage(item) === "canvas",
    );
    if (connection) {
      selectConnection(connection);
      setSelectedSupplierKey(FRIMODEL_SUPPLIER_KEY);
      setSelectedMarketplaceGroup(groupId);
      return;
    }
    setSelectedId(null);
    setCreatingNew(marketplaceGroup.canvasSupported);
    setApiKey("");
    setEditingCangyuanKey(false);
    setCangyuanModels([]);
    setMessage(null);
    setPresetId(FRIMODEL_PRESET_ID);
    setProvider("openai");
    setName(`FriModel · ${groupId}`);
    setBaseUrl(FRIMODEL_BASE_URL);
    setDefaultModel(friModelDefaultModelForGroup(groupId));
    setPreservedConfig(friModelConnectionConfig(groupId));
  }

  function selectChentuMarketplaceGroup(groupId: string) {
    const marketplaceGroup =
      effectiveChentuGroups.find((group) => group.id === groupId) ??
      chentuMarketplaceGroup(groupId);
    if (!marketplaceGroup) return;
    setSelectedSupplierKey(CHENTU_SUPPLIER_KEY);
    setSelectedMarketplaceGroup(groupId);
    setSelectedMarketplaceModel(
      marketplaceGroup.models[0]?.id ?? chentuDefaultModelForGroup(groupId),
    );
    const connection = connections.find(
      (item) =>
        providerConnectionSupplierKey(item) === CHENTU_SUPPLIER_KEY &&
        providerConnectionGroup(item) === groupId,
    );
    if (connection) {
      selectConnection(connection);
      setSelectedSupplierKey(CHENTU_SUPPLIER_KEY);
      setSelectedMarketplaceGroup(groupId);
      return;
    }
    setSelectedId(null);
    setCreatingNew(true);
    setApiKey("");
    setEditingCangyuanKey(false);
    setCangyuanModels([]);
    setChentuModels([]);
    setMessage(null);
    setPresetId(CHENTU_PRESET_ID);
    setProvider("openai");
    setName(`辰途 API · ${groupId}`);
    setBaseUrl(CHENTU_BASE_URL);
    setDefaultModel(
      marketplaceGroup.models[0]?.id ?? chentuDefaultModelForGroup(groupId),
    );
    setPreservedConfig(chentuConnectionConfig(groupId));
  }

  function selectMiaowuMarketplaceGroup(groupId: string) {
    const marketplaceGroup = miaowuGroups.find((group) => group.id === groupId);
    if (!marketplaceGroup) return;
    const firstModel = marketplaceGroup.models[0]?.id ?? MIAOWU_DEFAULT_MODEL;
    setSelectedSupplierKey(MIAOWU_SUPPLIER_KEY);
    setSelectedMarketplaceGroup(groupId);
    setSelectedMarketplaceModel(firstModel);
    const connection = connections.find(
      (item) =>
        providerConnectionSupplierKey(item) === MIAOWU_SUPPLIER_KEY &&
        providerConnectionGroup(item) === groupId,
    );
    if (connection) {
      selectConnection(connection);
      setSelectedSupplierKey(MIAOWU_SUPPLIER_KEY);
      setSelectedMarketplaceGroup(groupId);
      void refreshMiaowuGroup(
        groupId,
        typeof connection.config.defaultModel === "string"
          ? connection.config.defaultModel
          : undefined,
        connection,
      );
      return;
    }
    setSelectedId(null);
    setCreatingNew(true);
    setApiKey("");
    setEditingCangyuanKey(false);
    setMiaowuModels([]);
    setMessage(null);
    setPresetId(MIAOWU_PRESET_ID);
    setProvider("rest");
    setName(`喵呜 API · ${groupId}`);
    setBaseUrl(MIAOWU_BASE_URL);
    setDefaultModel(firstModel);
    setPreservedConfig(miaowuConnectionConfig(groupId, firstModel));
    void refreshMiaowuGroup(groupId, firstModel);
  }

  function applyCangyuanPreset() {
    const nextGroup = CANGYUAN_ALL_MODELS_GROUP;
    setPresetId(CANGYUAN_IMAGE_PRESET_ID);
    setSelectedSupplierKey("cangyuan");
    setProvider("rest");
    setName("沧元算力图像 API");
    setSelectedMarketplaceGroup(nextGroup);
    setBaseUrl(CANGYUAN_IMAGE_BASE_URL);
    setPreservedConfig({});
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
    setCustomGroupName("");
    setCustomModels([]);
    const builtInSupplier = [
      "openai",
      MIKOTO_SUPPLIER_KEY,
      MIAOWU_SUPPLIER_KEY,
      FRIMODEL_SUPPLIER_KEY,
      CHENTU_SUPPLIER_KEY,
      "weai",
      CYBERAFEI_SUPPLIER_KEY,
      "runway",
      "rest",
      "fake",
    ].includes(supplierKey);
    setPreservedConfig(supplierKey && !builtInSupplier ? { supplierKey } : {});
    setConnectorJson(JSON.stringify(defaultRestConfig.connector, null, 2));
    setMessage(null);

    if (supplierKey === "cangyuan") {
      applyCangyuanPreset();
      return;
    }

    if (supplierKey === CYBERAFEI_SUPPLIER_KEY) {
      const group =
        cyberAfeiGroups.find((item) => item.id === selectedMarketplaceGroup) ??
        cyberAfeiGroups[0];
      if (group) {
        selectCyberAfeiMarketplaceGroup(group.id);
      } else {
        setPresetId(CYBERAFEI_PRESET_ID);
        setProvider("rest");
        setName("赛博阿飞 API");
        setBaseUrl(CYBERAFEI_BASE_URL);
        setPreservedConfig({
          supplierKey: CYBERAFEI_SUPPLIER_KEY,
          usage: "canvas",
        });
      }
      return;
    }

    if (supplierKey === MIKOTO_SUPPLIER_KEY) {
      applyMikotoPreset();
      return;
    }

    if (supplierKey === MIAOWU_SUPPLIER_KEY) {
      applyMiaowuPreset();
      return;
    }

    if (supplierKey === FRIMODEL_SUPPLIER_KEY) {
      startNewFriModelConnection();
      return;
    }

    if (supplierKey === CHENTU_SUPPLIER_KEY) {
      startNewChentuConnection();
      return;
    }

    if (supplierKey === "weai") {
      const group =
        weAiCatalogGroup(selectedWeAiGroup) ??
        weAiCatalogGroup(WEAI_CODEX_TOKEN_GROUP)!;
      setProvider("weai");
      setPresetId(null);
      setSelectedWeAiGroup(group.id);
      setSelectedWeAiModel(group.defaultModel);
      setSelectedWeAiProtocol(group.protocol);
      setName(`We-AI · ${group.id}`);
      setBaseUrl(WEAI_BASE_URL);
      setDefaultModel(group.defaultModel);
      setPreservedConfig({
        usage: "canvas",
        modelGroup: group.id,
        protocol: group.protocol,
      });
      return;
    }

    const nextProvider = builtInSupplier
      ? supplierKey
      : (connections.find(
          (connection) =>
            providerConnectionSupplierKey(connection) === supplierKey,
        )?.provider ?? "openai");
    setPresetId(null);
    setProvider(nextProvider);
    setModelGroup(CANGYUAN_IMAGE_GROUP);
    setCangyuanModels([]);
    if (nextProvider === "weai") {
      setBaseUrl(WEAI_IMAGE_BASE_URL);
      setDefaultModel(WEAI_IMAGE_DEFAULT_MODEL);
    }
    setName(
      nextProvider === "runway"
        ? "Runway 视频"
        : nextProvider === "weai"
          ? "We-AI 图片"
          : nextProvider === "rest"
            ? "自定义 REST"
            : nextProvider === "fake"
              ? "Fake 演示连接"
              : "OpenAI 图片",
    );
  }

  function startNewCustomGroupConnection(supplierKey = activeSupplierKey) {
    const existing = connections.find(
      (connection) => providerConnectionSupplierKey(connection) === supplierKey,
    );
    const fallbackBaseUrl: Record<string, string> = {
      cangyuan: CANGYUAN_IMAGE_BASE_URL,
      [CYBERAFEI_SUPPLIER_KEY]: CYBERAFEI_API_BASE_URL,
      [FRIMODEL_SUPPLIER_KEY]: FRIMODEL_BASE_URL,
      [CHENTU_SUPPLIER_KEY]: CHENTU_BASE_URL,
      [MIKOTO_SUPPLIER_KEY]: MIKOTO_BASE_URL,
      [MIAOWU_SUPPLIER_KEY]: MIAOWU_BASE_URL,
      weai: WEAI_BASE_URL,
      openai: "https://api.openai.com/v1",
    };
    setSelectedId(null);
    setCreatingNew(true);
    setSelectedSupplierKey(supplierKey);
    setPresetId(null);
    setProvider(
      supplierKey === "runway"
        ? "runway"
        : supplierKey === "fake"
          ? "fake"
          : "openai",
    );
    setName(`${providerSupplierLabel(supplierKey)} · 自定义分组`);
    setCustomGroupName("自定义分组");
    setBaseUrl(
      typeof existing?.config.baseUrl === "string"
        ? existing.config.baseUrl
        : (fallbackBaseUrl[supplierKey] ?? ""),
    );
    setApiKey("");
    setDefaultModel("");
    setCustomModels([]);
    setPreservedConfig({
      supplierKey,
      usage: "canvas",
      customGroup: true,
      modelGroup: "自定义分组",
    });
    setConnectorJson(JSON.stringify(defaultRestConfig.connector, null, 2));
    setMessage(null);
  }

  function loadCustomModels(connectionId: string) {
    const requestId = ++customModelsRequestRef.current;
    setCustomModelsLoading(true);
    void fetchModels(connectionId).then(
      (items) => {
        if (requestId !== customModelsRequestRef.current) return;
        setCustomModels(items);
        setCustomModelsLoading(false);
        if (!defaultModel && items[0]) setDefaultModel(items[0].id);
      },
      (error: unknown) => {
        if (requestId !== customModelsRequestRef.current) return;
        setCustomModels([]);
        setCustomModelsLoading(false);
        setMessage(error instanceof Error ? error.message : "模型列表读取失败");
      },
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
      const preservedModelGroup =
        typeof preservedConfig.modelGroup === "string" &&
        preservedConfig.modelGroup.trim()
          ? preservedConfig.modelGroup.trim()
          : "";
      const savedDefaultModel =
        provider === "weai" && activeWeAiGroup
          ? resolveWeAiDefaultModel(activeWeAiGroup, defaultModel)
          : defaultModel.trim();
      const savedWeAiProtocol = activeWeAiGroup
        ? resolveWeAiProtocol(activeWeAiGroup, selectedWeAiProtocol)
        : undefined;
      const saved = await saveConnection({
        id: selectedId ?? undefined,
        name,
        provider,
        apiKey: apiKey || undefined,
        config: {
          ...remainingConfig,
          ...(baseUrl ? { baseUrl } : {}),
          ...(savedDefaultModel ? { defaultModel: savedDefaultModel } : {}),
          ...(presetId ? { preset: presetId } : {}),
          ...(presetId === CANGYUAN_IMAGE_PRESET_ID
            ? { modelGroup }
            : presetId === CYBERAFEI_PRESET_ID
              ? {
                  supplierKey: CYBERAFEI_SUPPLIER_KEY,
                  modelGroup: selectedMarketplaceGroup,
                  usage: preservedConfig.usage === "agent" ? "agent" : "canvas",
                  requestTimeoutMs: 300_000,
                }
              : provider === "weai"
                ? {
                    modelGroup: selectedWeAiGroup,
                    protocol: savedWeAiProtocol,
                    usage: "canvas",
                  }
                : preservedModelGroup
                  ? {
                      modelGroup: preservedModelGroup,
                      ...(preservedConfig.customGroup === true
                        ? { customGroup: true }
                        : {}),
                    }
                  : {}),
          ...(connector ? { connector } : {}),
        },
      });
      setSelectedId(saved.id);
      setCreatingNew(false);
      setSelectedSupplierKey(providerConnectionSupplierKey(saved));
      if (presetId === CANGYUAN_IMAGE_PRESET_ID)
        setSelectedMarketplaceGroup(modelGroup);
      if (presetId === CYBERAFEI_PRESET_ID)
        setSelectedMarketplaceGroup(selectedMarketplaceGroup);
      setPreservedConfig(saved.config);
      setApiKey("");
      setEditingCangyuanKey(false);
      setEditingCyberAfeiKey(false);
      setEditingWeAiKey(false);
      await reload();
      setMessage("连接已加密保存");
      if (saved.config.customGroup === true) loadCustomModels(saved.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleConnectWeAiGroup(groupId: WeAiGroupId) {
    const group = weAiCatalogGroup(groupId);
    if (!group) return;
    setBusy(true);
    setMessage(null);
    try {
      const existing = connections.find(
        (connection) =>
          providerConnectionSupplierKey(connection) === "weai" &&
          providerConnectionGroup(connection) === groupId,
      );
      const configuredDefault =
        typeof existing?.config.defaultModel === "string"
          ? existing.config.defaultModel.trim()
          : "";
      const requestedDefault =
        defaultModel.trim() || configuredDefault || selectedWeAiModel.trim();
      const existingScan = existing ? weAiModelScans[existing.id] : undefined;
      const liveIds = new Set(
        existingScan?.status === "ready"
          ? existingScan.items.map((model) => model.id)
          : [],
      );
      const liveCallableModels =
        existingScan?.status === "ready"
          ? group.models.filter(
              (model) => model.canvasCallable && liveIds.has(model.id),
            )
          : [];
      const nextDefaultModel =
        liveCallableModels.find((model) => model.id === requestedDefault)?.id ??
        liveCallableModels[0]?.id ??
        resolveWeAiDefaultModel(group, requestedDefault);
      const nextProtocol = resolveWeAiProtocol(
        group,
        selectedWeAiProtocol || existing?.config.protocol,
      );
      const saved = await saveConnection({
        id: existing?.id,
        name: existing?.name ?? `We-AI · ${groupId}`,
        provider: "weai",
        apiKey: apiKey || undefined,
        config: {
          ...(existing?.config ?? {}),
          supplierKey: "weai",
          usage: "canvas",
          modelGroup: groupId,
          protocol: nextProtocol,
          baseUrl: WEAI_BASE_URL,
          defaultModel: nextDefaultModel,
          catalogCapturedAt: WEAI_CATALOG_CAPTURED_AT,
        },
      });
      setApiKey("");
      setEditingWeAiKey(false);
      await reload();
      selectConnection(saved);
      setMessage(
        apiKey
          ? `${groupId} 分组 API Key 已独立加密保存`
          : existing
            ? `${groupId} 分组已更新`
            : `${groupId} 分组已接入画布`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We-AI 分组接入失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshWeAiModels(connection: ProviderConnectionView) {
    setBusy(true);
    setMessage("正在重新扫描当前 We-AI 分组；临时失败会保留上次可用模型。");
    try {
      const items = await refreshModels(connection.id, {
        clearUnavailable: true,
      });
      setWeAiModelScans((current) => ({
        ...current,
        [connection.id]: { status: "ready", items },
      }));
      await reload();
      setMessage(
        items.length > 0
          ? `重新扫描完成：当前分组可用 ${items.length} 个画布模型。`
          : "重新扫描完成：当前分组没有可用画布模型，旧模型已隐藏。",
      );
    } catch (error) {
      setWeAiModelScans((current) => ({
        ...current,
        [connection.id]: {
          status: "error",
          items: current[connection.id]?.items ?? [],
          message:
            error instanceof Error
              ? `${error.message}；已保留上次可用模型`
              : "We-AI 模型扫描失败，已保留上次可用模型",
        },
      }));
      await reload().catch(() => undefined);
      setMessage(
        `${error instanceof Error ? error.message : "We-AI 模型扫描失败"}；已保留上次可用模型，请稍后重试。`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleConnectMikotoGroup(groupId: MikotoGroupId) {
    const group = mikotoGroup(groupId);
    if (!group) return;
    setBusy(true);
    setMessage(null);
    try {
      const existing = connections.find(
        (connection) =>
          providerConnectionSupplierKey(connection) === MIKOTO_SUPPLIER_KEY &&
          providerConnectionGroup(connection) === groupId &&
          providerConnectionUsage(connection) === "canvas",
      );
      const configuredDefault =
        typeof existing?.config.defaultModel === "string"
          ? existing.config.defaultModel.trim()
          : "";
      const requestedDefault =
        defaultModel.trim() || configuredDefault || group.defaultModel;
      const nextDefaultModel = group.models.some(
        (model) => model.id === requestedDefault,
      )
        ? requestedDefault
        : group.defaultModel;
      const saved = await saveConnection({
        id: existing?.id,
        name: existing?.name ?? `MikotoPro · ${group.label}`,
        provider: group.provider,
        apiKey: apiKey || undefined,
        config: {
          ...(existing?.config ?? {}),
          ...mikotoConnectionConfig(groupId),
          supplierKey: MIKOTO_SUPPLIER_KEY,
          usage: "canvas",
          modelGroup: groupId,
          baseUrl: MIKOTO_BASE_URL,
          defaultModel: nextDefaultModel,
          ...(group.protocol ? { protocol: group.protocol } : {}),
          ...(group.provider === "rest"
            ? { connector: mikotoConnectorForGroup(groupId) }
            : {}),
        },
      });
      setApiKey("");
      setEditingMikotoKey(false);
      await reload();
      selectConnection(saved);
      setMessage(
        apiKey
          ? `${group.label} API Key 已独立加密保存`
          : existing
            ? `${group.label} 已更新`
            : `${group.label} 已接入 MikotoPro`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "MikotoPro 分组接入失败",
      );
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
      const existing = findProviderGroupConnection(
        connections,
        "cangyuan",
        groupId,
        "agent",
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
          allowedModels: chatModels.map((model) => model.id),
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

  async function handleConnectCyberAfeiGroup(groupId: string) {
    const marketplaceGroup = cyberAfeiGroups.find(
      (group) => group.id === groupId,
    );
    if (!marketplaceGroup || !marketplaceGroup.canvasSupported) {
      setMessage("当前赛博阿飞分组没有可接入画布的图片或视频模型");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const existing = connections.find(
        (connection) =>
          providerConnectionSupplierKey(connection) ===
            CYBERAFEI_SUPPLIER_KEY &&
          providerConnectionGroup(connection) === groupId,
      );
      const configuredDefault =
        defaultModel.trim() ||
        (typeof existing?.config.defaultModel === "string"
          ? existing.config.defaultModel
          : "");
      const saved = await saveConnection({
        id: existing?.id,
        name: existing?.name ?? `赛博阿飞 API · ${groupId}`,
        provider: "rest",
        apiKey: apiKey || undefined,
        config: {
          ...(existing?.config ?? {}),
          preset: CYBERAFEI_PRESET_ID,
          supplierKey: CYBERAFEI_SUPPLIER_KEY,
          usage: "canvas",
          modelGroup: groupId,
          baseUrl: CYBERAFEI_BASE_URL,
          defaultModel: configuredDefault,
          requestTimeoutMs: 300_000,
        },
      });
      setApiKey("");
      setEditingCyberAfeiKey(false);
      await reload();
      selectConnection(saved);
      const scannedCount = Array.isArray(saved.config.scannedModelIds)
        ? saved.config.scannedModelIds.length
        : 0;
      const scanSucceeded =
        saved.config.modelScanStatus === "live" ||
        saved.config.modelScanStatus === "empty";
      setMessage(
        scanSucceeded
          ? `${groupId} 分组 Key 已独立加密保存，本次实时扫描到 ${scannedCount} 个模型`
          : apiKey
            ? `${groupId} 分组 Key 已加密保存；实时扫描暂未成功，旧模型不会显示或提交`
            : existing
              ? `${groupId} 分组已更新`
              : `${groupId} 已接入赛博阿飞画布`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "赛博阿飞分组接入失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleConnectMiaowuGroup(groupId: string) {
    const marketplaceGroup = miaowuGroups.find((group) => group.id === groupId);
    if (!marketplaceGroup) {
      setMessage("当前喵呜实时目录中没有这个分组");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const suppliedKey = Boolean(apiKey);
      const existing = connections.find(
        (connection) =>
          providerConnectionSupplierKey(connection) === MIAOWU_SUPPLIER_KEY &&
          providerConnectionGroup(connection) === groupId,
      );
      const requestedDefault =
        defaultModel.trim() ||
        (typeof existing?.config.defaultModel === "string"
          ? existing.config.defaultModel.trim()
          : "");
      const nextDefault = marketplaceGroup.models.some(
        (model) => model.id === requestedDefault,
      )
        ? requestedDefault
        : (marketplaceGroup.models[0]?.id ?? MIAOWU_DEFAULT_MODEL);
      const saved = await saveConnection({
        id: existing?.id,
        name: existing?.name ?? `喵呜 API · ${groupId}`,
        provider: "rest",
        apiKey: apiKey || undefined,
        config: {
          ...(existing?.config ?? {}),
          ...miaowuConnectionConfig(groupId, nextDefault),
        },
      });
      setApiKey("");
      setEditingCangyuanKey(false);
      const scannedModels = saved.apiKeyUsable
        ? await refreshModels(saved.id)
        : [];
      const refreshed = await fetchConnections();
      setConnections(refreshed);
      const current =
        refreshed.find((connection) => connection.id === saved.id) ?? saved;
      selectConnection(current);
      setMiaowuModels(scannedModels.length > 0 ? scannedModels : miaowuModels);
      setSelectedMarketplaceGroup(groupId);
      setSelectedMarketplaceModel(nextDefault);
      setMessage(
        suppliedKey
          ? `${groupId} 分组 API Key 已独立加密保存；实时扫描到 ${scannedModels.length} 个可用模型。`
          : existing
            ? `${groupId} 分组已更新。`
            : `${groupId} 分组已接入画布。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "喵呜分组接入失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleConnectFriModelGroup(groupId: string) {
    const marketplaceGroup = friModelMarketplaceGroup(groupId);
    if (!marketplaceGroup || !marketplaceGroup.canvasSupported) {
      setMessage(
        "该 FriModel 分组尚无已验证的画布图片协议，当前仅展示平台信息。",
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const existing = connections.find(
        (connection) =>
          providerConnectionSupplierKey(connection) === FRIMODEL_SUPPLIER_KEY &&
          providerConnectionGroup(connection) === groupId &&
          providerConnectionUsage(connection) === "canvas",
      );
      const configuredDefault =
        defaultModel.trim() ||
        (typeof existing?.config.defaultModel === "string"
          ? existing.config.defaultModel.trim()
          : "");
      const nextDefault = marketplaceGroup.models.some(
        (model) => model.id === configuredDefault,
      )
        ? configuredDefault
        : friModelDefaultModelForGroup(groupId);
      const saved = await saveConnection({
        id: existing?.id,
        name: existing?.name ?? `FriModel · ${groupId}`,
        provider: "openai",
        apiKey: apiKey || undefined,
        config: {
          ...(existing?.config ?? {}),
          ...friModelConnectionConfig(groupId, nextDefault),
        },
      });
      setApiKey("");
      setEditingCangyuanKey(false);
      await reload();
      selectConnection(saved);
      setMessage(
        apiKey
          ? `${groupId} 分组 API Key 已独立加密保存；点击“测试连接”可实时扫描可用图片模型。`
          : existing
            ? `${groupId} 分组已更新；点击“测试连接”可实时扫描可用图片模型。`
            : `${groupId} 已接入画布；点击“测试连接”可实时扫描可用图片模型。`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "FriModel 分组接入失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleConnectChentuGroup(groupId: string) {
    const marketplaceGroup =
      effectiveChentuGroups.find((group) => group.id === groupId) ??
      chentuMarketplaceGroup(groupId);
    // A failed first /v1/models scan must not remove the setup entry point
    // for a documented Chentu image group. Saving/retesting the connection is
    // safe; actual runs still use the authoritative scan in /api/runs.
    if (
      !marketplaceGroup ||
      (!marketplaceGroup.canvasSupported && !isChentuImageGroup(groupId))
    ) {
      setMessage("该辰途 API 分组尚无已验证的画布生成协议。");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const existing = connections.find(
        (connection) =>
          providerConnectionSupplierKey(connection) === CHENTU_SUPPLIER_KEY &&
          providerConnectionGroup(connection) === groupId &&
          providerConnectionUsage(connection) === "canvas",
      );
      const configuredDefault =
        defaultModel.trim() ||
        (typeof existing?.config.defaultModel === "string"
          ? existing.config.defaultModel.trim()
          : "");
      const nextDefault = marketplaceGroup.models.some(
        (model) => model.id === configuredDefault,
      )
        ? configuredDefault
        : (marketplaceGroup.models.find(
            (model) => model.canvasRunnable !== false,
          )?.id ?? chentuDefaultModelForGroup(groupId));
      const saved = await saveConnection({
        id: existing?.id,
        name: existing?.name ?? `辰途 API · ${groupId}`,
        provider: "openai",
        apiKey: apiKey || undefined,
        config: {
          ...(existing?.config ?? {}),
          ...chentuConnectionConfig(groupId, nextDefault),
        },
      });
      setApiKey("");
      setEditingCangyuanKey(false);
      await reload();
      selectConnection(saved);
      setMessage(
        apiKey
          ? "辰途 API Key 已加密保存；已按当前 Key 实时扫描分组模型与价格。"
          : existing
            ? "辰途 API 连接已更新；已按当前 Key 实时扫描分组模型与价格。"
            : "辰途 API 已接入画布；已按当前 Key 实时扫描分组模型与价格。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "辰途 API 接入失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleConnectChentuAgentGroup(groupId: string) {
    const marketplaceGroup = effectiveChentuGroups.find(
      (group) => group.id === groupId,
    );
    const chatModels =
      marketplaceGroup?.models.filter((model) => model.capability === "chat") ??
      [];
    if (!marketplaceGroup || chatModels.length === 0) {
      setMessage("当前辰途分组没有可接入导演台的对话模型");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const existing = connections.find(
        (connection) =>
          providerConnectionSupplierKey(connection) === CHENTU_SUPPLIER_KEY &&
          providerConnectionGroup(connection) === groupId,
      );
      const configuredDefault =
        typeof existing?.config.defaultModel === "string"
          ? existing.config.defaultModel
          : defaultModel.trim();
      const nextDefault = chatModels.some(
        (model) => model.id === configuredDefault,
      )
        ? configuredDefault
        : chatModels[0]!.id;
      const saved = await saveConnection({
        id: existing?.id,
        name: existing?.name ?? `辰途 API · ${groupId} · 导演台`,
        provider: "openai",
        apiKey: apiKey || undefined,
        config: {
          ...(existing?.config ?? {}),
          preset: CHENTU_PRESET_ID,
          supplierKey: CHENTU_SUPPLIER_KEY,
          usage: "agent",
          modelGroup: groupId,
          baseUrl: CHENTU_BASE_URL,
          defaultModel: nextDefault,
          allowedModels: chatModels.map((model) => model.id),
          catalogSource: chentuCatalogSource,
        },
      });
      setApiKey("");
      setEditingCangyuanKey(false);
      await reload();
      setSelectedId(saved.id);
      setSelectedMarketplaceGroup(groupId);
      setSelectedMarketplaceModel(nextDefault);
      setPreservedConfig(saved.config);
      setMessage(
        apiKey
          ? `${groupId} 导演台 API Key 已独立加密保存`
          : existing
            ? `${groupId} 导演台连接已更新`
            : `${groupId} 已接入辰途导演台`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "辰途导演台接入失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleConnectCyberAfeiAgentGroup(groupId: string) {
    const marketplaceGroup = cyberAfeiGroups.find(
      (group) => group.id === groupId,
    );
    const chatModels =
      marketplaceGroup?.models.filter((model) => model.capability === "chat") ??
      [];
    if (!marketplaceGroup || chatModels.length === 0) {
      setMessage("当前赛博阿飞分组没有可接入导演台的对话模型");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const existing = connections.find(
        (connection) =>
          providerConnectionSupplierKey(connection) ===
            CYBERAFEI_SUPPLIER_KEY &&
          providerConnectionGroup(connection) === groupId,
      );
      const configuredDefault =
        typeof existing?.config.defaultModel === "string"
          ? existing.config.defaultModel
          : defaultModel.trim();
      const nextDefault = chatModels.some(
        (model) => model.id === configuredDefault,
      )
        ? configuredDefault
        : chatModels[0]!.id;
      const saved = await saveConnection({
        id: existing?.id,
        name: existing?.name ?? `赛博阿飞 API · ${groupId} · 导演台`,
        provider: "rest",
        apiKey: apiKey || undefined,
        config: {
          ...(existing?.config ?? {}),
          preset: CYBERAFEI_PRESET_ID,
          supplierKey: CYBERAFEI_SUPPLIER_KEY,
          usage: "agent",
          modelGroup: groupId,
          baseUrl: CYBERAFEI_API_BASE_URL,
          defaultModel: nextDefault,
          allowedModels: chatModels.map((model) => model.id),
          catalogSource: cyberAfeiCatalogSource,
        },
      });
      setApiKey("");
      setEditingCyberAfeiKey(false);
      await reload();
      setSelectedId(saved.id);
      setSelectedMarketplaceGroup(groupId);
      setSelectedMarketplaceModel(nextDefault);
      setPreservedConfig(saved.config);
      setMessage(
        apiKey
          ? `${groupId} 导演台 API Key 已独立加密保存`
          : existing
            ? `${groupId} 导演台连接已更新`
            : `${groupId} 已接入赛博阿飞导演台`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "赛博阿飞导演台接入失败",
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
      const result = await testConnection(connectionId);
      const testedConnection = connections.find(
        (connection) => connection.id === connectionId,
      );
      if (testedConnection?.config.customGroup === true) {
        const items = await refreshModels(connectionId);
        setCustomModels(items);
        if (!defaultModel && items[0]) setDefaultModel(items[0].id);
        setMessage(`${result}；实时扫描到 ${items.length} 个模型。`);
      } else if (
        testedConnection &&
        providerConnectionSupplierKey(testedConnection) === "weai"
      ) {
        setWeAiModelScans((current) => ({
          ...current,
          [connectionId]: { status: "loading", items: [] },
        }));
        const items = await fetchModels(connectionId);
        setWeAiModelScans((current) => ({
          ...current,
          [connectionId]: { status: "ready", items },
        }));
        setMessage(`${result}；实时扫描到 ${items.length} 个可用图片模型`);
      } else if (
        testedConnection &&
        [FRIMODEL_SUPPLIER_KEY, CHENTU_SUPPLIER_KEY].includes(
          providerConnectionSupplierKey(testedConnection),
        )
      ) {
        const items = await refreshModels(connectionId);
        setMessage(
          `${result}；已刷新实时模型列表（${items.length} 个图片模型）。`,
        );
      } else {
        setMessage(result);
      }
    } catch (error) {
      const nextMessage =
        error instanceof Error ? error.message : "连接测试失败";
      const testedConnection = connections.find(
        (connection) => connection.id === connectionId,
      );
      if (
        testedConnection &&
        providerConnectionSupplierKey(testedConnection) === "weai"
      ) {
        setWeAiModelScans((current) => ({
          ...current,
          [connectionId]: {
            status: "error",
            items: [],
            message: nextMessage,
          },
        }));
      } else if (testedConnection?.config.customGroup === true) {
        setCustomModels([]);
      }
      if (nextMessage.includes("无法解密")) {
        if (
          testedConnection &&
          providerConnectionSupplierKey(testedConnection) ===
            CYBERAFEI_SUPPLIER_KEY
        )
          setEditingCyberAfeiKey(true);
        else if (
          testedConnection &&
          providerConnectionSupplierKey(testedConnection) === "weai"
        )
          setEditingWeAiKey(true);
        else setEditingCangyuanKey(true);
      }
      setMessage(nextMessage);
    } finally {
      setBusy(false);
    }
  }

  /**
   * 强制重新拉取当前供应商的模型广场与 Key 扫描结果。哪个模型能用、价格是
   * 多少全部以本次实时结果为准；不发起任何付费生成请求。
   */
  async function handleRefreshMarketplace() {
    setBusy(true);
    setMessage(null);
    try {
      if (activeSupplierKey === "cangyuan") {
        const marketplace = await fetchCangyuanMarketplace({ refresh: true });
        setCangyuanGroups(marketplace.groups);
        setCatalogSource(marketplace.source);
        setCangyuanAvailabilityRefresh((current) => current + 1);
        const normalizedGroup = normalizeCangyuanImageGroup(
          selectedMarketplaceGroup,
        );
        if (normalizedGroup)
          await refreshCangyuanGroup(
            normalizedGroup,
            defaultModel || undefined,
            activeMarketplaceConnection,
            true,
          );
      } else if (activeSupplierKey === CYBERAFEI_SUPPLIER_KEY) {
        const marketplace = await fetchCyberAfeiMarketplace({ refresh: true });
        setCyberAfeiGroups(marketplace.groups);
        setCyberAfeiCatalogSource(marketplace.source);
        await refreshCyberAfeiGroup(
          selectedMarketplaceGroup,
          defaultModel || undefined,
          activeMarketplaceConnection,
        );
      } else if (activeSupplierKey === CHENTU_SUPPLIER_KEY) {
        const marketplace = await fetchChentuMarketplace({ refresh: true });
        if (marketplace.groups.length > 0) {
          setChentuGroups(marketplace.groups);
          setChentuCatalogSource(marketplace.source);
        }
        await refreshChentuGroup(
          selectedMarketplaceGroup,
          defaultModel || undefined,
          activeMarketplaceConnection,
        );
      } else if (activeSupplierKey === MIAOWU_SUPPLIER_KEY) {
        const marketplace = await fetchMiaowuMarketplace({ refresh: true });
        setMiaowuGroups(marketplace.groups);
        setMiaowuCatalogSource(marketplace.source);
        await refreshMiaowuGroup(
          selectedMarketplaceGroup,
          defaultModel || undefined,
          activeMarketplaceConnection,
          true,
        );
      } else if (
        activeSupplierKey === FRIMODEL_SUPPLIER_KEY &&
        activeMarketplaceConnection
      ) {
        const items = await refreshModels(activeMarketplaceConnection.id);
        setMessage(`已实时刷新 FriModel 模型列表（${items.length} 个模型）。`);
      } else if (
        activeSupplierKey === MIKOTO_SUPPLIER_KEY &&
        activeMikotoConnection
      ) {
        const items = await refreshModels(activeMikotoConnection.id);
        const callable = items.filter(
          (model) => model.metadata?.canvasRunnable !== false,
        ).length;
        setMessage(
          `已实时扫描 MikotoPro 分组：${callable} 个可调用模型 / ${items.length} 个已知模型。`,
        );
      }
      await reload();
      setMessage((current) => current ?? "目录已按最新实时数据刷新。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目录刷新失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshAllSuppliers() {
    setBusy(true);
    setMessage(null);
    try {
      const failures: string[] = [];
      const [cangyuan, cyberAfei, chentu, miaowu] = await Promise.all([
        fetchCangyuanMarketplace({ refresh: true }).catch(() => {
          failures.push("沧元");
          return null;
        }),
        fetchCyberAfeiMarketplace({ refresh: true }).catch(() => {
          failures.push("赛博阿飞");
          return null;
        }),
        fetchChentuMarketplace({ refresh: true }).catch(() => {
          failures.push("辰途");
          return null;
        }),
        fetchMiaowuMarketplace({ refresh: true }).catch(() => {
          failures.push("喵呜");
          return null;
        }),
      ]);
      if (cangyuan) {
        setCangyuanGroups(cangyuan.groups);
        setCatalogSource(cangyuan.source);
      }
      if (cyberAfei) {
        setCyberAfeiGroups(cyberAfei.groups);
        setCyberAfeiCatalogSource(cyberAfei.source);
      }
      if (chentu && chentu.groups.length > 0) {
        setChentuGroups(chentu.groups);
        setChentuCatalogSource(chentu.source);
      }
      if (miaowu) {
        setMiaowuGroups(miaowu.groups);
        setMiaowuCatalogSource(miaowu.source);
      }

      const targets = connections.filter(
        (connection) => connection.apiKeyUsable,
      );
      const results = await Promise.all(
        targets.map(async (connection) => {
          try {
            await refreshModels(connection.id);
            return { ok: true as const };
          } catch {
            return {
              ok: false as const,
              label: providerSupplierLabel(
                providerConnectionSupplierKey(connection),
              ),
            };
          }
        }),
      );
      const refreshed = results.filter((result) => result.ok).length;
      failures.push(
        ...results.flatMap((result) => (result.ok ? [] : [result.label])),
      );
      await reload();
      setMessage(
        failures.length > 0
          ? `已刷新 ${refreshed} 个连接；${[...new Set(failures)].join("、")} 刷新失败`
          : `已刷新全部供应商目录与 ${refreshed} 个已配置连接`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "全部供应商刷新失败");
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
          <div className="modal-head-actions">
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
        <div className="settings-layout">
            <aside className="supplier-list" aria-label="API 供应商列表">
              <div className="settings-nav-title">
                <span>API 供应商</span>
                <small>按供应商查看群组</small>
                <button
                  className="button small settings-refresh-all"
                  type="button"
                  onClick={() => void handleRefreshAllSuppliers()}
                  disabled={busy}
                  title="刷新全部供应商目录和已配置连接"
                >
                  <RefreshCw className={busy ? "spin" : ""} size={12} />
                  刷新全部
                </button>
              </div>
              {supplierKeys.map((supplierKey) => {
                const supplierConnections = connections.filter(
                  (connection) =>
                    providerConnectionSupplierKey(connection) === supplierKey,
                );
                const configuredWebsiteUrl = supplierConnections
                  .map(providerConnectionSupplierWebsite)
                  .find((url): url is string => Boolean(url));
                const supplierWebsiteUrl =
                  providerSupplierWebsite(supplierKey) ?? configuredWebsiteUrl;
                return (
                  <div
                    className={`supplier-item-row ${supplierWebsiteUrl ? "has-website" : ""}`}
                    key={supplierKey}
                  >
                    <button
                      type="button"
                      className={`supplier-item ${activeSupplierKey === supplierKey ? "active" : ""}`}
                      onClick={() => {
                        if (supplierKey === "cangyuan") {
                          const nextGroup = cangyuanGroups.some(
                            (group) => group.id === selectedMarketplaceGroup,
                          )
                            ? selectedMarketplaceGroup
                            : cangyuanGroups[0]?.id;
                          selectCangyuanMarketplaceGroup(
                            nextGroup || CANGYUAN_IMAGE_GROUP,
                          );
                          return;
                        }
                        if (supplierKey === CYBERAFEI_SUPPLIER_KEY) {
                          const nextGroup = cyberAfeiGroups.some(
                            (group) => group.id === selectedMarketplaceGroup,
                          )
                            ? selectedMarketplaceGroup
                            : cyberAfeiGroups[0]?.id;
                          selectCyberAfeiMarketplaceGroup(
                            nextGroup || "image-2稳定生图",
                          );
                          return;
                        }
                        if (supplierKey === FRIMODEL_SUPPLIER_KEY) {
                          const nextGroup = FRIMODEL_PLATFORM_GROUPS.some(
                            (group) => group.id === selectedMarketplaceGroup,
                          )
                            ? selectedMarketplaceGroup
                            : FRIMODEL_PLATFORM_GROUPS[0]?.id;
                          if (nextGroup)
                            selectFriModelMarketplaceGroup(nextGroup);
                          return;
                        }
                        if (supplierKey === CHENTU_SUPPLIER_KEY) {
                          const nextGroup = effectiveChentuGroups.some(
                            (group) => group.id === selectedMarketplaceGroup,
                          )
                            ? selectedMarketplaceGroup
                            : effectiveChentuGroups[0]?.id;
                          if (nextGroup)
                            selectChentuMarketplaceGroup(nextGroup);
                          return;
                        }
                        if (supplierKey === MIAOWU_SUPPLIER_KEY) {
                          const nextGroup = miaowuGroups.some(
                            (group) => group.id === selectedMarketplaceGroup,
                          )
                            ? selectedMarketplaceGroup
                            : miaowuGroups[0]?.id;
                          if (nextGroup)
                            selectMiaowuMarketplaceGroup(nextGroup);
                          return;
                        }
                        if (supplierKey === "weai") {
                          selectWeAiGroup(
                            isWeAiGroupId(selectedWeAiGroup)
                              ? selectedWeAiGroup
                              : WEAI_CODEX_TOKEN_GROUP,
                          );
                          return;
                        }
                        if (supplierKey === MIKOTO_SUPPLIER_KEY) {
                          selectMikotoGroup(selectedMikotoGroup);
                          return;
                        }
                        setSelectedSupplierKey(supplierKey);
                        setSelectedId(null);
                        setCreatingNew(false);
                      }}
                    >
                      <span className="provider-dot" />
                      <span>
                        <strong>{providerSupplierLabel(supplierKey)}</strong>
                        <small>
                          {supplierKey === "cangyuan"
                            ? `${cangyuanGroups.length} 个平台分组`
                            : supplierKey === CYBERAFEI_SUPPLIER_KEY
                              ? `${cyberAfeiGroups.length} 个平台分组`
                              : supplierKey === FRIMODEL_SUPPLIER_KEY
                                ? `${FRIMODEL_PLATFORM_GROUPS.length} 个平台分组`
                                : supplierKey === CHENTU_SUPPLIER_KEY
                                  ? `${effectiveChentuGroups.length} 个实时扫描分组`
                                  : supplierKey === "weai"
                                    ? `${WEAI_CATALOG.length} 个平台分组`
                                    : supplierKey === MIKOTO_SUPPLIER_KEY
                                      ? `${MIKOTO_GROUPS.length} 个平台分组`
                                      : supplierKey === MIAOWU_SUPPLIER_KEY
                                        ? `${miaowuGroups.length} 个实时分组 · ${miaowuMarketplaceModelCount} 个模型`
                                        : `${supplierConnections.length} 个已建立群组`}
                        </small>
                      </span>
                    </button>
                    {supplierWebsiteUrl ? (
                      <a
                        className="supplier-website-link"
                        href={supplierWebsiteUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`打开${providerSupplierLabel(supplierKey)}官网`}
                        title={`打开${providerSupplierLabel(supplierKey)}官网`}
                      >
                        <ExternalLink size={13} />
                      </a>
                    ) : null}
                  </div>
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
              {activeSupplierKey === "cangyuan" ||
              activeSupplierKey === CYBERAFEI_SUPPLIER_KEY ||
              activeSupplierKey === FRIMODEL_SUPPLIER_KEY ||
              activeSupplierKey === CHENTU_SUPPLIER_KEY ||
              activeSupplierKey === MIAOWU_SUPPLIER_KEY ? (
                <>
                  {(activeSupplierKey === CYBERAFEI_SUPPLIER_KEY
                    ? cyberAfeiGroups
                    : activeSupplierKey === FRIMODEL_SUPPLIER_KEY
                      ? FRIMODEL_PLATFORM_GROUPS
                      : activeSupplierKey === CHENTU_SUPPLIER_KEY
                        ? effectiveChentuGroups
                        : activeSupplierKey === MIAOWU_SUPPLIER_KEY
                          ? miaowuGroups
                          : cangyuanGroups
                  ).map((group) => {
                    const usage = cangyuanGroupUsage(group);
                    const connection = findProviderGroupConnection(
                      connections,
                      activeSupplierKey,
                      group.id,
                      usage,
                    );
                    return (
                      <button
                        type="button"
                        className={`connection-item ${selectedMarketplaceGroup === group.id ? "active" : ""}`}
                        onClick={() =>
                          activeSupplierKey === CYBERAFEI_SUPPLIER_KEY
                            ? selectCyberAfeiMarketplaceGroup(group.id)
                            : activeSupplierKey === FRIMODEL_SUPPLIER_KEY
                              ? selectFriModelMarketplaceGroup(group.id)
                              : activeSupplierKey === CHENTU_SUPPLIER_KEY
                                ? selectChentuMarketplaceGroup(group.id)
                                : activeSupplierKey === MIAOWU_SUPPLIER_KEY
                                  ? selectMiaowuMarketplaceGroup(group.id)
                                  : selectCangyuanMarketplaceGroup(group.id)
                        }
                        key={group.id}
                      >
                        <span
                          className={`provider-dot ${connection?.apiKeyUsable ? "" : "muted"}`}
                        />
                        <span>
                          <strong>{group.id}</strong>
                          <small>
                            {(activeSupplierKey === CYBERAFEI_SUPPLIER_KEY ||
                              activeSupplierKey === CHENTU_SUPPLIER_KEY) &&
                            (group.canvasSupported ||
                              (activeSupplierKey === CHENTU_SUPPLIER_KEY &&
                                isChentuImageGroup(group.id)))
                              ? `${group.canvasModelCount ?? 0} 个画布模型 / ${group.models.length} 个广场模型`
                              : `${group.models.length} 个模型`}{" "}
                            · x{group.ratio}
                            {activeSupplierKey === CYBERAFEI_SUPPLIER_KEY ||
                            activeSupplierKey === CHENTU_SUPPLIER_KEY
                              ? ` · ${cyberAfeiScanLabel(group)}`
                              : ""}
                            {usage === "agent"
                              ? " · 导演台可用"
                              : group.canvasSupported ||
                                  (activeSupplierKey === CHENTU_SUPPLIER_KEY &&
                                    isChentuImageGroup(group.id))
                                ? " · 画布可用"
                                : " · 模型信息"}
                          </small>
                        </span>
                      </button>
                    );
                  })}
                  {activeSupplierKey === FRIMODEL_SUPPLIER_KEY ? (
                    <>
                      <button
                        type="button"
                        className={`connection-item ${creatingNew ? "active" : ""}`}
                        onClick={() =>
                          startNewCustomGroupConnection(activeSupplierKey)
                        }
                      >
                        <Plus size={14} />
                        <span>新建自定义分组</span>
                      </button>
                      {activeSupplierConnections
                        .filter(
                          (connection) =>
                            !FRIMODEL_PLATFORM_GROUPS.some(
                              (group) =>
                                group.id ===
                                providerConnectionGroup(connection),
                            ),
                        )
                        .map((connection) => (
                          <button
                            type="button"
                            className={`connection-item ${selectedId === connection.id ? "active" : ""}`}
                            onClick={() => selectConnection(connection)}
                            key={connection.id}
                          >
                            <span className="provider-dot" />
                            <span>
                              <strong>
                                {providerConnectionGroup(connection)}
                              </strong>
                              <small>
                                {connection.name} ·{" "}
                                {connection.apiKeyUsable
                                  ? "密钥可用"
                                  : connection.apiKeySet
                                    ? "密钥需要重新填写"
                                    : "未设置密钥"}{" "}
                                · {connectionScanLabel(connection)}
                              </small>
                            </span>
                          </button>
                        ))}
                    </>
                  ) : activeSupplierKey === CHENTU_SUPPLIER_KEY ? (
                    <button
                      type="button"
                      className={`connection-item ${creatingNew ? "active" : ""}`}
                      onClick={startNewChentuConnection}
                    >
                      <span className="provider-dot muted" />
                      <span>
                        <strong>添加图片连接</strong>
                        <small>以 API Key 实时扫描模型权限</small>
                      </span>
                    </button>
                  ) : null}
                  {activeSupplierKey !== FRIMODEL_SUPPLIER_KEY ? (
                    <>
                      <button
                        type="button"
                        className={`connection-item ${creatingNew && preservedConfig.customGroup === true ? "active" : ""}`}
                        onClick={() =>
                          startNewCustomGroupConnection(activeSupplierKey)
                        }
                      >
                        <Plus size={14} />
                        <span>新建自定义分组</span>
                      </button>
                      {activeCustomConnections.map((connection) => (
                        <button
                          type="button"
                          className={`connection-item ${selectedId === connection.id ? "active" : ""}`}
                          onClick={() => selectConnection(connection)}
                          key={connection.id}
                        >
                          <span className="provider-dot" />
                          <span>
                            <strong>
                              {providerConnectionGroup(connection)}
                            </strong>
                            <small>
                              {connection.name} ·{" "}
                              {connection.apiKeyUsable
                                ? "密钥可用"
                                : connection.apiKeySet
                                  ? "密钥需要重新填写"
                                  : "未设置密钥"}{" "}
                              · {connectionScanLabel(connection)}
                            </small>
                          </span>
                        </button>
                      ))}
                    </>
                  ) : null}
                </>
              ) : activeSupplierKey === "weai" ? (
                <>
                  {WEAI_CATALOG.map((group) => {
                    const connection = connections.find(
                      (item) =>
                        providerConnectionSupplierKey(item) === "weai" &&
                        providerConnectionGroup(item) === group.id,
                    );
                    const scan = connection
                      ? weAiModelScans[connection.id]
                      : undefined;
                    const liveIds = new Set(
                      scan?.status === "ready"
                        ? scan.items.map((model) => model.id)
                        : [],
                    );
                    const visibleModels = !connection
                      ? group.models
                      : connection.apiKeyUsable && scan?.status === "ready"
                        ? group.models.filter((model) => liveIds.has(model.id))
                        : [];
                    const callableCount = visibleModels.filter(
                      (model) => model.canvasCallable,
                    ).length;
                    return (
                      <button
                        type="button"
                        className={`connection-item ${selectedWeAiGroup === group.id ? "active" : ""}`}
                        onClick={() => selectWeAiGroup(group.id)}
                        key={group.id}
                      >
                        <span
                          className={`provider-dot ${connection?.apiKeyUsable ? "" : "muted"}`}
                        />
                        <span>
                          <strong>{group.label}</strong>
                          <small>
                            {connection
                              ? scan?.status === "loading"
                                ? "正在扫描模型"
                                : scan?.status === "error"
                                  ? "扫描失败，模型已隐藏"
                                  : scan?.status === "ready"
                                    ? `${visibleModels.length} 个在线模型 · ${callableCount} 个画布可调用`
                                    : "等待扫描"
                              : `${group.models.length} 个文档模型 · 待接入后扫描`}{" "}
                            · x{group.multiplier} · {group.billingLabel}
                            {connection?.apiKeyUsable ? " · 密钥可用" : ""}
                          </small>
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={`connection-item ${creatingNew && preservedConfig.customGroup === true ? "active" : ""}`}
                    onClick={() =>
                      startNewCustomGroupConnection(activeSupplierKey)
                    }
                  >
                    <Plus size={14} />
                    <span>新建自定义分组</span>
                  </button>
                  {activeCustomConnections.map((connection) => (
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
                              : "未设置密钥"}{" "}
                          · {connectionScanLabel(connection)}
                        </small>
                      </span>
                    </button>
                  ))}
                </>
              ) : activeSupplierKey === MIKOTO_SUPPLIER_KEY ? (
                <>
                  {MIKOTO_GROUPS.map((group) => {
                    const connection = connections.find(
                      (item) =>
                        providerConnectionSupplierKey(item) ===
                          MIKOTO_SUPPLIER_KEY &&
                        providerConnectionGroup(item) === group.id &&
                        providerConnectionUsage(item) === "canvas",
                    );
                    return (
                      <button
                        type="button"
                        className={`connection-item ${selectedMikotoGroup === group.id ? "active" : ""}`}
                        onClick={() => selectMikotoGroup(group.id)}
                        key={group.id}
                      >
                        <span
                          className={`provider-dot ${connection?.apiKeyUsable ? "" : "muted"}`}
                        />
                        <span>
                          <strong>{group.label}</strong>
                          <small>
                            {group.models.length} 个模型 ·{" "}
                            {connection?.apiKeyUsable ? "密钥可用" : "未接入"}
                          </small>
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={`connection-item ${creatingNew && preservedConfig.customGroup === true ? "active" : ""}`}
                    onClick={() =>
                      startNewCustomGroupConnection(activeSupplierKey)
                    }
                  >
                    <Plus size={14} />
                    <span>新建自定义分组</span>
                  </button>
                  {activeCustomConnections.map((connection) => (
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
                              : "未设置密钥"}{" "}
                          · {connectionScanLabel(connection)}
                        </small>
                      </span>
                    </button>
                  ))}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={`connection-item ${creatingNew ? "active" : ""}`}
                    onClick={() => startNewConnection(activeSupplierKey)}
                  >
                    <Plus size={14} />
                    <span>新建连接</span>
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
            {activeSupplierKey === "weai" &&
            activeWeAiGroup &&
            !customGroupFormActive ? (
              <div className="settings-form cangyuan-catalog-detail weai-catalog-detail">
                <header className="cangyuan-group-detail-head">
                  <div>
                    <span className="eyebrow">We-AI 模型广场分组</span>
                    <h3>{activeWeAiGroup.label}</h3>
                    <p>{activeWeAiGroup.description}</p>
                  </div>
                  <div className="cangyuan-group-stats">
                    <span>x{activeWeAiGroup.multiplier} 倍率</span>
                    <span>
                      {activeWeAiConnection
                        ? activeWeAiScan?.status === "loading"
                          ? "正在实时扫描"
                          : `${activeWeAiVisibleModels.length} 个在线模型`
                        : `${activeWeAiGroup.models.length} 个文档模型`}
                    </span>
                    <span>{activeWeAiCallableCount} 个画布可调用</span>
                    <span>{activeWeAiGroup.billingLabel}</span>
                    <span>
                      {activeWeAiGroup.protocols.length > 1
                        ? `${activeWeAiGroup.protocols.length} 种正式协议`
                        : activeWeAiGroup.protocolLabel}
                    </span>
                  </div>
                </header>

                <section className="cangyuan-key-panel">
                  <div className="field">
                    <label htmlFor="weai-group-api-key">
                      <KeyRound size={12} /> 当前分组 API Key
                    </label>
                    {activeWeAiKeyAvailable && !editingWeAiKey ? (
                      <input
                        id="weai-group-api-key"
                        value={`${activeWeAiGroup.label} 分组密钥已加密保存`}
                        readOnly
                        aria-describedby="weai-group-key-help"
                      />
                    ) : (
                      <input
                        id="weai-group-api-key"
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder={`填写 ${activeWeAiGroup.label} 对应的 API Key`}
                        autoComplete="off"
                        aria-describedby="weai-group-key-help"
                      />
                    )}
                    <small id="weai-group-key-help">
                      {activeWeAiKeyUnreadable
                        ? "当前分组的旧密文无法解密，请重新填写该分组对应的 API Key。"
                        : "每个 We-AI 分组独立保存连接和密钥；明文只发送到本机服务端并加密保存。"}
                    </small>
                  </div>
                  {activeWeAiGroup.id === WEAI_GEMINI_GROUP ? (
                    <div className="field">
                      <label htmlFor="weai-gemini-protocol">
                        <Server size={12} /> Gemini 调用协议
                      </label>
                      <select
                        id="weai-gemini-protocol"
                        value={activeWeAiProtocol}
                        onChange={(event) =>
                          setSelectedWeAiProtocol(
                            resolveWeAiProtocol(
                              activeWeAiGroup,
                              event.target.value,
                            ),
                          )
                        }
                      >
                        {activeWeAiGroup.protocols.map((protocol) => (
                          <option value={protocol.id} key={protocol.id}>
                            {protocol.label}
                          </option>
                        ))}
                      </select>
                      <small>
                        {activeWeAiProtocolOption?.description} 兼容协议使用
                        /v1/images/*；原生协议使用 /v1beta/models/...
                        :generateContent。两套协议的请求参数不可混用。
                      </small>
                    </div>
                  ) : null}
                  <div className="cangyuan-key-actions">
                    {activeWeAiKeyAvailable ? (
                      <button
                        className="button"
                        type="button"
                        onClick={() => {
                          setEditingWeAiKey((current) => !current);
                          setApiKey("");
                        }}
                        disabled={busy}
                      >
                        {editingWeAiKey ? "取消更换" : "重新填写密钥"}
                      </button>
                    ) : null}
                    {activeWeAiGroup.canvasSupported ? (
                      <button
                        className="button primary"
                        type="button"
                        onClick={() =>
                          void handleConnectWeAiGroup(activeWeAiGroup.id)
                        }
                        disabled={
                          busy ||
                          (editingWeAiKey
                            ? !apiKey
                            : !activeWeAiKeyAvailable && !apiKey)
                        }
                      >
                        {busy ? (
                          <RefreshCw className="spin" size={13} />
                        ) : (
                          <Check size={13} />
                        )}{" "}
                        {activeWeAiConnection ? "更新画布分组" : "接入画布分组"}
                      </button>
                    ) : (
                      <span className="cangyuan-readonly-hint">
                        {activeWeAiGroup.canvasSupportNote ??
                          "当前分组仅展示模型信息，暂不用于画布调用。"}
                      </span>
                    )}
                    {activeWeAiConnection ? (
                      <button
                        className="button"
                        type="button"
                        onClick={() =>
                          void handleRefreshWeAiModels(activeWeAiConnection)
                        }
                        disabled={busy || !activeWeAiKeyAvailable}
                      >
                        <RefreshCw size={13} /> 重新扫描模型与价格
                      </button>
                    ) : null}
                    {activeWeAiConnection ? (
                      <button
                        className="button"
                        type="button"
                        onClick={() =>
                          void handleTestConnection(activeWeAiConnection.id)
                        }
                        disabled={busy || !activeWeAiKeyAvailable}
                      >
                        <RefreshCw size={13} /> 安全检查
                      </button>
                    ) : null}
                  </div>
                </section>

                <section className="cangyuan-model-browser">
                  <div
                    className="cangyuan-model-list"
                    aria-label="We-AI 分组模型列表"
                  >
                    {activeWeAiVisibleModels.map((model) => (
                      <button
                        type="button"
                        className={`cangyuan-model-item ${displayedWeAiModel?.id === model.id ? "active" : ""} ${model.canvasCallable ? "" : "is-readonly"}`}
                        onClick={() => {
                          setSelectedWeAiModel(model.id);
                          if (model.canvasCallable) setDefaultModel(model.id);
                        }}
                        aria-label={`${model.name}，${weAiRouteStatusLabel(model.routeStatus)}${model.canvasCallable ? "，点击设为画布默认" : "，点击仅查看详情"}`}
                        key={model.id}
                      >
                        <span>{weAiRouteStatusLabel(model.routeStatus)}</span>
                        <strong>{model.name}</strong>
                        <small>{formatWeAiPrice(model)}</small>
                      </button>
                    ))}
                  </div>
                  <article className="cangyuan-model-info">
                    {displayedWeAiModel ? (
                      <>
                        <div className="cangyuan-model-info-head">
                          <span>We-AI 图片模型</span>
                          <h3>{displayedWeAiModel.name}</h3>
                          <code>{displayedWeAiModel.id}</code>
                        </div>
                        <p className="cangyuan-model-description">
                          {displayedWeAiModel.description}
                        </p>
                        <dl className="cangyuan-model-facts">
                          <div>
                            <dt>价格（已含倍率）</dt>
                            <dd>
                              {formatWeAiPriceDetails(displayedWeAiModel)}
                            </dd>
                          </div>
                          <div>
                            <dt>计费</dt>
                            <dd>{activeWeAiGroup.billingLabel}</dd>
                          </div>
                          <div>
                            <dt>分组倍率</dt>
                            <dd>x{activeWeAiGroup.multiplier}</dd>
                          </div>
                          <div>
                            <dt>接口</dt>
                            <dd>
                              {activeWeAiProtocolOption?.label ??
                                activeWeAiGroup.protocolLabel}
                            </dd>
                          </div>
                          <div>
                            <dt>画布路由</dt>
                            <dd>
                              {weAiRouteStatusLabel(
                                displayedWeAiModel.routeStatus,
                              )}
                              {displayedWeAiModel.aliasFor
                                ? `（指向 ${displayedWeAiModel.aliasFor}）`
                                : ""}
                            </dd>
                          </div>
                          <div>
                            <dt>参考图上限</dt>
                            <dd>
                              {displayedWeAiModel.limits?.maxInputImages
                                ? `${displayedWeAiModel.limits.maxInputImages} 张`
                                : "以模型文档为准"}
                            </dd>
                          </div>
                          <div>
                            <dt>当前画布默认</dt>
                            <dd>
                              {activeWeAiDefaultModel?.id ===
                              displayedWeAiModel.id
                                ? "是（当前模型）"
                                : (activeWeAiDefaultModel?.id ?? "暂无")}
                            </dd>
                          </div>
                        </dl>
                        <div className="cangyuan-parameter-list">
                          <strong>路由判断</strong>
                          <div>
                            <span>{displayedWeAiModel.routeNote}</span>
                            {!displayedWeAiModel.canvasCallable ? (
                              <span>
                                此模型只用于查看目录与价格，不能设为默认或保存为画布调用模型。
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {displayedWeAiModel.limits?.notes?.length ? (
                          <div className="cangyuan-parameter-list">
                            <strong>使用限制</strong>
                            <div>
                              {displayedWeAiModel.limits.notes.map((note) => (
                                <span key={note}>{note}</span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <div className="cangyuan-parameter-list">
                          <strong>价格明细</strong>
                          <div>
                            <span>{formatWeAiPrice(displayedWeAiModel)}</span>
                            <span>{WEAI_CURRENCY_NOTE}</span>
                          </div>
                        </div>
                        {displayedWeAiModel.tags.length > 0 ? (
                          <div className="cangyuan-model-tags">
                            {displayedWeAiModel.tags.map((tag) => (
                              <span key={tag}>{tag}</span>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="settings-empty-detail">
                        <strong>
                          {!activeWeAiConnection
                            ? "接入当前分组时会扫描并保存模型快照"
                            : activeWeAiScan?.status === "loading"
                              ? "正在扫描 We-AI 可用模型…"
                              : activeWeAiScan?.status === "error"
                                ? "模型扫描失败，静态旧模型已隐藏"
                                : "当前分组没有可用图片模型"}
                        </strong>
                        {activeWeAiScan?.message ? (
                          <span>{activeWeAiScan.message}</span>
                        ) : null}
                      </div>
                    )}
                  </article>
                </section>
                <div className="modal-message" role="status" aria-live="polite">
                  {message ? <Check size={14} /> : <PlugZap size={14} />}
                  <span>
                    {message ??
                      (activeWeAiConnection
                        ? activeWeAiScan?.status === "ready"
                          ? `已在打开设置时后台刷新当前分组的模型与价格；切换分组沿用本次结果，需要时可点“重新扫描模型与价格”。${WEAI_CURRENCY_NOTE}。${WEAI_ROUTE_SOURCE_NOTE}`
                          : activeWeAiScan?.status === "error"
                            ? `${activeWeAiScan.message ?? "实时模型扫描失败"}；为避免误用，未回退到静态模型。`
                            : "正在读取当前 We-AI 分组的实时模型列表…"
                        : `${WEAI_MARKETPLACE_SOURCE_NOTE} 接入分组时会用该组 API Key 扫描一次并保存快照；运行中确认失效的模型会自动隐藏。${WEAI_CURRENCY_NOTE}。${WEAI_ROUTE_SOURCE_NOTE}`)}
                  </span>
                </div>
              </div>
            ) : activeSupplierKey === MIKOTO_SUPPLIER_KEY &&
              activeMikotoGroup &&
              !customGroupFormActive ? (
              <div className="settings-form cangyuan-catalog-detail mikoto-catalog-detail">
                <header className="cangyuan-group-detail-head">
                  <div>
                    <span className="eyebrow">MikotoPro 供应商分组</span>
                    <h3>{activeMikotoGroup.label}</h3>
                    <p>{activeMikotoGroup.description}</p>
                  </div>
                  <div className="cangyuan-group-stats">
                    <span>{activeMikotoGroup.models.length} 个模型</span>
                    <span>独立 API Key</span>
                    <span>画布可用</span>
                    <span>
                      {activeMikotoConnection?.config.modelScanStatus === "live"
                        ? `Key 实时扫描 ${
                            Array.isArray(
                              activeMikotoConnection.config.scannedModelIds,
                            )
                              ? activeMikotoConnection.config.scannedModelIds
                                  .length
                              : 0
                          } 个 · 价格快照`
                        : activeMikotoConnection?.config.modelScanStatus ===
                            "empty"
                          ? "Key 扫描成功 · 0 个模型"
                          : "尚未用 Key 扫描 · 价格快照"}
                    </span>
                  </div>
                </header>

                <section className="cangyuan-key-panel">
                  <div className="field">
                    <label htmlFor="mikoto-group-api-key">
                      <KeyRound size={12} /> 当前分组 API Key
                    </label>
                    {activeMikotoKeyAvailable && !editingMikotoKey ? (
                      <input
                        id="mikoto-group-api-key"
                        value={`${activeMikotoGroup.label} 分组密钥已加密保存`}
                        readOnly
                        aria-describedby="mikoto-group-key-help"
                      />
                    ) : (
                      <input
                        id="mikoto-group-api-key"
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder={`填写 ${activeMikotoGroup.label} 分组 API Key`}
                        autoComplete="off"
                      />
                    )}
                    <small id="mikoto-group-key-help">
                      {activeMikotoKeyUnreadable
                        ? "当前分组的旧密文无法解密，请重新填写该分组 API Key。"
                        : "每个 MikotoPro 分组独立保存连接和密钥，不与其他供应商或分组复用。"}
                    </small>
                  </div>
                  <div className="cangyuan-key-actions">
                    {activeMikotoKeyAvailable ? (
                      <button
                        className="button"
                        type="button"
                        onClick={() => {
                          setEditingMikotoKey((current) => !current);
                          setApiKey("");
                        }}
                        disabled={busy}
                      >
                        {editingMikotoKey ? "取消更换" : "重新填写密钥"}
                      </button>
                    ) : null}
                    <button
                      className="button primary"
                      type="button"
                      onClick={() =>
                        void handleConnectMikotoGroup(selectedMikotoGroup)
                      }
                      disabled={
                        busy ||
                        (editingMikotoKey
                          ? !apiKey
                          : !activeMikotoKeyAvailable && !apiKey)
                      }
                    >
                      {busy ? (
                        <RefreshCw className="spin" size={13} />
                      ) : (
                        <Check size={13} />
                      )}{" "}
                      {activeMikotoConnection
                        ? "更新 MikotoPro 分组"
                        : "接入 MikotoPro 分组"}
                    </button>
                    {activeMikotoConnection ? (
                      <>
                        <button
                          className="button"
                          type="button"
                          onClick={() =>
                            void handleTestConnection(activeMikotoConnection.id)
                          }
                          disabled={busy || !activeMikotoKeyAvailable}
                        >
                          <RefreshCw size={13} /> 测试连接
                        </button>
                        <button
                          className="button"
                          type="button"
                          onClick={() => void handleRefreshMarketplace()}
                          disabled={busy || !activeMikotoKeyAvailable}
                          title="用当前分组 Key 实时扫描可用模型，不发起付费请求"
                        >
                          <RefreshCw size={13} /> 刷新目录
                        </button>
                      </>
                    ) : null}
                  </div>
                </section>

                <section className="cangyuan-model-browser">
                  <div
                    className="cangyuan-model-list"
                    aria-label="MikotoPro 分组模型列表"
                  >
                    {activeMikotoGroup.models.map((model) => {
                      const scannedOut =
                        activeMikotoConnection?.config.modelScanStatus ===
                          "live" &&
                        Array.isArray(
                          activeMikotoConnection.config.unavailableModels,
                        ) &&
                        (
                          activeMikotoConnection.config
                            .unavailableModels as unknown[]
                        ).includes(model.id);
                      return (
                        <button
                          type="button"
                          className={`cangyuan-model-item ${selectedMikotoModel === model.id ? "active" : ""} ${scannedOut ? "is-readonly" : ""}`}
                          onClick={() => {
                            setSelectedMikotoModel(model.id);
                            setDefaultModel(model.id);
                          }}
                          key={model.id}
                        >
                          <span>
                            {model.outputKinds?.join(" / ") ?? "模型"}
                          </span>
                          <strong>{model.name}</strong>
                          <small>
                            {model.id}
                            {scannedOut ? " · Key 未扫描到，暂不可调用" : ""}
                          </small>
                        </button>
                      );
                    })}
                  </div>
                  <article className="cangyuan-model-info">
                    {activeMikotoModel ? (
                      <>
                        <div className="cangyuan-model-info-head">
                          <span>MikotoPro 模型</span>
                          <h3>{activeMikotoModel.name}</h3>
                          <code>{activeMikotoModel.id}</code>
                        </div>
                        <p className="cangyuan-model-description">
                          {activeMikotoModel.description}
                        </p>
                        <dl className="cangyuan-model-facts">
                          <div>
                            <dt>支持操作</dt>
                            <dd>{activeMikotoModel.operations.join(" · ")}</dd>
                          </div>
                          <div>
                            <dt>输入</dt>
                            <dd>
                              {activeMikotoModel.inputKinds?.join(" · ") ??
                                "文本"}
                            </dd>
                          </div>
                        </dl>
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
                      "MikotoPro 按官方文档独立接入 OpenAI 图片、Gemini 原生图片、Seedance 视频和 Kling 视频；模型参数已自动适配。"}
                  </span>
                </div>
              </div>
            ) : (activeSupplierKey === "cangyuan" ||
                activeSupplierKey === CYBERAFEI_SUPPLIER_KEY ||
                activeSupplierKey === FRIMODEL_SUPPLIER_KEY ||
                activeSupplierKey === CHENTU_SUPPLIER_KEY ||
                activeSupplierKey === MIAOWU_SUPPLIER_KEY) &&
              !customGroupFormActive &&
              activeMarketplaceGroup ? (
              <div className="settings-form cangyuan-catalog-detail">
                <header className="cangyuan-group-detail-head">
                  <div>
                    <span className="eyebrow">
                      {providerSupplierLabel(activeSupplierKey)}供应商分组
                    </span>
                    <h3>{activeMarketplaceGroup.id}</h3>
                    <p>
                      {activeMarketplaceGroup.description ||
                        `该分组说明以${providerSupplierLabel(activeSupplierKey)}模型广场当前配置为准。`}
                    </p>
                  </div>
                  <div className="cangyuan-group-stats">
                    <span>
                      {activeConnectionUsage === "agent"
                        ? "导演台对话"
                        : "画布生成"}
                    </span>
                    <span>x{activeMarketplaceGroup.ratio} 倍率</span>
                    <span>
                      {(activeSupplierKey === CYBERAFEI_SUPPLIER_KEY ||
                        activeSupplierKey === CHENTU_SUPPLIER_KEY) &&
                      (activeMarketplaceGroup.canvasSupported ||
                        (activeSupplierKey === CHENTU_SUPPLIER_KEY &&
                          isChentuImageGroup(activeMarketplaceGroup.id)))
                        ? `${activeMarketplaceGroup.canvasModelCount ?? 0} 个画布模型 / ${activeMarketplaceGroup.models.length} 个广场模型`
                        : `${activeMarketplaceGroup.models.length} 个模型`}
                    </span>
                    <span>
                      {activeSupplierKey === CYBERAFEI_SUPPLIER_KEY
                        ? cyberAfeiScanLabel(activeMarketplaceGroup)
                        : activeSupplierKey === FRIMODEL_SUPPLIER_KEY
                          ? "平台分组 · Key 实时扫描"
                          : activeSupplierKey === CHENTU_SUPPLIER_KEY
                            ? `${
                                chentuCatalogSource === "live"
                                  ? "实时目录"
                                  : chentuCatalogSource === "stale"
                                    ? "缓存目录"
                                    : "备用目录"
                              } · ${cyberAfeiScanLabel(activeMarketplaceGroup)}`
                            : activeSupplierKey === MIAOWU_SUPPLIER_KEY
                              ? miaowuCatalogSource === "live"
                                ? "实时目录"
                                : miaowuCatalogSource === "stale"
                                  ? "缓存目录"
                                  : "备用目录"
                              : catalogSource === "live"
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
                    {activeGroupKeyAvailable &&
                    !(activeSupplierKey === CYBERAFEI_SUPPLIER_KEY
                      ? editingCyberAfeiKey
                      : editingCangyuanKey) ? (
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
                          : `此 Key 仅供${providerSupplierLabel(activeSupplierKey)}画布图片/视频节点使用，不与右侧导演台复用；明文不会下发到浏览器。`}
                    </small>
                  </div>
                  <div className="cangyuan-key-actions">
                    {activeGroupKeyAvailable ? (
                      <button
                        className="button"
                        type="button"
                        onClick={() => {
                          if (activeSupplierKey === CYBERAFEI_SUPPLIER_KEY)
                            setEditingCyberAfeiKey((current) => !current);
                          else setEditingCangyuanKey((current) => !current);
                          setApiKey("");
                        }}
                        disabled={busy}
                      >
                        {(
                          activeSupplierKey === CYBERAFEI_SUPPLIER_KEY
                            ? editingCyberAfeiKey
                            : editingCangyuanKey
                        )
                          ? "取消更换"
                          : "重新填写密钥"}
                      </button>
                    ) : null}
                    {activeConnectionUsage === "agent" ||
                      ((activeMarketplaceGroup.canvasSupported ||
                        (activeSupplierKey === CHENTU_SUPPLIER_KEY &&
                          isChentuImageGroup(activeMarketplaceGroup.id))) &&
                      (activeSupplierKey === CYBERAFEI_SUPPLIER_KEY ||
                        activeSupplierKey === CHENTU_SUPPLIER_KEY ||
                        activeSupplierKey === MIAOWU_SUPPLIER_KEY ||
                        isFriModelImageGroup(activeMarketplaceGroup.id) ||
                        isCangyuanImageGroup(activeMarketplaceGroup.id))) ? (
                      <button
                        className="button primary"
                        type="button"
                        onClick={() =>
                          void (activeConnectionUsage === "agent"
                            ? activeSupplierKey === CYBERAFEI_SUPPLIER_KEY
                              ? handleConnectCyberAfeiAgentGroup(
                                  activeMarketplaceGroup.id,
                                )
                              : activeSupplierKey === CHENTU_SUPPLIER_KEY
                                ? handleConnectChentuAgentGroup(
                                    activeMarketplaceGroup.id,
                                  )
                                : handleConnectCangyuanAgentGroup(
                                    activeMarketplaceGroup.id,
                                  )
                            : activeSupplierKey === CYBERAFEI_SUPPLIER_KEY
                              ? handleConnectCyberAfeiGroup(
                                  activeMarketplaceGroup.id,
                                )
                              : activeSupplierKey === FRIMODEL_SUPPLIER_KEY
                                ? handleConnectFriModelGroup(
                                    activeMarketplaceGroup.id,
                                  )
                                : activeSupplierKey === CHENTU_SUPPLIER_KEY
                                  ? handleConnectChentuGroup(
                                      activeMarketplaceGroup.id,
                                    )
                                  : activeSupplierKey === MIAOWU_SUPPLIER_KEY
                                    ? handleConnectMiaowuGroup(
                                        activeMarketplaceGroup.id,
                                      )
                                    : handleConnectCangyuanGroup(
                                        activeMarketplaceGroup.id as CangyuanImageGroup,
                                      ))
                        }
                        disabled={
                          busy ||
                          ((
                            activeSupplierKey === CYBERAFEI_SUPPLIER_KEY
                              ? editingCyberAfeiKey
                              : editingCangyuanKey
                          )
                            ? !apiKey
                            : !activeGroupKeyAvailable && !apiKey)
                        }
                      >
                        {busy ? (
                          <RefreshCw className="spin" size={13} />
                        ) : (
                          <Check size={13} />
                        )}{" "}
                        {activeMarketplaceConnection
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
                    {activeMarketplaceConnection ? (
                      <button
                        className="button"
                        type="button"
                        onClick={() =>
                          void handleTestConnection(
                            activeMarketplaceConnection.id,
                          )
                        }
                        disabled={busy}
                      >
                        <RefreshCw size={13} /> 测试连接
                      </button>
                    ) : null}
                    <button
                      className="button"
                      type="button"
                      onClick={() => void handleRefreshMarketplace()}
                      disabled={busy}
                      title="重新拉取模型广场与当前 Key 的实时扫描结果，不发起付费请求"
                    >
                      <RefreshCw size={13} /> 刷新目录
                    </button>
                  </div>
                </section>

                <section className="cangyuan-model-browser">
                  <div
                    className="cangyuan-model-list"
                    aria-label="分组模型列表"
                  >
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
                          <small>
                            {model.priceLabel}
                            {activeSupplierKey === CYBERAFEI_SUPPLIER_KEY &&
                            model.canvasRunnable === false &&
                            model.capability !== "chat"
                              ? ` · ${model.canvasUnavailableReason ?? "当前不可用于画布"}`
                              : ""}
                          </small>
                          {activeSupplierKey === "cangyuan" &&
                          cangyuanAvailability[model.id] ? (
                            <em
                              className={cangyuanAvailabilityClass(
                                cangyuanAvailability[model.id]!.latestStatus,
                              )}
                            >
                              {cangyuanAvailabilitySummary(
                                cangyuanAvailability[model.id],
                              )}
                            </em>
                          ) : null}
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
                              {activeMarketplaceModel.endpointTypes.join(
                                "、",
                              ) ||
                                (activeMarketplaceModel.capability === "video"
                                  ? "OpenAI Video"
                                  : activeMarketplaceModel.capability ===
                                      "image"
                                    ? "OpenAI Images"
                                    : "以模型文档为准")}
                            </dd>
                          </div>
                          {activeSupplierKey === "cangyuan" &&
                          activeCangyuanAvailability ? (
                            <div>
                              <dt>平台可用性</dt>
                              <dd
                                className={cangyuanAvailabilityClass(
                                  activeCangyuanAvailability.latestStatus,
                                )}
                              >
                                {cangyuanAvailabilitySummary(
                                  activeCangyuanAvailability,
                                )}
                              </dd>
                            </div>
                          ) : null}
                          {activeSupplierKey === CYBERAFEI_SUPPLIER_KEY &&
                          (activeConnectionUsage !== "agent" ||
                            activeMarketplaceModel.capability !== "chat") ? (
                            <div>
                              <dt>画布接入</dt>
                              <dd>
                                {activeRuntimeModel
                                  ? "已接入画布（协议已实测）"
                                  : (activeMarketplaceModel.canvasUnavailableReason ??
                                    "未接入：广场通用示例尚未通过真实请求验证")}
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                        {activeRuntimeModel?.parameters?.length ? (
                          <div className="cangyuan-parameter-list">
                            <strong>画布参数</strong>
                            <div>
                              {activeRuntimeModel.parameters.map(
                                (parameter) => (
                                  <span key={parameter.key}>
                                    {parameter.label}
                                  </span>
                                ),
                              )}
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
                      (activeSupplierKey === CYBERAFEI_SUPPLIER_KEY
                        ? "价格和模型信息随赛博阿飞 API 模型广场更新；画布只开放协议已验证的模型，API Key 仅在服务端加密保存。"
                        : activeSupplierKey === FRIMODEL_SUPPLIER_KEY
                          ? "分组来自 FriModel 平台令牌设置；接入后以该 Key 的 /v1/models 实时扫描权限，未验证的视频或对话协议不会自动调用。"
                          : activeSupplierKey === CHENTU_SUPPLIER_KEY
                            ? "模型说明来自辰途 API 模型广场与使用文档；接入后以该 Key 的 /v1/models 实时扫描权限，并对照其公开状态页运行情况。"
                            : activeSupplierKey === MIAOWU_SUPPLIER_KEY
                              ? "分组、倍率、模型和价格来自喵呜实时价目；每个分组独立保存 API Key，并通过 /v1/models 免费扫描实际权限。"
                              : cangyuanAvailabilityState === "loading"
                                ? "正在查询沧元模型可用性和平均延迟……"
                                : cangyuanAvailabilityState === "error"
                                  ? "沧元可用性接口暂时不可用；模型目录和生成请求不受影响。"
                                  : "分组和模型随沧元算力模型广场更新；可用性来自 /v1/availability，API Key 仅在服务端加密保存。")}
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
                    {preservedConfig.customGroup === true ? (
                      <input
                        id="provider-kind"
                        value={providerSupplierLabel(
                          selectedSupplierKey || activeSupplierKey,
                        )}
                        readOnly
                        aria-describedby="provider-kind-help"
                      />
                    ) : (
                      <select
                        id="provider-kind"
                        value={presetId ?? provider}
                        onChange={(event) => {
                          const nextProvider = event.target.value;
                          if (nextProvider !== (presetId ?? provider))
                            beginProviderFormSwitch();
                          if (nextProvider === CANGYUAN_IMAGE_PRESET_ID) {
                            applyCangyuanPreset();
                            return;
                          }
                          if (nextProvider === CYBERAFEI_PRESET_ID) {
                            const group =
                              cyberAfeiGroups.find(
                                (item) => item.id === selectedMarketplaceGroup,
                              ) ?? cyberAfeiGroups[0];
                            setPresetId(CYBERAFEI_PRESET_ID);
                            setProvider("rest");
                            setSelectedSupplierKey(CYBERAFEI_SUPPLIER_KEY);
                            const usage = group
                              ? cangyuanGroupUsage(group)
                              : "canvas";
                            const groupId = group?.id ?? "image-2稳定生图";
                            setSelectedMarketplaceGroup(groupId);
                            setBaseUrl(
                              usage === "agent"
                                ? CYBERAFEI_API_BASE_URL
                                : CYBERAFEI_BASE_URL,
                            );
                            setName(
                              `赛博阿飞 API · ${groupId}${usage === "agent" ? " · 导演台" : ""}`,
                            );
                            setPreservedConfig({
                              supplierKey: CYBERAFEI_SUPPLIER_KEY,
                              usage,
                              modelGroup: groupId,
                            });
                            setDefaultModel(
                              usage === "agent"
                                ? (group?.models.find(
                                    (model) => model.capability === "chat",
                                  )?.id ?? "")
                                : "",
                            );
                            return;
                          }
                          if (nextProvider === MIKOTO_PRESET_ID) {
                            applyMikotoPreset();
                            return;
                          }
                          if (nextProvider === MIAOWU_PRESET_ID) {
                            applyMiaowuPreset();
                            return;
                          }
                          if (nextProvider === FRIMODEL_PRESET_ID) {
                            applyFriModelPreset();
                            return;
                          }
                          if (nextProvider === CHENTU_PRESET_ID) {
                            applyChentuPreset();
                            return;
                          }
                          setPresetId(null);
                          setProvider(nextProvider);
                          setSelectedSupplierKey(nextProvider);
                          setDefaultModel("");
                          if (nextProvider === "weai") {
                            setName("We-AI 图片");
                            setBaseUrl(WEAI_IMAGE_BASE_URL);
                            setDefaultModel(WEAI_IMAGE_DEFAULT_MODEL);
                          } else if (nextProvider === "openai") {
                            setName("OpenAI 图片");
                            setBaseUrl("https://api.openai.com/v1");
                          } else if (nextProvider === "runway") {
                            setName("Runway 视频");
                            setBaseUrl("https://api.dev.runwayml.com/v1");
                          } else if (nextProvider === "rest") {
                            setName("自定义 REST");
                            setBaseUrl(defaultRestConfig.baseUrl);
                            setConnectorJson(
                              JSON.stringify(
                                defaultRestConfig.connector,
                                null,
                                2,
                              ),
                            );
                          } else if (nextProvider === "fake") {
                            setName("Fake 演示连接");
                            setBaseUrl("");
                          }
                        }}
                      >
                        <option value={CANGYUAN_IMAGE_PRESET_ID}>
                          沧元算力
                        </option>
                        <option value={CYBERAFEI_PRESET_ID}>
                          赛博阿飞 API
                        </option>
                        <option value={MIKOTO_PRESET_ID}>MikotoPro</option>
                        <option value={MIAOWU_PRESET_ID}>
                          喵呜 API（视频）
                        </option>
                        <option value={FRIMODEL_PRESET_ID}>
                          FriModel（图片）
                        </option>
                        <option value={CHENTU_PRESET_ID}>
                          辰途 API（图片）
                        </option>
                        <option value="weai">
                          We-AI（图片生成 / 图片编辑）
                        </option>
                        <option value="openai">OpenAI 兼容（图片）</option>
                        <option value="runway">Runway（视频）</option>
                        <option value="rest">通用 REST（图片 / 视频）</option>
                        <option value="fake">Fake 演示</option>
                      </select>
                    )}
                    {preservedConfig.customGroup === true ? (
                      <small id="provider-kind-help">
                        自定义分组固定归属于当前供应商，模型将从该供应商的 API
                        地址读取。
                      </small>
                    ) : null}
                  </div>
                </div>
                {preservedConfig.customGroup === true ? (
                  <div className="field">
                    <label htmlFor="provider-custom-group">
                      自定义分组名称
                    </label>
                    <input
                      id="provider-custom-group"
                      value={customGroupName}
                      onChange={(event) => {
                        const value = event.target.value;
                        setCustomGroupName(value);
                        setPreservedConfig((current) => ({
                          ...current,
                          modelGroup: value,
                          customGroup: true,
                        }));
                      }}
                      placeholder="例如：我的图片供应商"
                    />
                  </div>
                ) : null}
                {provider === "rest" &&
                presetId === CANGYUAN_IMAGE_PRESET_ID ? (
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
                          cangyuanImageConnectorForGroup(nextGroup).models ??
                            [],
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
                      presetId === FRIMODEL_PRESET_ID
                        ? FRIMODEL_BASE_URL
                        : presetId === CHENTU_PRESET_ID
                          ? CHENTU_BASE_URL
                          : provider === "openai"
                            ? "https://api.openai.com/v1"
                            : provider === "weai"
                              ? WEAI_IMAGE_BASE_URL
                              : provider === "rest" &&
                                  presetId === MIKOTO_PRESET_ID
                                ? MIKOTO_BASE_URL
                                : provider === "rest" &&
                                    presetId === MIAOWU_PRESET_ID
                                  ? MIAOWU_BASE_URL
                                  : provider === "runway"
                                    ? "https://api.dev.runwayml.com/v1"
                                    : "https://api.example.com"
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="provider-default-model">默认模型</label>
                  {preservedConfig.customGroup === true &&
                  customModels.length > 0 ? (
                    <select
                      id="provider-default-model"
                      value={defaultModel}
                      onChange={(event) => setDefaultModel(event.target.value)}
                    >
                      {customModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {customModelDisplayLabel(model)}
                        </option>
                      ))}
                    </select>
                  ) : provider === "rest" &&
                    (presetId === CANGYUAN_IMAGE_PRESET_ID ||
                      presetId === MIKOTO_PRESET_ID ||
                      presetId === MIAOWU_PRESET_ID) ? (
                    <select
                      id="provider-default-model"
                      value={defaultModel}
                      onChange={(event) => setDefaultModel(event.target.value)}
                    >
                      {(presetId === MIKOTO_PRESET_ID
                        ? (mikotoGroup(selectedMikotoGroup)?.models ??
                          MIKOTO_MODELS.filter(
                            (model) => model.id === defaultModel,
                          ))
                        : presetId === MIAOWU_PRESET_ID
                          ? MIAOWU_MODELS
                          : cangyuanModels
                      ).map((model) => (
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
                        presetId === FRIMODEL_PRESET_ID
                          ? `${FRIMODEL_DEFAULT_MODEL} 或实时扫描出的模型 ID`
                          : presetId === CHENTU_PRESET_ID
                            ? `${CHENTU_DEFAULT_MODEL} 或实时扫描出的模型 ID`
                            : provider === "openai"
                              ? "gpt-image-2 或中转站提供的模型 ID"
                              : provider === "weai"
                                ? "gpt-image-2"
                                : provider === "runway"
                                  ? "gen4.5"
                                  : presetId === MIKOTO_PRESET_ID
                                    ? MIKOTO_DEFAULT_MODEL
                                    : presetId === MIAOWU_PRESET_ID
                                      ? MIAOWU_DEFAULT_MODEL
                                      : "连接器 models 中的默认模型"
                      }
                    />
                  )}
                </div>
                {preservedConfig.customGroup === true ? (
                  <div className="provider-preset-summary" role="status">
                    <span>
                      {customModelsLoading
                        ? "正在从供应商 API 读取模型…"
                        : customModels.length > 0
                          ? `已读取 ${customModels.length} 个模型`
                          : "填写 API Key 后保存连接，再点击“测试连接”读取模型"}
                    </span>
                    {selectedId ? (
                      <button
                        className="button"
                        type="button"
                        onClick={() => loadCustomModels(selectedId)}
                        disabled={busy || customModelsLoading}
                      >
                        <RefreshCw size={13} /> 刷新模型
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {preservedConfig.customGroup === true &&
                customModels.length > 0 ? (
                  <div className="provider-preset-summary" role="status">
                    <span>
                      可用模型：
                      {customModels.map(customModelDisplayLabel).join("、")}
                    </span>
                  </div>
                ) : null}
                {preservedConfig.customGroup === true &&
                customModels.length > 0 ? (
                  <div className="provider-preset-summary" role="status">
                    <span>
                      文档分组：{customModelGroupSummary(customModels)}
                    </span>
                  </div>
                ) : null}
                {provider === "rest" &&
                presetId === CANGYUAN_IMAGE_PRESET_ID ? (
                  <div className="provider-preset-summary" role="status">
                    <Check size={14} />
                    <span>
                      {modelGroup} · 当前可用 {cangyuanModels.length} 个模型
                    </span>
                  </div>
                ) : provider === "rest" && presetId === MIKOTO_PRESET_ID ? (
                  <div className="provider-preset-summary" role="status">
                    <Check size={14} />
                    <span>
                      MikotoPro 文档接口 · 当前分组可用{" "}
                      {activeMikotoGroup?.models.length ?? 0} 个模型 ·{" "}
                      {activeMikotoGroup?.provider === "weai"
                        ? "Gemini 原生图片"
                        : "OpenAI / 视频"}
                    </span>
                  </div>
                ) : provider === "rest" && presetId === MIAOWU_PRESET_ID ? (
                  <div className="provider-preset-summary" role="status">
                    <Check size={14} />
                    <span>
                      喵呜视频模型连接 · 按模型详情分别调用 /v1/videos 或
                      /v1/chat/completions · 模型广场 {MIAOWU_MODELS.length}
                      个视频模型 · 仅显示该模型公开的视频参数与参考媒体接口
                    </span>
                  </div>
                ) : provider === "openai" && presetId === FRIMODEL_PRESET_ID ? (
                  <div className="provider-preset-summary" role="status">
                    <Check size={14} />
                    <span>
                      FriModel · 通过 <code>/v1/models</code> 按当前 API Key
                      实时检测图片模型；连接测试不扣费。{" "}
                      <a
                        href={FRIMODEL_DOCS_URL}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看官方文档
                      </a>
                    </span>
                  </div>
                ) : provider === "openai" && presetId === CHENTU_PRESET_ID ? (
                  <div className="provider-preset-summary" role="status">
                    <Check size={14} />
                    <span>
                      辰途 API · 通过 <code>/v1/models</code> 按当前 API Key
                      实时检测图片模型；测试连接不扣费。{" "}
                      <a
                        href={CHENTU_DOCS_URL}
                        target="_blank"
                        rel="noreferrer"
                      >
                        使用文档
                      </a>{" "}
                      ·{" "}
                      <a
                        href={CHENTU_MODEL_STATUS_URL}
                        target="_blank"
                        rel="noreferrer"
                      >
                        模型状态
                      </a>
                    </span>
                  </div>
                ) : provider === "rest" &&
                  presetId !== MIKOTO_PRESET_ID &&
                  presetId !== MIAOWU_PRESET_ID ? (
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
                    disabled={
                      busy ||
                      !name ||
                      (preservedConfig.customGroup === true &&
                        !customGroupName.trim())
                    }
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
        aria-label="运行历史"
        tabIndex={-1}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">生成记录</span>
            <h2>运行历史</h2>
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
                          {nodeErrors.map((node) => {
                            const localized = localizeRunError(node.errorJson);
                            return (
                              <li key={node.id}>
                                <strong>{node.nodeId}</strong>
                                <div className="history-error-detail">
                                  <span>{localized?.message}</span>
                                  {localized?.actionUrl ? (
                                    <a
                                      href={localized.actionUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <ExternalLink size={10} />
                                      {localized.actionLabel ?? "供应商官网"}
                                    </a>
                                  ) : null}
                                </div>
                              </li>
                            );
                          })}
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
                        {run.canResume ? (
                          <button
                            className="button small"
                            type="button"
                            disabled={busy || resumingId !== null}
                            onClick={async () => {
                              setResumingId(run.id);
                              try {
                                await onResumeRun(run.id);
                                await reload();
                              } catch (error) {
                                setLoadError(
                                  error instanceof Error
                                    ? error.message
                                    : "任务恢复失败",
                                );
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
                        ) : (
                          <span className="history-resume-blocked">
                            无法自动恢复，请先核对供应商任务与扣费记录
                          </span>
                        )}
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
  onDeleteAssets,
}: ModalProps & {
  assets: AssetView[];
  onPreview: (asset: AssetView) => void;
  onReuseAsset: (assetId: string) => void;
  onDropAsset: (assetId: string, position: { x: number; y: number }) => void;
  onDeleteAssets: (assetIds: string[]) => Promise<DeleteAssetsResult>;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(
    null,
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const dragStartRef = useRef<{
    assetId: string;
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const dragMovedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const selectionStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
    baseIds: Set<string>;
  } | null>(null);
  const generatedImages = assets.filter(
    (asset) =>
      asset.kind === "image" && typeof asset.metadata.runId === "string",
  );
  const handleClose = () => {
    setSelectedAssetIds(new Set());
    setSelectionRect(null);
    setConfirmingDelete(false);
    setDeleteMessage(null);
    onClose();
  };
  const dialogRef = useDialogFocus(open, handleClose);

  const toggleSelectedAsset = (assetId: string) => {
    setSelectedAssetIds((current) => {
      const next = new Set(current);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
    setConfirmingDelete(false);
    setDeleteMessage(null);
  };

  const handleConfirmDelete = async () => {
    if (selectedAssetIds.size === 0 || deleting) return;
    setDeleting(true);
    setDeleteMessage(null);
    try {
      const result = await onDeleteAssets(Array.from(selectedAssetIds));
      setSelectedAssetIds(new Set(result.failedIds));
      setConfirmingDelete(false);
      if (result.failedIds.length > 0) {
        setDeleteMessage(
          `已删除 ${result.deletedIds.length} 张，${result.failedIds.length} 张删除失败，请重试`,
        );
      } else {
        setDeleteMessage(`已删除 ${result.deletedIds.length} 张历史图片`);
      }
    } finally {
      setDeleting(false);
    }
  };

  if (!open) return null;
  return (
    <div
      className={`modal-backdrop generation-history-backdrop ${draggingAssetId ? "asset-dragging" : ""}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) handleClose();
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
              点击预览；勾选或在空白处拖动可批量选择
            </small>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={handleClose}
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
          <>
            <div className="generation-history-toolbar">
              <span className="generation-history-selection-count">
                {selectedAssetIds.size > 0
                  ? `已选 ${selectedAssetIds.size} 张`
                  : `共 ${generatedImages.length} 张`}
              </span>
              <div className="generation-history-toolbar-actions">
                <button
                  className="button small"
                  type="button"
                  onClick={() => {
                    setSelectedAssetIds(
                      new Set(generatedImages.map((asset) => asset.id)),
                    );
                    setConfirmingDelete(false);
                    setDeleteMessage(null);
                  }}
                  disabled={selectedAssetIds.size === generatedImages.length}
                >
                  全选
                </button>
                {selectedAssetIds.size > 0 ? (
                  <button
                    className="button small"
                    type="button"
                    onClick={() => {
                      setSelectedAssetIds(new Set());
                      setConfirmingDelete(false);
                      setDeleteMessage(null);
                    }}
                    disabled={deleting}
                  >
                    取消选择
                  </button>
                ) : null}
                {confirmingDelete ? (
                  <>
                    <span className="generation-history-delete-confirm">
                      确认永久删除 {selectedAssetIds.size} 张？
                    </span>
                    <button
                      className="button danger small"
                      type="button"
                      onClick={() => void handleConfirmDelete()}
                      disabled={deleting}
                    >
                      {deleting ? (
                        <RefreshCw className="spin" size={13} />
                      ) : (
                        <Trash2 size={13} />
                      )}
                      确认删除
                    </button>
                    <button
                      className="button small"
                      type="button"
                      onClick={() => setConfirmingDelete(false)}
                      disabled={deleting}
                    >
                      返回
                    </button>
                  </>
                ) : (
                  <button
                    className="button danger small"
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    disabled={selectedAssetIds.size === 0}
                  >
                    <Trash2 size={13} /> 删除所选
                  </button>
                )}
              </div>
              {deleteMessage ? (
                <span
                  className="generation-history-delete-message"
                  role="status"
                >
                  {deleteMessage}
                </span>
              ) : null}
            </div>
            <div
              ref={gridRef}
              className={`generation-history-grid ${selectionRect ? "is-box-selecting" : ""}`}
              onPointerDown={(event) => {
                if (event.button !== 0 || event.target !== event.currentTarget)
                  return;
                const baseIds =
                  event.ctrlKey || event.metaKey
                    ? new Set(selectedAssetIds)
                    : new Set<string>();
                selectionStartRef.current = {
                  pointerId: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                  moved: false,
                  baseIds,
                };
                setSelectedAssetIds(baseIds);
                setConfirmingDelete(false);
                setDeleteMessage(null);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const start = selectionStartRef.current;
                if (!start || start.pointerId !== event.pointerId) return;
                if (
                  !start.moved &&
                  Math.hypot(event.clientX - start.x, event.clientY - start.y) <
                    4
                )
                  return;
                start.moved = true;
                const nextRect = selectionRectBetween(
                  { x: start.x, y: start.y },
                  { x: event.clientX, y: event.clientY },
                );
                setSelectionRect(nextRect);
                const matchedIds = intersectingSelectionIds(
                  nextRect,
                  generatedImages.flatMap((asset) => {
                    const card = cardRefs.current.get(asset.id);
                    if (!card) return [];
                    const rect = card.getBoundingClientRect();
                    return [
                      {
                        id: asset.id,
                        rect: {
                          left: rect.left,
                          top: rect.top,
                          right: rect.right,
                          bottom: rect.bottom,
                        },
                      },
                    ];
                  }),
                );
                setSelectedAssetIds(new Set([...start.baseIds, ...matchedIds]));
              }}
              onPointerUp={(event) => {
                const start = selectionStartRef.current;
                if (!start || start.pointerId !== event.pointerId) return;
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
                selectionStartRef.current = null;
                setSelectionRect(null);
              }}
              onPointerCancel={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
                selectionStartRef.current = null;
                setSelectionRect(null);
              }}
            >
              {generatedImages.map((asset) => (
                <article
                  ref={(element) => {
                    if (element) cardRefs.current.set(asset.id, element);
                    else cardRefs.current.delete(asset.id);
                  }}
                  className={`generation-history-card ${selectedAssetIds.has(asset.id) ? "is-selected" : ""}`}
                  key={asset.id}
                >
                  <button
                    className="generation-history-select"
                    type="button"
                    role="checkbox"
                    aria-checked={selectedAssetIds.has(asset.id)}
                    aria-label={`${selectedAssetIds.has(asset.id) ? "取消选择" : "选择"} ${asset.name}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => toggleSelectedAsset(asset.id)}
                  >
                    {selectedAssetIds.has(asset.id) ? (
                      <Check size={14} />
                    ) : null}
                  </button>
                  <button
                    className="generation-history-preview"
                    type="button"
                    onClick={(event) => {
                      if (suppressClickRef.current) {
                        event.preventDefault();
                        suppressClickRef.current = false;
                        return;
                      }
                      if (
                        selectedAssetIds.size > 0 ||
                        event.ctrlKey ||
                        event.metaKey ||
                        event.shiftKey
                      ) {
                        toggleSelectedAsset(asset.id);
                        return;
                      }
                      onPreview(asset);
                    }}
                    aria-label={`预览 ${asset.name}`}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      if (
                        selectedAssetIds.size > 0 ||
                        event.ctrlKey ||
                        event.metaKey ||
                        event.shiftKey
                      )
                        return;
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
                      if (
                        event.currentTarget.hasPointerCapture(event.pointerId)
                      )
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
                      if (
                        event.currentTarget.hasPointerCapture(event.pointerId)
                      )
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
              {selectionRect ? (
                <div
                  className="generation-history-selection-box"
                  style={{
                    left: selectionRect.left,
                    top: selectionRect.top,
                    width: selectionRect.right - selectionRect.left,
                    height: selectionRect.bottom - selectionRect.top,
                  }}
                />
              ) : null}
            </div>
          </>
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
  const url = assetDownloadPath(asset.id);
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
          <a
            className="button primary"
            href={url}
            download={asset.name}
            onClick={(event) => {
              event.preventDefault();
              void downloadAssetPreferLocal(asset.id, asset.name);
            }}
          >
            下载原文件
          </a>
        </footer>
      </section>
    </div>
  );
}
