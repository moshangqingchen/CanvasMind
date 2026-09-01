"use client";

import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  Check,
  Circle,
  FileAudio,
  FileVideo,
  ImageIcon,
  KeyRound,
  LoaderCircle,
  MessageSquarePlus,
  Paperclip,
  Send,
  X,
} from "lucide-react";
import type {
  DirectorGraphPatch,
  DirectorModelCapabilities,
  DirectorProtocol,
} from "@super-canvas/director";
import type { ModelDescriptor } from "@super-canvas/providers";

import {
  createDirectorConversation,
  fetchDirectorConversation,
  fetchDirectorConversations,
  fetchDirectorProfile,
  saveDirectorProfile,
  streamDirectorTurn,
} from "../lib/director-client";
import type {
  DirectorApproveResult,
  DirectorConversationSummary,
  DirectorPublicMessage,
  DirectorPublicProfile,
  DirectorPublicProposal,
  DirectorStage,
  DirectorTurnEvent,
} from "../lib/director-contracts";
import { DIRECTOR_STAGES } from "../lib/director-contracts";
import {
  fetchModels,
  uploadAsset,
  type ProviderConnectionView,
} from "../lib/client-api";
import {
  directorBrainConnections,
  directorConfiguredModelInventory,
  directorModelSupportsText,
  ensureDirectorModel,
  findProviderGroupConnection,
  mergeDirectorModelInventory,
  preferredDirectorModelId,
} from "../lib/director-provider-options";
import {
  providerConnectionGroup,
  providerConnectionSupplierKey,
  providerGroupLabel,
  providerSupplierLabel,
} from "../lib/provider-connection-options";
import {
  directorReasoningOptions,
  type DirectorReasoningEffort,
} from "../lib/director-reasoning";
import type { AssetView, CanvasNode } from "./types";

export interface AgentDraftRequest {
  id: string;
  text: string;
  assetId?: string;
}

export interface SuperDirectorPanelProps {
  connections: ProviderConnectionView[];
  assets: AssetView[];
  canvasId: string;
  selectedNode: CanvasNode | null;
  selectedPrompt: string;
  draftRequest: AgentDraftRequest | null;
  onManageApi: (group?: string) => void;
  canvasRevision?: number;
  viewport?: { x: number; y: number; zoom: number };
  onPreviewPatch?: (
    patch: DirectorGraphPatch | null,
    proposal?: DirectorPublicProposal,
  ) => void;
  onApproved?: (result: DirectorApproveResult) => void | Promise<void>;
}

const STAGE_LABELS: Record<DirectorStage, string> = {
  understanding: "理解",
  prompting: "最终提示词",
};

type DirectorAttachmentKind = "image" | "video" | "audio";

interface DirectorAttachmentDraft {
  readonly assetId: string;
  readonly name: string;
  readonly kind: DirectorAttachmentKind;
  readonly mimeType: string;
  readonly size: number;
}

const DIRECTOR_ATTACHMENT_LIMIT_BYTES = 16 * 1024 * 1024;
const DIRECTOR_ATTACHMENT_TOTAL_LIMIT_BYTES = 24 * 1024 * 1024;
const DIRECTOR_ATTACHMENT_LIMIT = 3;
const DIRECTOR_SESSION_STORAGE_PREFIX = "super-canvas:director-session:";

function directorSessionStorageKey(canvasId: string): string {
  return `${DIRECTOR_SESSION_STORAGE_PREFIX}${canvasId}`;
}

function readStoredDirectorSession(canvasId: string): string | undefined {
  if (typeof window === "undefined" || !canvasId) return undefined;
  try {
    return window.localStorage.getItem(directorSessionStorageKey(canvasId)) ??
      undefined;
  } catch {
    return undefined;
  }
}

function storeDirectorSession(canvasId: string, sessionId: string | undefined) {
  if (typeof window === "undefined" || !canvasId) return;
  try {
    const key = directorSessionStorageKey(canvasId);
    if (sessionId) window.localStorage.setItem(key, sessionId);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage is optional and must not block the workbench.
  }
}

function attachmentKindForFile(file: File): DirectorAttachmentKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

function modelSupportsAttachment(
  model: ModelDescriptor | undefined,
  capabilities: DirectorPublicProfile["capabilities"],
  protocol: DirectorProtocol | undefined,
  kind: DirectorAttachmentKind,
): boolean {
  const protocolSupports =
    kind === "image"
      ? true
      : kind === "audio"
        ? protocol === "google-generate-content" ||
          protocol === "openai-chat-completions" ||
          protocol === "generic-openai-compatible"
        : protocol === "google-generate-content";
  if (!protocolSupports) return false;
  const capabilityKnown =
    capabilities &&
    (capabilities.probeSource === "live" ||
      capabilities.probeSource === "provider-catalog");
  if (capabilityKnown) {
    const capabilitySupported =
      kind === "image"
        ? capabilities.imageInput
        : kind === "video"
          ? capabilities.videoInput
          : capabilities.audioInput;
    // A live probe is authoritative. A catalog declaration can add a media
    // input, but a generic text-only listing must not override a live result.
    if (capabilities.probeSource === "live") return capabilitySupported;
    if (capabilitySupported) return true;
  }
  if (model?.inputKinds && model.inputKinds.length > 0)
    return model.inputKinds.some(
      (inputKind) => inputKind === kind || inputKind === kind + "[]",
    );
  if (
    !capabilities ||
    (capabilities.probeSource !== "live" &&
      capabilities.probeSource !== "provider-catalog")
  )
    return false;
  if (kind === "image") return capabilities.imageInput;
  if (kind === "video") return capabilities.videoInput;
  return capabilities.audioInput;
}

const DIRECTOR_ATTACHMENT_ACCEPT: Record<DirectorAttachmentKind, string> = {
  image: "image/png,image/jpeg,image/webp,image/gif",
  video: "video/mp4,video/quicktime,video/webm",
  audio: "audio/mpeg,audio/wav,audio/mp4",
};

