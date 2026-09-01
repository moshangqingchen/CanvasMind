"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  BrainCircuit,
  FileAudio,
  FileVideo,
  ImageIcon,
  KeyRound,
  LoaderCircle,
  Paperclip,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import type { ModelDescriptor } from "@super-canvas/providers";
import { appendPriceLabelOnce } from "../lib/model-display";
import {
  fetchCangyuanMarketplace,
  fetchModels,
  sendAgentChat,
  type AgentChatContentPartView,
  type CangyuanMarketplaceGroupView,
  type ProviderConnectionView,
} from "../lib/client-api";
import {
  agentApiHistory,
  agentHistoryStorageKey,
  legacyAgentHistoryStorageKey,
  successfulAgentHistory,
  type AgentHistoryMessage,
} from "../lib/agent-chat-history";
import {
  providerConnectionGroup,
  providerConnectionSupplierKey,
  providerConnectionUsage,
  providerGroupLabel,
  providerSupplierLabel,
} from "../lib/provider-connection-options";
import type { CanvasNode } from "./types";
import type { AssetView } from "./types";

const ASSET_DRAG_TYPE = "application/x-super-canvas-asset";

interface AgentDraftRequest {
  id: string;
  text: string;
  assetId?: string;
}

type AgentMessage = AgentHistoryMessage;

type ReasoningEffort =
  "auto" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

interface AgentAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "audio" | "video";
  dataUrl?: string;
  assetId?: string;
}

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENTS = 6;
const COMPOSER_MIN_HEIGHT = 92;
const COMPOSER_DEFAULT_HEIGHT = 92;
const COMPOSER_MAX_HEIGHT = 320;
const COMPOSER_HEIGHT_STORAGE_KEY = "super-canvas:agent-composer-height";

function clampComposerHeight(height: number): number {
  const viewportMaximum =
    typeof window === "undefined"
      ? COMPOSER_MAX_HEIGHT
      : Math.min(COMPOSER_MAX_HEIGHT, Math.max(160, window.innerHeight * 0.42));
  return Math.min(
    viewportMaximum,
    Math.max(COMPOSER_MIN_HEIGHT, Math.round(height)),
  );
}

function reasoningOptions(
  modelId: string,
): Array<{ value: ReasoningEffort; label: string }> {
  const common = [{ value: "auto" as const, label: "自动" }];
  const normalized = modelId.toLowerCase();
  if (/gpt-5\.6(?:-|$)/u.test(normalized))
    return [
      ...common,
      { value: "none", label: "无" },
      { value: "low", label: "低" },
      { value: "medium", label: "中" },
      { value: "high", label: "高" },
      { value: "xhigh", label: "超高" },
      { value: "max", label: "极限" },
    ];
  if (/gpt-5\.(?:4|5)(?:-|$)/u.test(normalized))
    return [
      ...common,
      { value: "none", label: "无" },
      { value: "low", label: "低" },
      { value: "medium", label: "中" },
      { value: "high", label: "高" },
      { value: "xhigh", label: "超高" },
    ];
  if (/gpt-5(?:\.|-|$)/u.test(normalized))
    return [
      ...common,
      { value: "minimal", label: "极低" },
      { value: "low", label: "低" },
      { value: "medium", label: "中" },
      { value: "high", label: "高" },
    ];
  return common;
}

function attachmentKind(file: File): AgentAttachment["kind"] | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("无法读取附件"));
    reader.onerror = () => reject(new Error("无法读取附件"));
    reader.readAsDataURL(file);
  });
}

function audioFormat(
  mimeType: string,
  filename: string,
): "wav" | "mp3" | "m4a" | "webm" | null {
  const normalized = `${mimeType} ${filename}`.toLowerCase();
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("m4a") || normalized.includes("mp4")) return "m4a";
  if (normalized.includes("webm")) return "webm";
  return null;
}