function modelMetadataBoolean(
  model: ModelDescriptor | undefined,
  keys: readonly string[],
): boolean | undefined {
  const metadata = model?.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function capabilitiesForModel(
  model: ModelDescriptor | undefined,
  protocol: DirectorProtocol | undefined,
): DirectorModelCapabilities | undefined {
  if (!model) return undefined;
  const inputKinds = new Set(model.inputKinds ?? []);
  const supportsInput = (kind: "image" | "audio" | "video") =>
    inputKinds.has(kind) || inputKinds.has(`${kind}[]` as never);
  const structuredOutput =
    modelMetadataBoolean(model, [
      "structuredOutput",
      "structured_output",
      "jsonSchema",
      "json_schema",
    ]) ??
    (protocol !== "generic-openai-compatible");
  const toolCalling =
    modelMetadataBoolean(model, [
      "toolCalling",
      "tool_calling",
      "functionCalling",
      "function_calling",
    ]) ?? protocol === "anthropic-messages";
  return {
    text: inputKinds.size === 0 || inputKinds.has("text"),
    imageInput: supportsInput("image"),
    audioInput: supportsInput("audio"),
    videoInput: supportsInput("video"),
    structuredOutput,
    toolCalling,
    nativeWebSearch:
      modelMetadataBoolean(model, ["nativeWebSearch", "native_web_search"]) ??
      false,
    reasoning:
      modelMetadataBoolean(model, ["reasoning", "supportsReasoning"]) ?? false,
    probedAt: new Date().toISOString(),
    probeSource: "provider-catalog",
  };
}

const styles = {
  stageList: {
    display: "grid",
    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
    gap: 3,
    margin: "0 12px 10px",
    padding: 0,
    listStyle: "none",
  },
  stage: {
    minWidth: 0,
    minHeight: 40,
    padding: "5px 2px",
    border: "1px solid rgba(148, 163, 184, 0.2)",
    background: "rgba(15, 23, 42, 0.32)",
    color: "#7f8da3",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    fontSize: 10,
    lineHeight: 1.1,
    overflow: "hidden",
  },
  stageActive: {
    color: "#e8f3ee",
    borderColor: "rgba(45, 212, 191, 0.55)",
    background: "rgba(20, 83, 72, 0.28)",
  },
  stageComplete: {
    color: "#b9c6d2",
    borderColor: "rgba(74, 222, 128, 0.3)",
    background: "rgba(20, 83, 45, 0.15)",
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    minWidth: 0,
  },
  proposal: {
    border: "1px solid rgba(45, 212, 191, 0.32)",
    borderRadius: 8,
    background: "rgba(8, 20, 25, 0.72)",
    color: "#dce7e3",
    overflow: "hidden",
  },
  proposalHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    padding: "11px 12px",
    borderBottom: "1px solid rgba(148, 163, 184, 0.16)",
  },
  proposalSection: {
    padding: "10px 12px",
    borderBottom: "1px solid rgba(148, 163, 184, 0.13)",
  },
  sectionTitle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    margin: "0 0 7px",
    color: "#aebdca",
    fontSize: 11,
    fontWeight: 700,
  },
  call: {
    padding: "10px 0",
    borderTop: "1px solid rgba(148, 163, 184, 0.13)",
  },
  definitionList: {
    display: "grid",
    gridTemplateColumns: "76px minmax(0, 1fr)",
    gap: "5px 8px",
    margin: 0,
    fontSize: 11,
    lineHeight: 1.45,
  },
  definitionTerm: { color: "#718096" },
  definitionValue: {
    margin: 0,
    color: "#d5dee7",
    overflowWrap: "anywhere",
  },
  select: {
    width: "100%",
    minHeight: 34,
    marginTop: 8,
    padding: "0 8px",
    border: "1px solid rgba(148, 163, 184, 0.28)",
    borderRadius: 6,
    color: "#dce7e3",
    background: "#111a22",
    fontSize: 11,
  },
  source: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 8,
    padding: "8px 0",
    borderTop: "1px solid rgba(148, 163, 184, 0.12)",
    fontSize: 11,
  },
  sourceLink: {
    color: "#b9d9d1",
    textDecoration: "none",
    overflowWrap: "anywhere",
  },
  evidence: {
    color: "#8fa29d",
    fontSize: 10,
    whiteSpace: "nowrap",
  },
  warning: {
    display: "flex",
    alignItems: "flex-start",
    gap: 7,
    marginTop: 8,
    padding: "8px 9px",
    borderLeft: "2px solid #f59e0b",
    background: "rgba(120, 53, 15, 0.18)",
    color: "#f2ce91",
    fontSize: 11,
    lineHeight: 1.45,
  },
  actions: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto auto",
    gap: 7,
    padding: 12,
  },
  subtleButton: {
    minHeight: 34,
    padding: "0 10px",
    border: "1px solid rgba(148, 163, 184, 0.26)",
    borderRadius: 6,
    background: "rgba(30, 41, 59, 0.5)",
    color: "#c9d3dd",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    fontSize: 11,
    cursor: "pointer",
  },
  approveButton: {
    minHeight: 34,
    padding: "0 12px",
    border: "1px solid #31b49a",
    borderRadius: 6,
    background: "#16806e",
    color: "#f5fffc",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
  },
  total: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    color: "#9fb0bc",
    fontSize: 11,
  },
  totalValue: { color: "#f2d59d", fontSize: 18, fontWeight: 750 },
  inlineConfig: {
    margin: "10px 12px 0",
    padding: "11px 11px 10px",
    border: "1px solid rgba(141, 154, 188, 0.24)",
    borderRadius: 12,
    background:
      "linear-gradient(145deg, rgba(28, 33, 50, 0.9), rgba(17, 22, 34, 0.86))",
    boxShadow: "inset 0 1px rgba(255, 255, 255, 0.035)",
  },
  inlineConfigHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 8,
  },
  inlineConfigTitle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "#d9d5ff",
    fontSize: 11,
    fontWeight: 750,
  },
  inlineConfigHint: {
    marginTop: 2,
    color: "#7f8ba2",
    fontSize: 9,
    lineHeight: 1.35,
  },
  inlineConfigGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 7,
  },
  inlineConfigField: {
    minWidth: 0,
    display: "grid",
    gap: 4,
  },
  inlineConfigFieldWide: { gridColumn: "1 / -1" },
  inlineConfigLabel: {
    color: "#8f9bb1",
    fontSize: 9,
  },
  inlineConfigSelect: {
    width: "100%",
    minWidth: 0,
    height: 31,
    border: "1px solid rgba(143, 157, 190, 0.24)",
    borderRadius: 7,
    padding: "0 7px",
    background: "rgba(9, 13, 22, 0.75)",
    color: "#dfe5f3",
    outline: "none",
    fontSize: 10,
    colorScheme: "dark",
  },
  inlineConfigFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 8,
  },
  inlineConfigStatus: {
    minWidth: 0,
    color: "#8d9bad",
    fontSize: 9,
    lineHeight: 1.35,
    overflowWrap: "anywhere",
  },
  inlineConfigSave: {
    flex: "0 0 auto",
    minHeight: 29,
    padding: "0 9px",
    border: "1px solid rgba(111, 224, 194, 0.42)",
    borderRadius: 7,
    background: "rgba(22, 128, 110, 0.76)",
    color: "#effff9",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    fontSize: 10,
    fontWeight: 700,
    cursor: "pointer",
  },
  inlineConfigSaveDisabled: {
    borderColor: "rgba(139, 152, 184, 0.18)",
    background: "rgba(46, 53, 69, 0.76)",
    color: "#737e93",
    cursor: "not-allowed",
  },
  composerConfig: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    padding: "7px 9px 0",
    borderTop: "1px solid rgba(141, 154, 188, 0.12)",
    overflowX: "auto",
    scrollbarWidth: "thin",
  },
  composerConfigIcon: {
    flex: "0 0 auto",
    color: "#a99cff",
  },
  composerConfigSelect: {
    flex: "1 1 0",
    width: 0,
    minWidth: 64,
    height: 28,
    border: "1px solid rgba(143, 157, 190, 0.24)",
    borderRadius: 7,
    padding: "0 5px",
    background: "rgba(9, 13, 22, 0.75)",
    color: "#dfe5f3",
    outline: "none",
    fontSize: 9,
    colorScheme: "dark",
  },
  composerConfigSelectModel: { flexGrow: 1.35, minWidth: 112 },
  composerConfigSelectReasoning: { flexGrow: 0.85, minWidth: 76 },
  composerConfigEmpty: {
    flex: "1 1 auto",
    minWidth: 0,
    color: "#8d9bad",
    fontSize: 9,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  composerConfigStatus: {
    flex: "0 0 auto",
    maxWidth: 170,
    minWidth: 0,
    color: "#8d9bad",
    fontSize: 9,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sessionControls: {
    flex: "1 1 auto",
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 5,
    minWidth: 0,
  },
  sessionToolbar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    padding: "6px 12px",
    borderBottom: "1px solid rgba(141, 154, 188, 0.12)",
    background: "rgba(12, 16, 25, 0.35)",
  },
  sessionSelect: {
    flex: "1 1 0",
    width: "auto",
    minWidth: 96,
    height: 30,
    padding: "0 6px",
    border: "1px solid rgba(143, 157, 190, 0.24)",
    borderRadius: 7,
    background: "rgba(9, 13, 22, 0.72)",
    color: "#cbd4e5",
    outline: "none",
    fontSize: 10,
    colorScheme: "dark",
  },
  newSessionButton: {
    minHeight: 30,
    padding: "0 8px",
    border: "1px solid rgba(143, 157, 190, 0.24)",
    borderRadius: 7,
    background: "rgba(30, 41, 59, 0.5)",
    color: "#d8dff0",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    fontSize: 10,
    cursor: "pointer",
  },
} satisfies Record<string, CSSProperties>;