const agentWelcomeMessage: AgentMessage = {
  id: "agent-welcome",
  role: "assistant",
  text: "我是画布右侧导演台。选择对话群组与模型后可直接多轮交流；选中生成结果时，我也会收到该结果的提示词上下文。",
};

function persistedAgentMessages(canvasId: string): AgentMessage[] {
  try {
    const raw = window.localStorage.getItem(agentHistoryStorageKey(canvasId));
    if (!raw) return [];
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const parsed = value.flatMap((item): AgentMessage[] => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      if (
        typeof record.id !== "string" ||
        (record.role !== "user" && record.role !== "assistant") ||
        typeof record.text !== "string" ||
        !record.text.trim() ||
        record.id === "agent-welcome"
      )
        return [];
      return [
        {
          id: record.id,
          role: record.role,
          text: record.text.slice(0, 16_000),
          ...(record.error === true ? { error: true } : {}),
        },
      ];
    });
    return successfulAgentHistory(parsed);
  } catch {
    return [];
  }
}

export function AgentPanel({
  connections,
  assets,
  canvasId,
  selectedNode,
  selectedPrompt,
  draftRequest,
  onManageApi,
}: {
  connections: ProviderConnectionView[];
  assets: AssetView[];
  canvasId: string;
  selectedNode: CanvasNode | null;
  selectedPrompt: string;
  draftRequest: AgentDraftRequest | null;
  onManageApi: (group?: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const composerResizeRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const [composerInputHeight, setComposerInputHeight] = useState(
    COMPOSER_DEFAULT_HEIGHT,
  );
  const [composerResizing, setComposerResizing] = useState(false);
  const [supplierChoice, setSupplierChoice] = useState("");
  const [groupChoice, setGroupChoice] = useState("");
  const [modelChoice, setModelChoice] = useState("");
  const [reasoningChoice, setReasoningChoice] =
    useState<ReasoningEffort>("auto");
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [draggingAttachments, setDraggingAttachments] = useState(false);
  const reverseAttachmentRequestRef = useRef<string | null>(null);
  const [cangyuanGroups, setCangyuanGroups] = useState<
    CangyuanMarketplaceGroupView[]
  >([]);
  const [modelState, setModelState] = useState<{
    connectionId: string;
    items: ModelDescriptor[];
    error: string;
  }>({ connectionId: "", items: [], error: "" });
  const [draftState, setDraftState] = useState<{
    requestId: string | null;
    text: string;
  }>({ requestId: null, text: "" });
  const [messages, setMessages] = useState<AgentMessage[]>([
    agentWelcomeMessage,
  ]);
  const [hydratedCanvasId, setHydratedCanvasId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const agentConnections = useMemo(
    () =>
      connections.filter(
        (connection) =>
          providerConnectionUsage(connection) === "agent" ||
          providerConnectionSupplierKey(connection) === "fake",
      ),
    [connections],
  );
  const suppliers = useMemo(
    () =>
      Array.from(
        new Set([
          ...agentConnections.map(providerConnectionSupplierKey),
          ...(cangyuanGroups.length > 0 ? ["cangyuan"] : []),
        ]),
      ),
    [agentConnections, cangyuanGroups.length],
  );
  const supplier = suppliers.includes(supplierChoice)
    ? supplierChoice
    : (suppliers[0] ?? "");
  const supplierConnections = useMemo(
    () =>
      agentConnections.filter(
        (item) => providerConnectionSupplierKey(item) === supplier,
      ),
    [agentConnections, supplier],
  );
  const cangyuanChatGroups = useMemo(
    () =>
      cangyuanGroups.filter((item) =>
        item.models.some((model) => model.capability === "chat"),
      ),
    [cangyuanGroups],
  );
  const groups = useMemo(
    () =>
      supplier === "cangyuan" && cangyuanChatGroups.length > 0
        ? cangyuanChatGroups.map((item) => item.id)
        : Array.from(new Set(supplierConnections.map(providerConnectionGroup))),
    [cangyuanChatGroups, supplier, supplierConnections],
  );
  const preferredCangyuanGroup = [
    "LLM-GPT-pro",
    "LLM-GPT-plus",
    "LLM-GPT-稳定备用",
    "LLM-Claude-kiro",
  ].find((item) => groups.includes(item));
  const cangyuanGroupRatios = useMemo(
    () => new Map(cangyuanChatGroups.map((item) => [item.id, item.ratio])),
    [cangyuanChatGroups],
  );
  const group = groups.includes(groupChoice)
    ? groupChoice
    : supplier === "cangyuan" && preferredCangyuanGroup
      ? preferredCangyuanGroup
      : (groups[0] ?? "");
  const selectedGroupConnection = supplierConnections.find(
    (item) => providerConnectionGroup(item) === group,
  );
  const connectionId = selectedGroupConnection?.id ?? "";
  const selectedConnection =
    selectedGroupConnection &&
    (selectedGroupConnection.apiKeyUsable ?? selectedGroupConnection.apiKeySet)
      ? selectedGroupConnection
      : undefined;
  const connectionWarning = !selectedGroupConnection
    ? `${group || "当前"} 群组尚未保存独立 API Key，请先在 API 设置中配置。`
    : !selectedConnection
      ? `${group} 群组的 API Key 不可用，请在 API 设置中重新填写该群组自己的 Key。`
      : "";
  const marketplaceModels =
    supplier === "cangyuan"
      ? (cangyuanChatGroups
          .find((item) => item.id === group)
          ?.models.filter((model) => model.capability === "chat") ?? [])
      : [];
  const models =
    supplier === "cangyuan"
      ? marketplaceModels
      : modelState.connectionId === connectionId
        ? modelState.items
        : [];
  const modelLoading = Boolean(
    supplier !== "cangyuan" &&
    connectionId &&
    modelState.connectionId !== connectionId,
  );
  const modelError =
    supplier === "cangyuan"
      ? ""
      : modelState.connectionId === connectionId
        ? modelState.error
        : "";
  const modelId = models.some((item) => item.id === modelChoice)
    ? modelChoice
    : supplier === "cangyuan"
      ? (models[0]?.id ?? "")
      : ((models as ModelDescriptor[]).find((item) => item.isDefault)?.id ??
        models[0]?.id ??
        "");
  const draft =
    draftRequest && draftState.requestId !== draftRequest.id
      ? draftRequest.text
      : draftState.text;
  const selectedIsGenerated = selectedNode?.data.generatedResult === true;
  const availableReasoningOptions = useMemo(
    () => reasoningOptions(modelId),
    [modelId],
  );
  const reasoningEffort = availableReasoningOptions.some(
    (option) => option.value === reasoningChoice,
  )
    ? reasoningChoice
    : "auto";

  useEffect(() => {
    if (
      !availableReasoningOptions.some(
        (option) => option.value === reasoningChoice,
      )
    )
      setReasoningChoice("auto");
  }, [availableReasoningOptions, reasoningChoice]);

  const addAttachments = useCallback(
    async (files: FileList | File[]) => {
      const incoming = Array.from(files);
      if (!incoming.length) return;
      setAttachmentError("");
      if (attachments.length + incoming.length > MAX_ATTACHMENTS) {
        setAttachmentError(`一次最多添加 ${MAX_ATTACHMENTS} 个附件`);
        return;
      }
      const incomingBytes = incoming.reduce((sum, file) => {
        const kind = attachmentKind(file);
        return (
          sum +
          (kind === "image" ||
          (kind === "audio" && file.size <= MAX_ATTACHMENT_TOTAL_BYTES)
            ? file.size
            : 0)
        );
      }, 0);
      const currentBytes = attachments.reduce(
        (sum, file) => sum + (file.dataUrl ? file.size : 0),
        0,
      );
      if (currentBytes + incomingBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
        setAttachmentError("附件总大小不能超过 4MB，请压缩后再添加");
        return;
      }
      const prepared: AgentAttachment[] = [];
      for (const file of incoming) {
        const kind = attachmentKind(file);
        if (!kind) {
          setAttachmentError(`不支持 ${file.name}，请选择图片、音频或视频文件`);
          return;
        }
        if (kind === "image" && file.size > MAX_ATTACHMENT_BYTES) {
          setAttachmentError(
            `${file.name} 超过 5MB；导演台附件需要压缩后再上传`,
          );
          return;
        }
        if (kind === "audio" && !audioFormat(file.type, file.name)) {
          setAttachmentError(
            `${file.name} 的音频格式暂不支持，请使用 MP3、WAV、M4A 或 WebM`,
          );
          return;
        }
        prepared.push({
          id: crypto.randomUUID(),
          name: file.name,
          mimeType: file.type,
          size: file.size,
          kind,
          ...(kind === "image" ||
          (kind === "audio" && file.size <= MAX_ATTACHMENT_TOTAL_BYTES)
            ? { dataUrl: await fileDataUrl(file) }
            : {}),
        });
      }
      setAttachments((current) => [...current, ...prepared]);
    },
    [attachments],
  );

  const addCanvasAsset = useCallback(
    async (asset: AssetView) => {
      if (
        asset.kind !== "image" &&
        asset.kind !== "audio" &&
        asset.kind !== "video"
      )
        return;
      if (asset.kind !== "image") {
        if (attachments.length >= MAX_ATTACHMENTS) {
          setAttachmentError(`一次最多添加 ${MAX_ATTACHMENTS} 个附件`);
          return;
        }
        setAttachmentError("");
        setAttachments((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            assetId: asset.id,
            name: asset.name,
            mimeType: asset.mimeType,
            size: asset.size,
            kind: asset.kind as AgentAttachment["kind"],
          },
        ]);
        return;
      }
      try {
        const assetUrl =
          asset.kind === "image"
            ? `/api/assets/${encodeURIComponent(asset.id)}/preview?size=1200`
            : `/api/assets/${encodeURIComponent(asset.id)}/content`;
        const response = await fetch(assetUrl, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("无法读取画布素材");
        const blob = await response.blob();
        const file = new File([blob], asset.name, {
          type: asset.mimeType || blob.type,
        });
        await addAttachments([file]);
      } catch (error) {
        setAttachmentError(
          error instanceof Error ? error.message : "无法读取画布素材",
        );
      }
    },
    [addAttachments, attachments.length],
  );

  const attachmentCounts = useMemo(
    () =>
      attachments.reduce(
        (counts, attachment) => ({
          ...counts,
          [attachment.kind]: counts[attachment.kind] + 1,
        }),
        { image: 0, video: 0, audio: 0 },
      ),
    [attachments],
  );

  const currentUserContent = (): string | AgentChatContentPartView[] => {
    const text = draft.trim() || (attachments.length ? "请分析这些附件" : "");
    if (!attachments.length) return text;
    const parts: AgentChatContentPartView[] = [{ type: "text", text }];
    for (const attachment of attachments) {
      if (attachment.kind === "image") {
        if (attachment.dataUrl)
          parts.push({
            type: "image_url",
            image_url: { url: attachment.dataUrl, detail: "auto" },
          });
        continue;
      }
      if (attachment.kind === "audio") {
        const format = audioFormat(attachment.mimeType, attachment.name);
        const data = attachment.dataUrl?.split(",", 2)[1];
        if (format && data)
          parts.push({ type: "input_audio", input_audio: { data, format } });
        else
          parts.push({
            type: "text",
            text: `已附加音频“${attachment.name}”。当前附件较大，无法直接内联；请明确说明当前模型是否支持直接音频输入。`,
          });
        continue;
      }
      parts.push({
        type: "text",
        text: `已附加视频“${attachment.name}”。如果当前模型不能直接读取视频，请明确说明，并告诉我应改用支持视频的模型或抽帧分析。`,
      });
    }
    return parts;
  };

  useEffect(() => {
    if (!canvasId) return;
    const restored = persistedAgentMessages(canvasId);
    setMessages([agentWelcomeMessage, ...restored]);
    setHydratedCanvasId(canvasId);
    try {
      window.localStorage.removeItem(legacyAgentHistoryStorageKey(canvasId));
    } catch {
      // History remains isolated by the v2 storage key even if cleanup fails.
    }
  }, [canvasId]);

  useEffect(() => {
    const stored = Number(
      window.localStorage.getItem(COMPOSER_HEIGHT_STORAGE_KEY),
    );
    if (Number.isFinite(stored))
      setComposerInputHeight(clampComposerHeight(stored));

    const handlePointerMove = (event: PointerEvent) => {
      const resize = composerResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      setComposerInputHeight(
        clampComposerHeight(resize.startHeight + event.clientY - resize.startY),
      );
    };
    const finishResize = (event: PointerEvent) => {
      const resize = composerResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      const finalHeight = clampComposerHeight(
        resize.startHeight + event.clientY - resize.startY,
      );
      composerResizeRef.current = null;
      setComposerResizing(false);
      setComposerInputHeight(finalHeight);
      window.localStorage.setItem(
        COMPOSER_HEIGHT_STORAGE_KEY,
        String(finalHeight),
      );
    };
    const cancelResize = (event: PointerEvent) => {
      if (composerResizeRef.current?.pointerId !== event.pointerId) return;
      composerResizeRef.current = null;
      setComposerResizing(false);
    };
    const handleWindowResize = () =>
      setComposerInputHeight((current) => clampComposerHeight(current));

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", cancelResize);
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", cancelResize);
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  useEffect(() => {
    if (!canvasId || hydratedCanvasId !== canvasId || submitting) return;
    if (messages.some((message) => message.pending || message.streaming))
      return;
    try {
      const persistable = successfulAgentHistory(messages).map(
        ({ id, role, text }) => ({ id, role, text }),
      );
      window.localStorage.setItem(
        agentHistoryStorageKey(canvasId),
        JSON.stringify(persistable),
      );
    } catch {
      // Local storage can be unavailable in private browsing; chat still works.
    }
  }, [canvasId, hydratedCanvasId, messages, submitting]);

  useEffect(() => {
    let cancelled = false;
    void fetchCangyuanMarketplace()
      .then((catalog) => {
        if (!cancelled) setCangyuanGroups(catalog.groups);
      })
      .catch(() => {
        if (!cancelled) setCangyuanGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (supplier === "cangyuan") return;
    if (!connectionId) return;
    let cancelled = false;
    void fetchModels(connectionId)
      .then((items) => {
        if (cancelled) return;
        setModelState({ connectionId, items, error: "" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setModelState({
          connectionId,
          items: [],
          error: error instanceof Error ? error.message : "模型列表读取失败",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, supplier]);

  useEffect(() => {
    if (!draftRequest) return;
    if (
      draftRequest.assetId &&
      reverseAttachmentRequestRef.current !== draftRequest.id
    ) {
      reverseAttachmentRequestRef.current = draftRequest.id;
      const asset = assets.find((item) => item.id === draftRequest.assetId);
      if (asset) void addCanvasAsset(asset);
    }
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [addCanvasAsset, assets, draftRequest]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const conversation = conversationRef.current;
      if (conversation) conversation.scrollTop = conversation.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  useEffect(
    () => () => {
      if (revealTimerRef.current !== null)
        window.clearInterval(revealTimerRef.current);
    },
    [],
  );

  const revealAssistantMessage = (messageId: string, content: string) => {
    if (revealTimerRef.current !== null)
      window.clearInterval(revealTimerRef.current);
    const characters = Array.from(content);
    const chunkSize = Math.max(1, Math.ceil(characters.length / 140));
    let cursor = 0;
    const revealNext = () => {
      cursor = Math.min(characters.length, cursor + chunkSize);
      const complete = cursor >= characters.length;
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                text: characters.slice(0, cursor).join(""),
                pending: false,
                streaming: !complete,
              }
            : message,
        ),
      );
      if (!complete) return;
      if (revealTimerRef.current !== null) {
        window.clearInterval(revealTimerRef.current);
        revealTimerRef.current = null;
      }
      setSubmitting(false);
    };
    revealNext();
    if (cursor < characters.length)
      revealTimerRef.current = window.setInterval(revealNext, 22);
  };

  const submitDraft = async () => {
    const text = draft.trim() || (attachments.length ? "请分析这些附件" : "");
    if (!text || submitting || !selectedConnection || !modelId || !group)
      return;
    const now = crypto.randomUUID();
    const userMessage: AgentMessage = {
      id: `${now}-user`,
      role: "user",
      text: attachments.length
        ? `${text}\n${attachments.map((item) => `〔${item.kind === "image" ? "图片" : item.kind === "audio" ? "音频" : "视频"}〕${item.name}`).join("　")}`
        : text,
    };
    const assistantMessageId = `${now}-assistant`;
    const pendingAssistantMessage: AgentMessage = {
      id: assistantMessageId,
      role: "assistant",
      text: `正在调用 ${modelId}`,
      pending: true,
    };
    const history = agentApiHistory(messages);
    setMessages((current) => [
      ...current,
      userMessage,
      pendingAssistantMessage,
    ]);
    const userContent = currentUserContent();
    setDraftState({ requestId: draftRequest?.id ?? null, text: "" });
    setAttachments([]);
    setSubmitting(true);
    try {
      const result = await sendAgentChat({
        connectionId: selectedConnection.id,
        model: modelId,
        messages: [...history, { role: "user", content: userContent }],
        ...(reasoningEffort !== "auto" ? { reasoningEffort } : {}),
        ...(selectedIsGenerated
          ? {
              context: {
                label: selectedNode.data.label,
                ...(selectedPrompt ? { prompt: selectedPrompt } : {}),
                ...(selectedNode.data.assetKind
                  ? { assetKind: selectedNode.data.assetKind }
                  : {}),
              },
            }
          : {}),
      });
      revealAssistantMessage(assistantMessageId, result.message.content);
    } catch (error) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                text:
                  error instanceof Error ? error.message : "导演台对话调用失败",
                pending: false,
                streaming: false,
                error: true,
              }
            : message,
        ),
      );
      setSubmitting(false);
    }
  };

  const startNewConversation = () => {
    if (submitting) return;
    if (revealTimerRef.current !== null) {
      window.clearInterval(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    setMessages([agentWelcomeMessage]);
    setDraftState({ requestId: draftRequest?.id ?? null, text: "" });
    setAttachments([]);
    setAttachmentError("");
    reverseAttachmentRequestRef.current = null;
    try {
      window.localStorage.removeItem(agentHistoryStorageKey(canvasId));
      window.localStorage.removeItem(legacyAgentHistoryStorageKey(canvasId));
    } catch {
      // Local storage can be unavailable; resetting the visible chat still works.
    }
  };

  return (
    <div className="agent-panel">
      <header className="agent-panel-head">
        <span className="agent-panel-icon">
          <Bot size={17} />
        </span>
        <div>
          <strong>智能体</strong>
          <small>导演台 · 沧元对话模型</small>
        </div>
        <button
          type="button"
          className="agent-new-chat"
          onClick={startNewConversation}
          disabled={submitting}
          title="清空当前对话并开始新对话"
          aria-label="新对话"
        >
          <RotateCcw size={13} />
          <span>新对话</span>
        </button>
      </header>

      <div className="agent-context">
        <span>当前上下文</span>
        <strong>
          {selectedIsGenerated ? selectedNode.data.label : "未选择生成结果"}
        </strong>
        {selectedIsGenerated && selectedPrompt ? (
          <small title={selectedPrompt}>{selectedPrompt}</small>
        ) : (
          <small>选择一张生成图片或视频后可关联分析。</small>
        )}
      </div>

      <div
        ref={conversationRef}
        className="agent-conversation"
        aria-label="智能体对话记录"
        aria-live="polite"
        aria-busy={submitting}
      >
        {messages.map((message) => (
          <div
            className={`agent-message ${message.role}${message.error ? " error" : ""}`}
            key={message.id}
          >
            {message.role === "assistant" ? <Sparkles size={12} /> : null}
            {message.pending ? (
              <p className="agent-thinking">
                <span>{message.text}</span>
                <span className="agent-thinking-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </p>
            ) : (
              <p>
                {message.text}
                {message.streaming ? (
                  <span className="agent-streaming-cursor" aria-hidden="true" />
                ) : null}
              </p>
            )}
          </div>
        ))}
      </div>

      <div
        className={`agent-composer${draggingAttachments ? " is-dragging" : ""}${composerResizing ? " is-resizing" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDraggingAttachments(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target)
            setDraggingAttachments(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDraggingAttachments(false);
          const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE);
          if (assetId) {
            const asset = assets.find((item) => item.id === assetId);
            if (asset) void addCanvasAsset(asset);
            return;
          }
          void addAttachments(event.dataTransfer.files);
        }}
      >
        <input
          ref={fileInputRef}
          className="agent-file-input"
          type="file"
          accept="image/*,audio/*,video/*"
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
              aria-label="附件类型统计"
            >
              {attachmentCounts.image > 0 ? (
                <span>
                  <ImageIcon size={12} /> 图片 {attachmentCounts.image}
                </span>
              ) : null}
              {attachmentCounts.video > 0 ? (
                <span>
                  <FileVideo size={12} /> 视频 {attachmentCounts.video}
                </span>
              ) : null}
              {attachmentCounts.audio > 0 ? (
                <span>
                  <FileAudio size={12} /> 音频 {attachmentCounts.audio}
                </span>
              ) : null}
            </div>
            <div className="agent-attachments" aria-label="已添加附件">
              {attachments.map((attachment) => (
                <div
                  className={`agent-attachment ${attachment.kind}`}
                  key={attachment.id}
                >
                  {attachment.kind === "image" ? (
                    <img src={attachment.dataUrl} alt="" />
                  ) : null}
                  {attachment.kind === "audio" ? <FileAudio size={13} /> : null}
                  {attachment.kind === "video" ? <FileVideo size={13} /> : null}
                  <span title={attachment.name}>{attachment.name}</span>
                  <button
                    type="button"
                    aria-label={`移除附件 ${attachment.name}`}
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter((item) => item.id !== attachment.id),
                      )
                    }
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : null}
        <textarea
          ref={textareaRef}
          aria-label="智能体消息"
          style={{ height: `${composerInputHeight}px` }}
          value={draft}
          placeholder={
            selectedIsGenerated
              ? "询问这张图片/视频，或让智能体反推提示词…"
              : "先选择一个生成结果，再输入问题…"
          }
          onChange={(event) =>
            setDraftState({
              requestId: draftRequest?.id ?? null,
              text: event.target.value,
            })
          }
          onKeyDown={(event) => {
            // Enter confirms an IME candidate while composing Chinese/Japanese
            // text. Treating that key as submit drops the candidate and sends
            // an unfinished message.
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submitDraft();
            }
          }}
          disabled={submitting}
        />
        <div
          className="agent-composer-resize-handle"
          role="separator"
          aria-label="调整智能体输入框高度"
          aria-orientation="horizontal"
          aria-valuemin={COMPOSER_MIN_HEIGHT}
          aria-valuemax={COMPOSER_MAX_HEIGHT}
          aria-valuenow={composerInputHeight}
          aria-valuetext={`${composerInputHeight} 像素`}
          title="上下拖动调整输入框高度"
          tabIndex={0}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            composerResizeRef.current = {
              pointerId: event.pointerId,
              startY: event.clientY,
              startHeight: composerInputHeight,
            };
            setComposerResizing(true);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            const next = clampComposerHeight(
              composerInputHeight + (event.key === "ArrowDown" ? 16 : -16),
            );
            setComposerInputHeight(next);
            window.localStorage.setItem(
              COMPOSER_HEIGHT_STORAGE_KEY,
              String(next),
            );
          }}
        >
          <span />
        </div>
        <div className="agent-composer-footer">
          <div className="agent-composer-tools">
            {suppliers.length > 0 ? (
              <>
                <label className="agent-composer-option supplier-option">
                  <span>供应商</span>
                  <select
                    aria-label="智能体 API 供应商"
                    title="选择已添加的 API 供应商"
                    value={supplier}
                    onChange={(event) => {
                      setSupplierChoice(event.target.value);
                      setGroupChoice("");
                      setModelChoice("");
                    }}
                  >
                    {suppliers.map((item) => (
                      <option key={item} value={item}>
                        {providerSupplierLabel(item)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="agent-composer-option group-option">
                  <span>群组</span>
                  <select
                    aria-label="智能体模型群组"
                    title="选择该供应商下的模型群组"
                    value={group}
                    onChange={(event) => {
                      setGroupChoice(event.target.value);
                      setModelChoice("");
                    }}
                  >
                    {groups.map((item) => (
                      <option key={item} value={item}>
                        {providerGroupLabel(
                          item,
                          supplier === "cangyuan"
                            ? cangyuanGroupRatios.get(item)
                            : undefined,
                        )}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="agent-composer-option model-option">
                  <span>模型</span>
                  <select
                    aria-label="智能体模型"
                    title="选择智能体模型"
                    value={modelId}
                    disabled={modelLoading || models.length === 0}
                    onChange={(event) => setModelChoice(event.target.value)}
                  >
                    {modelLoading ? (
                      <option value="">正在读取模型…</option>
                    ) : null}
                    {!modelLoading && models.length === 0 ? (
                      <option value="">暂无可选模型</option>
                    ) : null}
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {appendPriceLabelOnce(
                          model.name,
                          supplier === "cangyuan" && "priceLabel" in model
                            ? model.priceLabel
                            : "metadata" in model
                              ? model.metadata?.["priceLabel"]
                              : undefined,
                        )}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="agent-composer-option reasoning-option">
                  <BrainCircuit size={13} />
                  <span>推理</span>
                  <select
                    aria-label="智能体推理强度"
                    title="选择模型的推理强度；自动不会额外发送推理参数"
                    value={reasoningEffort}
                    onChange={(event) =>
                      setReasoningChoice(event.target.value as ReasoningEffort)
                    }
                  >
                    {availableReasoningOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <button
                className="agent-add-api"
                type="button"
                onClick={() => onManageApi()}
              >
                <KeyRound size={12} /> 添加 API
              </button>
            )}
            <button
              className="agent-attach"
              type="button"
              aria-label="添加图片、音频或视频附件"
              title="上传或拖入图片、音频、视频"
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting}
            >
              <Paperclip size={14} />
            </button>
          </div>
          <button
            className="agent-send"
            type="button"
            aria-label="发送智能体消息"
            disabled={
              (!draft.trim() && attachments.length === 0) ||
              !selectedConnection ||
              !modelId ||
              submitting
            }
            onClick={() => void submitDraft()}
          >
            {submitting ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Send size={15} />
            )}
          </button>
        </div>
        {draggingAttachments ? (
          <div className="agent-drop-hint">松开即可添加图片、音频或视频</div>
        ) : null}
        {attachmentError ? (
          <small className="agent-attachment-error">{attachmentError}</small>
        ) : null}
        {modelError ? (
          <small className="agent-model-error">{modelError}</small>
        ) : null}
        {connectionWarning ? (
          <small className="agent-model-error">
            {connectionWarning}{" "}
            {group ? (
              <button type="button" onClick={() => onManageApi(group)}>
                配置该导演台群组
              </button>
            ) : null}
          </small>
        ) : null}
      </div>
    </div>
  );
}

export type { AgentDraftRequest };