function upsertById<T extends { readonly id: string }>(
  items: readonly T[],
  value: T,
): T[] {
  const index = items.findIndex((item) => item.id === value.id);
  if (index < 0) return [...items, value];
  const next = [...items];
  next[index] = value;
  return next;
}

function displayTime(value: string | undefined): string {
  if (!value) return "未提供";
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(time)
    : value;
}

function inferredDirectorProtocol(
  connection: ProviderConnectionView | undefined,
): DirectorProtocol | undefined {
  const configured = connection?.config.directorProtocol;
  if (
    configured === "openai-responses" ||
    configured === "openai-chat-completions" ||
    configured === "anthropic-messages" ||
    configured === "google-generate-content" ||
    configured === "xai-responses" ||
    configured === "generic-openai-compatible"
  )
    return configured;
  switch (connection?.config.protocol) {
    case "responses":
    case "openai-responses":
      return "openai-responses";
    case "chat-completions":
    case "openai-chat-completions":
      return "openai-chat-completions";
    case "anthropic-messages":
      return "anthropic-messages";
    case "google-generate-content":
      return "google-generate-content";
    case "xai-responses":
      return "xai-responses";
    default:
      return connection ? "generic-openai-compatible" : undefined;
  }
}

export function SuperDirectorPanel({
  connections,
  assets,
  canvasId,
  draftRequest,
  onManageApi,
  viewport,
  onPreviewPatch,
}: SuperDirectorPanelProps) {
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const streamErrorRef = useRef<string | null>(null);
  const previewPatchRef = useRef(onPreviewPatch);
  const [profile, setProfile] = useState<DirectorPublicProfile | null>(null);
  const [messages, setMessages] = useState<DirectorPublicMessage[]>([]);
  const [conversations, setConversations] = useState<DirectorConversationSummary[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [stage, setStage] = useState<DirectorStage>("understanding");
  const [stageMessage, setStageMessage] = useState("");
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<DirectorAttachmentDraft[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [hydrating, setHydrating] = useState(true);
  const [sessionSwitching, setSessionSwitching] = useState(false);
  const [supplierChoice, setSupplierChoice] = useState("");
  const [groupChoice, setGroupChoice] = useState("");
  const [modelChoice, setModelChoice] = useState("");
  const [reasoningChoice, setReasoningChoice] =
    useState<DirectorReasoningEffort>("auto");
  const [modelsState, setModelsState] = useState<{
    connectionId: string;
    items: ModelDescriptor[];
    error: string;
  }>({ connectionId: "", items: [], error: "" });
  const [modelsLoading, setModelsLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configStatus, setConfigStatus] = useState("");
  const modelRequestRef = useRef(0);
  const handledDraftId = useRef<string | undefined>(undefined);
  const handledDraftAssetId = useRef<string | undefined>(undefined);

  useEffect(() => {
    previewPatchRef.current = onPreviewPatch;
  }, [onPreviewPatch]);

  const currentStage = stage;

  const brainConnections = useMemo(
    () => directorBrainConnections(connections),
    [connections],
  );
  const suppliers = useMemo(
    () =>
      Array.from(new Set(brainConnections.map(providerConnectionSupplierKey))),
    [brainConnections],
  );
  const supplier = suppliers.includes(supplierChoice)
    ? supplierChoice
    : (suppliers[0] ?? "");
  const supplierConnections = useMemo(
    () =>
      brainConnections.filter(
        (connection) => providerConnectionSupplierKey(connection) === supplier,
      ),
    [brainConnections, supplier],
  );
  const groups = useMemo(
    () => Array.from(new Set(supplierConnections.map(providerConnectionGroup))),
    [supplierConnections],
  );
  const group = groups.includes(groupChoice) ? groupChoice : (groups[0] ?? "");
  const selectedConnection = findProviderGroupConnection(
    brainConnections,
    supplier,
    group,
    "agent",
  );
  const connectionId = selectedConnection?.id ?? "";
  const configuredModels = useMemo(
    () =>
      ensureDirectorModel(
        directorConfiguredModelInventory(selectedConnection),
        profile?.brainConnectionId === selectedConnection?.id
          ? profile?.brainModelId
          : undefined,
      ),
    [profile, selectedConnection],
  );
  const models = useMemo(
    () =>
      modelsState.connectionId === connectionId
        ? mergeDirectorModelInventory(configuredModels, modelsState.items)
        : [...configuredModels.models],
    [configuredModels, connectionId, modelsState],
  );
  const textModels = useMemo(
    () => models.filter(directorModelSupportsText),
    [models],
  );
  const selectedModelId = preferredDirectorModelId(textModels, modelChoice);
  const selectedModel = models.find((model) => model.id === selectedModelId);
  const protocol =
    profile?.brainConnectionId === connectionId && profile.protocol
      ? profile.protocol
      : inferredDirectorProtocol(selectedConnection);
  const availableReasoningOptions = useMemo(
    () =>
      directorReasoningOptions(
        selectedModel,
        protocol,
        profile?.brainConnectionId === connectionId &&
          profile?.brainModelId === selectedModelId
          ? profile.capabilities
          : undefined,
      ),
    [
      connectionId,
      profile?.brainConnectionId,
      profile?.brainModelId,
      profile?.capabilities,
      protocol,
      selectedModel,
      selectedModelId,
    ],
  );
  const reasoningEffort = availableReasoningOptions.some(
    (option) => option.value === reasoningChoice,
  )
    ? reasoningChoice
    : "auto";
  const directorCapabilities =
    profile?.brainConnectionId === connectionId &&
    profile?.brainModelId === selectedModelId
      ? profile.capabilities
      : undefined;
  const supportedAttachmentKinds = useMemo(
    () =>
      (
        Object.keys(DIRECTOR_ATTACHMENT_ACCEPT) as DirectorAttachmentKind[]
      ).filter((kind) =>
        modelSupportsAttachment(
          selectedModel,
          directorCapabilities,
          protocol,
          kind,
        ),
      ),
    [directorCapabilities, protocol, selectedModel],
  );
  const attachmentAccept = supportedAttachmentKinds
    .map((kind) => DIRECTOR_ATTACHMENT_ACCEPT[kind])
    .join(",");
  const incompatibleAttachment = attachments.find(
    (attachment) => !supportedAttachmentKinds.includes(attachment.kind),
  );
  const configDirty =
    Boolean(profile?.configured) &&
    (connectionId !== (profile?.brainConnectionId ?? "") ||
      selectedModelId !== (profile?.brainModelId ?? "") ||
      (reasoningEffort === "auto" ? "" : reasoningEffort) !==
        (profile?.reasoningEffort === "auto"
          ? ""
          : (profile?.reasoningEffort ?? "")));
  const modelStatus = modelsLoading
    ? "正在读取该分组的模型目录…"
    : modelsState.error
      ? modelsState.error
      : models.length > 0
        ? `已加载 ${textModels.length} 个文本模型`
        : "该分组暂无可用模型";

  useEffect(() => {
    if (!profile) return;
    const configuredConnection = brainConnections.find(
      (connection) => connection.id === profile.brainConnectionId,
    );
    if (!configuredConnection) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setSupplierChoice(providerConnectionSupplierKey(configuredConnection));
      setGroupChoice(providerConnectionGroup(configuredConnection));
      setModelChoice(profile.brainModelId ?? "");
      setReasoningChoice(
        (profile.reasoningEffort as DirectorReasoningEffort | undefined) ??
          "auto",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [brainConnections, profile]);

  useEffect(() => {
    const requestId = ++modelRequestRef.current;
    if (!connectionId || !selectedConnection) {
      queueMicrotask(() => {
        if (modelRequestRef.current !== requestId) return;
        setModelsLoading(false);
        setModelsState({ connectionId: "", items: [], error: "" });
      });
      return;
    }
    const configured = directorConfiguredModelInventory(selectedConnection);
    queueMicrotask(() => {
      if (modelRequestRef.current !== requestId) return;
      setModelsState({
        connectionId,
        items: [...configured.models],
        error: "",
      });
    });
    queueMicrotask(() => {
      if (modelRequestRef.current === requestId) setModelsLoading(true);
    });
    void fetchModels(connectionId)
      .then((fetched) => {
        if (modelRequestRef.current !== requestId) return;
        setModelsState({ connectionId, items: fetched, error: "" });
      })
      .catch((loadError: unknown) => {
        if (modelRequestRef.current !== requestId) return;
        setModelsState({
          connectionId,
          items: [...configured.models],
          error:
            configured.models.length > 0
              ? "实时模型目录暂不可用，当前显示已保存模型"
              : loadError instanceof Error
                ? loadError.message
                : "模型目录读取失败",
        });
      })
      .finally(() => {
        if (modelRequestRef.current === requestId) setModelsLoading(false);
      });
    return () => {
      if (modelRequestRef.current === requestId) modelRequestRef.current += 1;
    };
  }, [connectionId, selectedConnection]);

  useEffect(() => {
    if (
      !availableReasoningOptions.some(
        (option) => option.value === reasoningChoice,
      )
    )
      queueMicrotask(() => setReasoningChoice("auto"));
  }, [availableReasoningOptions, reasoningChoice]);

  const loadConversation = useCallback(async () => {
    if (!canvasId) return;
    setHydrating(true);
    setError("");
    try {
      const [nextProfile, nextConversations] = await Promise.all([
        fetchDirectorProfile(),
        fetchDirectorConversations(canvasId),
      ]);
      const storedSessionId = readStoredDirectorSession(canvasId);
      const conversation =
        nextConversations.find(
          (item) => item.session.id === storedSessionId,
        ) ?? nextConversations[0] ?? null;
      setProfile(nextProfile);
      setConversations(nextConversations.map((item) => item.session));
      setMessages(conversation ? [...conversation.messages] : []);
      setSessionId(conversation?.session.id);
      storeDirectorSession(canvasId, conversation?.session.id);
      previewPatchRef.current?.(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "无法读取超级导演会话",
      );
    } finally {
      setHydrating(false);
    }
  }, [canvasId]);

  const switchConversation = useCallback(
    async (nextSessionId: string) => {
      if (!canvasId || !nextSessionId || nextSessionId === sessionId) return;
      setSessionSwitching(true);
      setError("");
      try {
        const conversation = await fetchDirectorConversation(
          canvasId,
          nextSessionId,
        );
        if (!conversation) throw new Error("导演会话不存在或已被删除");
        setSessionId(conversation.session.id);
        setMessages([...conversation.messages]);
        setStage("understanding");
        setStageMessage("");
        storeDirectorSession(canvasId, conversation.session.id);
        previewPatchRef.current?.(null);
      } catch (switchError) {
        setError(
          switchError instanceof Error
            ? switchError.message
            : "无法切换导演会话",
        );
      } finally {
        setSessionSwitching(false);
      }
    },
    [canvasId, sessionId],
  );

  const startNewConversation = useCallback(async () => {
    if (!canvasId || submitting || sessionSwitching) return;
    setSessionSwitching(true);
    setError("");
    try {
      const conversation = await createDirectorConversation(canvasId);
      setConversations((current) => [
        conversation.session,
        ...current.filter((item) => item.id !== conversation.session.id),
      ]);
      setSessionId(conversation.session.id);
      storeDirectorSession(canvasId, conversation.session.id);
      setMessages([]);
      setStage("understanding");
      setStageMessage("");
      setDraft("");
      setAttachments([]);
      setAttachmentError("");
      previewPatchRef.current?.(null);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (newConversationError) {
      setError(
        newConversationError instanceof Error
          ? newConversationError.message
          : "无法新建导演对话",
      );
    } finally {
      setSessionSwitching(false);
    }
  }, [canvasId, sessionSwitching, submitting]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadConversation();
    });
    return () => {
      active = false;
      requestRef.current?.abort();
    };
  }, [loadConversation]);

  useEffect(() => {
    if (!draftRequest || handledDraftId.current === draftRequest.id) return;
    handledDraftId.current = draftRequest.id;
    setDraft(draftRequest.text);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [draftRequest]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const conversation = conversationRef.current;
      if (conversation) conversation.scrollTop = conversation.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [error, messages, stageMessage]);

  const addAttachments = useCallback(
    async (files: FileList | File[]) => {
      const incoming = Array.from(files);
      if (!incoming.length || attachmentBusy) return;
      setAttachmentError("");
      if (!selectedModelId || supportedAttachmentKinds.length === 0) {
        setAttachmentError("当前导演模型不支持图片、视频或音频输入");
        return;
      }
      if (attachments.length + incoming.length > DIRECTOR_ATTACHMENT_LIMIT) {
        setAttachmentError(
          `一次最多添加 ${DIRECTOR_ATTACHMENT_LIMIT} 个导演附件`,
        );
        return;
      }
      const currentBytes = attachments.reduce(
        (sum, item) => sum + item.size,
        0,
      );
      let incomingBytes = 0;
      const prepared: File[] = [];
      for (const file of incoming) {
        const kind = attachmentKindForFile(file);
        if (!kind) {
          setAttachmentError(`${file.name} 不是受支持的图片、视频或音频文件`);
          return;
        }
        if (!supportedAttachmentKinds.includes(kind)) {
          setAttachmentError(
            `当前模型不支持${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}输入，请更换模型后再添加`,
          );
          return;
        }
        if (file.size <= 0 || file.size > DIRECTOR_ATTACHMENT_LIMIT_BYTES) {
          setAttachmentError(`${file.name} 不能超过 16 MB`);
          return;
        }
        incomingBytes += file.size;
        prepared.push(file);
      }
      if (
        currentBytes + incomingBytes >
        DIRECTOR_ATTACHMENT_TOTAL_LIMIT_BYTES
      ) {
        setAttachmentError("导演附件总大小不能超过 24 MB");
        return;
      }
      setAttachmentBusy(true);
      try {
        const uploaded: DirectorAttachmentDraft[] = [];
        for (const file of prepared) {
          const asset = await uploadAsset(file);
          const kind = attachmentKindForFile(file);
          if (!kind) continue;
          uploaded.push({
            assetId: asset.id,
            name: asset.name,
            kind,
            mimeType: asset.mimeType,
            size: asset.size,
          });
        }
        setAttachments((current) => [...current, ...uploaded]);
      } catch (uploadError) {
        setAttachmentError(
          uploadError instanceof Error ? uploadError.message : "附件上传失败",
        );
      } finally {
        setAttachmentBusy(false);
      }
    },
    [attachmentBusy, attachments, selectedModelId, supportedAttachmentKinds],
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const assetId = draftRequest?.assetId;
      if (!assetId || handledDraftAssetId.current === assetId) return;
      handledDraftAssetId.current = assetId;
      const asset = assets.find((item) => item.id === assetId);
      if (
        !asset ||
        (asset.kind !== "image" &&
          asset.kind !== "video" &&
          asset.kind !== "audio")
      )
        return;
      if (!supportedAttachmentKinds.includes(asset.kind)) {
        setAttachmentError(
          "当前模型不支持" +
            (asset.kind === "image"
              ? "图片"
              : asset.kind === "video"
                ? "视频"
                : "音频") +
            "输入，请更换模型后再反推。",
        );
        return;
      }
      if (asset.size <= 0 || asset.size > DIRECTOR_ATTACHMENT_LIMIT_BYTES) {
        setAttachmentError("反推素材不能超过 16 MB");
        return;
      }
      if (attachments.some((item) => item.assetId === asset.id)) return;
      if (attachments.length >= DIRECTOR_ATTACHMENT_LIMIT) {
        setAttachmentError(
          "一次最多添加 " + DIRECTOR_ATTACHMENT_LIMIT + " 个导演附件",
        );
        return;
      }
      const total =
        attachments.reduce((sum, item) => sum + item.size, 0) + asset.size;
      if (total > DIRECTOR_ATTACHMENT_TOTAL_LIMIT_BYTES) {
        setAttachmentError("导演附件总大小不能超过 24 MB");
        return;
      }
      setAttachmentError("");
      setAttachments([
        ...attachments,
        {
          assetId: asset.id,
          name: asset.name,
          kind: asset.kind,
          mimeType: asset.mimeType,
          size: asset.size,
        },
      ]);
    });
    return () => {
      active = false;
    };
  }, [assets, attachments, draftRequest?.assetId, supportedAttachmentKinds]);

  const receiveEvent = useCallback((event: DirectorTurnEvent) => {
    const rememberSession = (nextSessionId: string) => {
      setSessionId(nextSessionId);
      storeDirectorSession(canvasId, nextSessionId);
    };
    if (event.type === "stage") {
      setStage(event.stage);
      setStageMessage(event.message);
      return;
    }
    if (event.type === "source" || event.type === "proposal") return;
    if (event.type === "message") {
      setMessages((current) => upsertById(current, event.message));
      rememberSession(event.message.sessionId);
      return;
    }
    if (event.type === "error") {
      streamErrorRef.current = event.message;
      setError(event.message);
      return;
    }
    rememberSession(event.sessionId);
  }, [canvasId]);

  const selectSupplier = (nextSupplier: string) => {
    setSupplierChoice(nextSupplier);
    setGroupChoice("");
    setModelChoice("");
    setReasoningChoice("auto");
    setConfigStatus("");
  };

  const selectGroup = (nextGroup: string) => {
    setGroupChoice(nextGroup);
    setModelChoice("");
    setReasoningChoice("auto");
    setConfigStatus("");
  };

  const saveConfig = async () => {
    if (!connectionId || !selectedModelId || configSaving) return;
    setConfigSaving(true);
    setConfigStatus("");
    try {
      const modelCapabilities = capabilitiesForModel(
        selectedModel,
        protocol,
      );
      const saved = await saveDirectorProfile({
        brainConnectionId: connectionId,
        brainModelId: selectedModelId,
        ...(protocol ? { protocol } : {}),
        ...(modelCapabilities ? { capabilities: modelCapabilities } : {}),
        ...(profile?.researchConnectionId
          ? { researchConnectionId: profile.researchConnectionId }
          : {}),
        reasoningEffort: reasoningEffort === "auto" ? null : reasoningEffort,
      });
      setProfile(saved);
      setConfigStatus("导演大脑配置已保存");
    } catch (saveError) {
      setConfigStatus(
        saveError instanceof Error ? saveError.message : "导演配置保存失败",
      );
    } finally {
      setConfigSaving(false);
    }
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const message =
      draft.trim() ||
      (attachments.length ? "请分析这些附件并完成导演任务。" : "");
    if (
      !message ||
      submitting ||
      requestRef.current ||
      attachmentBusy ||
      !canvasId
    )
      return;
    if (!profile?.connected) {
      setError("导演大脑尚未连接，请先完成 API 配置。");
      return;
    }
    if (incompatibleAttachment) {
      setError(
        "当前模型不支持" +
          (incompatibleAttachment.kind === "image"
            ? "图片"
            : incompatibleAttachment.kind === "video"
              ? "视频"
              : "音频") +
          "附件，请移除或更换模型。",
      );
      return;
    }
    if (!connectionId || !selectedModelId) {
      setError("请先在下方选择供应商、分组和模型。");
      return;
    }
    if (configDirty || !profile.configured) {
      setError("导演配置有改动，请先点击“保存配置”后再发送。");
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setSubmitting(true);
    setError("");
    setStage("understanding");
    setStageMessage("正在理解目标");
    setDraft("");
    streamErrorRef.current = null;
    previewPatchRef.current?.(null);
    try {
      await streamDirectorTurn(
        {
          canvasId,
          ...(sessionId ? { sessionId } : {}),
          message,
          ...(attachments.length
            ? {
                attachmentAssetIds: attachments.map(
                  (attachment) => attachment.assetId,
                ),
              }
            : {}),
          ...(viewport ? { viewport } : {}),
        },
        receiveEvent,
        controller.signal,
      );
      if (streamErrorRef.current) {
        setError(streamErrorRef.current);
        setDraft(message);
        return;
      }
      await loadConversation();
      setAttachments([]);
      setAttachmentError("");
    } catch (submitError) {
      if (controller.signal.aborted) return;
      setError(
        submitError instanceof Error ? submitError.message : "超级导演处理失败",
      );
      setDraft(message);
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      setSubmitting(false);
    }
  };

  const stageIndex = DIRECTOR_STAGES.indexOf(currentStage);
  const profileConnection = connections.find(
    (connection) => connection.id === profile?.brainConnectionId,
  );

  return (
    <div className="agent-panel">
      <header className="agent-panel-head">
        <span className="agent-panel-icon">
          <BrainCircuit size={17} />
        </span>
        <div style={{ minWidth: 0 }}>
          <strong>超级导演</strong>
          <small title={profile?.brainModelId}>
            {profile?.configured
              ? `${profile.brainConnectionName ?? profileConnection?.name ?? "导演大脑"} · ${profile.brainModelId ?? "模型待定"}`
              : "导演大脑未配置"}
          </small>
        </div>
        <button
          type="button"
          className="agent-new-chat"
          onClick={() => onManageApi()}
          title="管理供应商连接"
          aria-label="管理供应商连接"
        >
          {profile?.connected ? <Check size={13} /> : <KeyRound size={13} />}
          <span>{profile?.connected ? "已连接" : "配置"}</span>
        </button>
      </header>

      <div style={styles.sessionToolbar} aria-label="导演会话">
        <div style={styles.sessionControls}>
          <button
            type="button"
            style={styles.newSessionButton}
            onClick={() => void startNewConversation()}
            disabled={hydrating || submitting || sessionSwitching}
            title="新开一个导演对话"
            aria-label="新开对话"
          >
            <MessageSquarePlus size={13} />
            <span>新对话</span>
          </button>
          <select
            aria-label="历史对话"
            title="切换历史对话"
            style={styles.sessionSelect}
            value={sessionId ?? ""}
            onChange={(event) => void switchConversation(event.target.value)}
            disabled={
              hydrating ||
              submitting ||
              sessionSwitching ||
              conversations.length === 0
            }
          >
            {conversations.length === 0 ? (
              <option value="">暂无历史</option>
            ) : (
              <option value="">历史对话</option>
            )}
            {conversations.map((conversation) => (
              <option value={conversation.id} key={conversation.id}>
                {(conversation.title || "未命名对话").slice(0, 18)} · {displayTime(conversation.updatedAt)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ol style={styles.stageList} aria-label="导演处理阶段">
        {DIRECTOR_STAGES.map((item, index) => {
          const active =
            item === currentStage && submitting;
          const complete = index < stageIndex;
          return (
            <li
              key={item}
              style={{
                ...styles.stage,
                ...(active ? styles.stageActive : {}),
                ...(complete ? styles.stageComplete : {}),
              }}
              aria-current={active ? "step" : undefined}
            >
              {active && submitting ? (
                <LoaderCircle size={11} className="spin" />
              ) : complete ? (
                <Check size={11} />
              ) : (
                <Circle size={8} />
              )}
              <span>{STAGE_LABELS[item]}</span>
            </li>
          );
        })}
      </ol>

      <div
        className="agent-conversation"
        ref={conversationRef}
        aria-live="polite"
      >
        {hydrating ? (
          <div className="agent-message assistant">
            <LoaderCircle size={14} className="spin" />
            <p>正在恢复导演会话</p>
          </div>
        ) : null}

        {!hydrating && messages.length === 0 ? (
          <div className="agent-message assistant">
            <BrainCircuit size={14} />
            <p>描述你想要的画面，我会根据超级导演 Skill 输出最终提示词。</p>
          </div>
        ) : null}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`agent-message ${message.role === "user" ? "user" : "assistant"}`}
          >
            {message.role === "assistant" ? <BrainCircuit size={14} /> : null}
            <p style={{ whiteSpace: "pre-wrap" }}>{message.content}</p>
          </div>
        ))}

        {submitting ? (
          <div className="agent-message assistant">
            <LoaderCircle size={14} className="spin" />
            <p>{stageMessage || "超级导演正在处理"}</p>
          </div>
        ) : null}

        {error ? (
          <div className="agent-message error" role="alert">
            <AlertTriangle size={14} />
            <p>{error}</p>
          </div>
        ) : null}
      </div>

      <form className="agent-composer" onSubmit={(event) => void submit(event)}>
        <input
          ref={fileInputRef}
          className="agent-file-input"
          type="file"
          accept={attachmentAccept}
          multiple
          onChange={(event) => {
            if (event.target.files) void addAttachments(event.target.files);
            event.currentTarget.value = "";
          }}
        />
        {attachments.length > 0 ? (
          <>
            <div
              className="agent-attachments-summary"
              aria-label="导演附件类型统计"
            >
              {(["image", "video", "audio"] as const).map((kind) => {
                const count = attachments.filter(
                  (item) => item.kind === kind,
                ).length;
                if (!count) return null;
                const Icon =
                  kind === "image"
                    ? ImageIcon
                    : kind === "video"
                      ? FileVideo
                      : FileAudio;
                return (
                  <span key={kind}>
                    <Icon size={12} />{" "}
                    {kind === "image"
                      ? "图片"
                      : kind === "video"
                        ? "视频"
                        : "音频"}{" "}
                    {count}
                  </span>
                );
              })}
            </div>
            <div className="agent-attachments" aria-label="已添加导演附件">
              {attachments.map((attachment) => {
                const Icon =
                  attachment.kind === "image"
                    ? ImageIcon
                    : attachment.kind === "video"
                      ? FileVideo
                      : FileAudio;
                return (
                  <div
                    className={"agent-attachment " + attachment.kind}
                    key={attachment.assetId}
                  >
                    <Icon size={13} />
                    <span title={attachment.name}>{attachment.name}</span>
                    <button
                      type="button"
                      aria-label={"移除附件 " + attachment.name}
                      onClick={() =>
                        setAttachments((current) =>
                          current.filter(
                            (item) => item.assetId !== attachment.assetId,
                          ),
                        )
                      }
                      disabled={submitting || attachmentBusy}
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="描述目标，我会输出最终图片/视频提示词…"
          aria-label="给超级导演的要求"
          disabled={submitting}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <section style={styles.composerConfig} aria-label="超级导演模型配置">
          <KeyRound
            size={13}
            style={styles.composerConfigIcon}
            aria-hidden="true"
          />
          {brainConnections.length === 0 ? (
            <>
              <span style={styles.composerConfigEmpty}>
                尚未配置可用的供应商 Key
              </span>
              <button
                type="button"
                className="agent-new-chat"
                onClick={() => onManageApi()}
                disabled={configSaving || submitting}
                title="管理供应商连接和 API Key"
              >
                管理连接
              </button>
            </>
          ) : (
            <>
              <select
                aria-label="超级导演供应商"
                title="供应商"
                style={styles.composerConfigSelect}
                value={supplier}
                onChange={(event) => selectSupplier(event.target.value)}
                disabled={configSaving || submitting}
              >
                {suppliers.map((item) => (
                  <option value={item} key={item}>
                    {providerSupplierLabel(item)}
                  </option>
                ))}
              </select>
              <select
                aria-label="超级导演供应商分组"
                title="Key 分组"
                style={styles.composerConfigSelect}
                value={group}
                onChange={(event) => selectGroup(event.target.value)}
                disabled={configSaving || submitting || groups.length === 0}
              >
                {groups.map((item) => {
                  const connection = supplierConnections.find(
                    (candidate) => providerConnectionGroup(candidate) === item,
                  );
                  return (
                    <option value={item} key={item}>
                      {providerGroupLabel(item)}
                      {connection?.apiKeyUsable === false ? "（待验证）" : ""}
                    </option>
                  );
                })}
              </select>
              <select
                aria-label="超级导演模型"
                title="模型"
                style={{
                  ...styles.composerConfigSelect,
                  ...styles.composerConfigSelectModel,
                }}
                value={selectedModelId}
                onChange={(event) => {
                  setModelChoice(event.target.value);
                  setReasoningChoice("auto");
                  setConfigStatus("");
                }}
                disabled={
                  configSaving ||
                  submitting ||
                  modelsLoading ||
                  textModels.length === 0
                }
              >
                {modelsLoading ? (
                  <option value="">读取模型…</option>
                ) : models.length === 0 ? (
                  <option value="">暂无模型</option>
                ) : (
                  textModels.map((model) => (
                    <option value={model.id} key={model.id}>
                      {model.name === model.id
                        ? model.id
                        : `${model.name} · ${model.id}`}
                    </option>
                  ))
                )}
              </select>
              {availableReasoningOptions.length > 1 ? (
                <select
                  aria-label="超级导演推理强度"
                  title="推理强度"
                  style={{
                    ...styles.composerConfigSelect,
                    ...styles.composerConfigSelectReasoning,
                  }}
                  value={reasoningEffort}
                  onChange={(event) => {
                    setReasoningChoice(
                      event.target.value as DirectorReasoningEffort,
                    );
                    setConfigStatus("");
                  }}
                  disabled={configSaving || submitting}
                >
                  {availableReasoningOptions.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                type="button"
                style={{
                  ...styles.inlineConfigSave,
                  ...((!connectionId ||
                    !selectedModelId ||
                    configSaving ||
                    submitting) &&
                    styles.inlineConfigSaveDisabled),
                }}
                onClick={() => void saveConfig()}
                disabled={
                  !connectionId ||
                  !selectedModelId ||
                  configSaving ||
                  submitting
                }
                title="保存导演大脑配置"
                aria-label="保存导演大脑配置"
              >
                {configSaving ? (
                  <LoaderCircle size={12} className="spin" />
                ) : (
                  <Check size={12} />
                )}
              </button>
            </>
          )}
        </section>
        {brainConnections.length > 0 ? (
          <span style={styles.composerConfigStatus} role="status">
            {configStatus || modelStatus}
          </span>
        ) : null}
        <div className="agent-composer-footer">
          <div className="agent-composer-tools">
            <button
              type="button"
              className="agent-attach"
              aria-label="添加图片、视频或音频附件"
              title={
                attachmentAccept
                  ? "上传图片、视频或音频"
                  : "当前模型不支持附件输入"
              }
              onClick={() => fileInputRef.current?.click()}
              disabled={
                submitting ||
                attachmentBusy ||
                !attachmentAccept ||
                attachments.length >= DIRECTOR_ATTACHMENT_LIMIT
              }
            >
              {attachmentBusy ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Paperclip size={14} />
              )}
            </button>
            <span
              style={{
                ...styles.statusRow,
                color: profile?.connected ? "#80b9aa" : "#c99662",
                fontSize: 10,
              }}
            >
              {profile?.connected ? (
                <Check size={11} />
              ) : (
                <AlertTriangle size={11} />
              )}
              {profile?.connected ? "大脑在线" : "等待配置"}
            </span>
          </div>
          <button
            type="submit"
            className="agent-send"
            disabled={
              (!draft.trim() && attachments.length === 0) ||
              submitting ||
              attachmentBusy ||
              !profile?.connected ||
              Boolean(incompatibleAttachment)
            }
            title="发送给超级导演"
            aria-label="发送给超级导演"
          >
            {submitting ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Send size={15} />
            )}
          </button>
        </div>
        {attachmentError || incompatibleAttachment ? (
          <small className="agent-attachment-error" role="alert">
            {attachmentError ||
              "当前模型不支持" +
                (incompatibleAttachment?.kind === "image"
                  ? "图片"
                  : incompatibleAttachment?.kind === "video"
                    ? "视频"
                    : "音频") +
                "附件，请移除或更换模型。"}
          </small>
        ) : null}
      </form>
    </div>
  );
}
