"use client";
import { takeWorkspaceAgentDraft } from "../lib/workspace-agent-draft";
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  UserRound,
  Plus,
  Paperclip,
  Send,
  Square,
  X,
  RefreshCw,
  Check,
  Circle,
  CircleCheck,
  CircleX,
  Clock3,
  LoaderCircle,
  Layers3,
  MinusCircle,
  Play,
  History,
  ChevronDown,
  Copy,
  Search,
  WandSparkles,
} from "lucide-react";
import { agentRequest, streamAgentTurn } from "../lib/agent-client";
import {
  AgentArtifactSchema,
  type AgentArtifact,
  type AgentMessage,
  type AgentPlan,
  type AgentProposal,
  type AgentSession,
  type AgentTurnInput,
} from "../lib/agent-contracts";
import type { AgentModelOption } from "../lib/agent-models";
import { agentCatalogSnapshot, type AgentCatalogConnection, type AgentCatalogSnapshot } from "../lib/agent-catalog-status";
import {
  uploadAsset,
  fetchProjectChat,
  fetchAssets,
  type ProviderConnectionView,
} from "../lib/client-api";
import { agentHistoryStorageKey } from "../lib/agent-chat-history";
import { providerConnectionSupplierKey } from "../lib/provider-connection-options";
import { isTk1688ApiUrl } from "@super-canvas/providers/tk1688-model-policy";
import type { AssetView, CanvasNode } from "./types";
import {
  AgentCanvasContext,
  type AgentCanvasResult,
} from "./agent-canvas-context";
import styles from "./creative-agent-panel.module.css";
import { MiniLightCore } from "./mini-light-core";
import { MessageContent } from "./agent-message-content";
import { AgentPopover } from "./agent-popover";
import { AgentModelPopover } from "./agent-model-popover";
import { canvasMotionEnabled } from "./canvas-motion";
import { DeferredPanelContent } from "./deferred-panel-content";
import { VirtualList } from "./virtual-list";
import { readUiPreference, writeUiPreference } from "../lib/ui-preferences";
import { agentConversationItems, agentOperationNames, agentPlanRequest, agentRelativeTime, agentReplyContext, agentToolNames, hasAgentTurnReply } from "../lib/agent-presentation";
import { modelPickerPriceCompact } from "../lib/model-picker-data";
import { AgentPlanStepEditor } from "./agent-plan-step-editor";

type Props = {
  connections: ProviderConnectionView[];
  assets: AssetView[];
  canvasId: string;
  selectedNode: CanvasNode | null;
  nodes?: readonly CanvasNode[];
  selectedPrompt: string;
  draftRequest: { id: string; text: string; assetId?: string } | null;
  onManageApi: (group?: string, connectionId?: string) => void;
  onClose?: () => void;
  placement?: "left" | "right";
};
const keyOf = (m: AgentModelOption) => `${m.connectionId}\n${m.modelId}`;
function isTk1688Connection(connection: ProviderConnectionView) {
  return providerConnectionSupplierKey(connection) === "tk1688" ||
    isTk1688ApiUrl(typeof connection.config.baseUrl === "string" ? connection.config.baseUrl : undefined);
}
function isTk1688Model(model: AgentModelOption | undefined, connections: ProviderConnectionView[]) {
  return Boolean(model && (model.supplierKey === "tk1688" || model.metadata?.tk1688Catalog === true ||
    connections.some(connection => connection.id === model.connectionId && isTk1688Connection(connection))));
}
function savedTk1688Model(key: string, connections: ProviderConnectionView[]): AgentModelOption | undefined {
  const [connectionId, modelId] = key.split("\n");
  if (!connectionId || !modelId) return undefined;
  const connection = connections.find(item => item.id === connectionId && isTk1688Connection(item));
  if (!connection) return undefined;
  const config = connection.config;
  return {
    supplierId: String(config.supplierId ?? `${config.supplierKey ?? connection.provider}:${config.baseUrl ?? connection.id}`),
    supplierName: String(config.supplierName ?? connection.name.split(" · ")[0]),
    supplierKey: "tk1688", group: String(config.modelGroup ?? "默认分组"),
    connectionId, connectionName: connection.name, modelId, modelName: modelId,
    protocol: "openai-chat-completions", available: false, source: "key",
    reason: "本次目录未返回已保存线路，请刷新目录或重新选择",
    capabilities: { text: true, imageInput: false, audioInput: false, videoInput: false,
      structuredOutput: false, toolCalling: false, nativeWebSearch: false, reasoning: false },
  };
}
const mediaKinds = [
  { kind: "image", capability: "imageInput", limit: "maxImages", label: "图片", unit: "张" },
  { kind: "video", capability: "videoInput", limit: "maxVideos", label: "视频", unit: "个" },
  { kind: "audio", capability: "audioInput", limit: "maxAudios", label: "音频", unit: "个" },
] as const;
type AttachmentInput = Pick<AssetView, "kind" | "size">;
function validateAppAttachments(items: AttachmentInput[]) {
  if (items.length > 16 || items.some((item) => item.size > 16 * 1024 * 1024) ||
    items.reduce((total, item) => total + item.size, 0) > 24 * 1024 * 1024)
    throw new Error("本应用每轮最多 16 个附件，单个 16 MB，总计 24 MB（含引用节点素材）");
}
function validateModelAttachments(model: AgentModelOption, items: AttachmentInput[]) {
  const media = items.filter((item) => item.kind !== "text");
  for (const type of mediaKinds) {
    const count = media.filter((item) => item.kind === type.kind).length;
    if (count && !model.capabilities[type.capability])
      throw new Error(`当前模型暂不可读取${type.label}，请选择支持${type.label}的模型，或移除对应素材。`);
    const limit = model.inputLimits?.[type.limit];
    if (limit !== undefined && count > limit)
      throw new Error(`${model.modelName} 每轮最多读取 ${limit} ${type.unit}${type.label}，当前有 ${count} ${type.unit}（含引用节点素材）。`);
  }
  if (model.inputLimits?.maxAssets !== undefined && media.length > model.inputLimits.maxAssets)
    throw new Error(`${model.modelName} 每轮最多读取 ${model.inputLimits.maxAssets} 个附件，当前有 ${media.length} 个（含引用节点素材）。`);
}
const statusNames: Record<string, string> = {
  awaiting_approval: "等待确认方案",
  materializing: "正在放入画布",
  awaiting_execution: "请检查画布后生成",
  approved: "正在提交运行",
  running: "生成中",
  succeeded: "已完成",
  failed: "生成失败",
  cancelled: "已撤回",
  expired: "方案已过期",
};
const resultStatuses: Record<string, { label: string; Icon: typeof Circle; tone: string }> = {
  queued: { label: "排队中", Icon: Clock3, tone: "pending" },
  pending: { label: "等待执行", Icon: Clock3, tone: "pending" },
  blocked: { label: "等待前序完成", Icon: Clock3, tone: "pending" },
  submitting: { label: "正在提交", Icon: LoaderCircle, tone: "running" },
  running: { label: "生成中", Icon: LoaderCircle, tone: "running" },
  archiving: { label: "正在保存成果", Icon: LoaderCircle, tone: "running" },
  waiting: { label: "等待结果", Icon: Clock3, tone: "pending" },
  succeeded: { label: "已完成", Icon: CircleCheck, tone: "success" },
  failed: { label: "生成失败", Icon: CircleX, tone: "error" },
  cancelled: { label: "已取消", Icon: MinusCircle, tone: "neutral" },
  cancel_requested: { label: "正在取消", Icon: Clock3, tone: "pending" },
  needs_attention: { label: "需要处理", Icon: CircleX, tone: "error" },
  skipped: { label: "已跳过", Icon: MinusCircle, tone: "neutral" },
};

export const AgentPanel = memo(function AgentPanel(props: Props) {
  const bridge = useContext(AgentCanvasContext);
  const [session, setSession] = useState<AgentSession | null>(null);
  const [sessions, setSessions] = useState<
    Array<{ id: string; title: string; updatedAt?: string }>
  >([]);
  const [models, setModels] = useState<AgentModelOption[]>([]);
  const [catalogConnections, setCatalogConnections] = useState<AgentCatalogConnection[]>([]);
  const [modelChoiceLoaded, setModelChoiceLoaded] = useState(false);
  const [selection, setSelection] = useState<{ key: string; snapshot?: AgentModelOption }>({ key: "" });
  const choice = selection.key;
  const [draft, setDraft] = useState("");
  const draftInput = useRef<HTMLTextAreaElement>(null);
  const focusExternalDraft = useRef(false);
  useEffect(() => {
    if (!props.canvasId) return;
    let value = "";
    try { value = takeWorkspaceAgentDraft(props.canvasId, window.sessionStorage); } catch { /* Restricted storage keeps the ordinary chat usable. */ }
    // External, one-shot draft transfer; deliberately no send/turn action.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (value) { focusExternalDraft.current = true; setDraft(current => current || value); }
  }, [props.canvasId]);

  const [attachments, setAttachments] = useState<AssetView[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [legacy, setLegacy] = useState<string[] | null>(null);
  const [useSelected, setUseSelected] = useState(true);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [sessionQuery, setSessionQuery] = useState("");
  const [streaming, setStreaming] = useState({ turnId: "", text: "" });
  const [streamInterrupted, setStreamInterrupted] = useState(false);
  const [reasoningChoice, setReasoningChoice] = useState({ model: "", value: "auto" });
  const abort = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const modelReadVersion = useRef(0);
  // Compare before dispatch: an equal-state functional updater can remain in
  // React's pending queue and retain every freshly parsed polling response.
  const publishedModelsJson = useRef("[]");
  const publishedCatalogConnectionsJson = useRef("[]");
  const operation = useRef(0);
  const activity = useRef(0);
  const working = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const taskRef = useRef<AgentSession | null>(session);
  useEffect(() => {
    taskRef.current = session;
  }, [session]);
  const sessionId = session?.id;
  const conversation = useRef<HTMLDivElement>(null);
  const missingSelection = useMemo(() => isTk1688Model(selection.snapshot, props.connections)
    ? { ...selection.snapshot!, available: false, reason: "本次目录未返回已保存线路，请刷新目录或重新选择",
      metadata: { ...selection.snapshot!.metadata, tk1688CatalogStale: true } }
    : savedTk1688Model(choice, props.connections), [selection.snapshot, choice, props.connections]);
  const selected = useMemo(() =>
    models.find((m) => keyOf(m) === choice) ?? missingSelection ??
    models.find((m) => m.available) ??
    models[0], [models, choice, missingSelection]);
  const tk1688Selection = isTk1688Model(selected, props.connections);
  const modelInventory = useMemo(() => selected && !models.some(model => keyOf(model) === keyOf(selected))
    ? [...models, selected] : models, [models, selected]);
  const modelKey = selected ? keyOf(selected) : "";
  const reasoningOptions = selected?.reasoningOptions ?? [{ value: "auto", label: "自动" }];
  const reasoning = reasoningChoice.model === modelKey &&
    reasoningOptions.some((option) => option.value === reasoningChoice.value)
    ? reasoningChoice.value : "auto";
  const reasoningSourceLabel = selected?.reasoningFallback && selected.reasoningSource !== "official-model"
    ? "渠道实测＋官网默认（未全部实测）" : ({
    live: "已知思考档位（含当前连接实测）",
    "channel-verification": "已知思考档位（含同渠道实测）",
    "provider-catalog": "思考档位来自供应商目录",
    manual: "已保存的思考档位",
    "official-model": "官网默认档位，当前渠道未实测",
  } as Record<string, string>)[selected?.reasoningSource ?? ""];
  const acceptedMedia = mediaKinds.filter((type) => selected?.capabilities[type.capability]);
  const selectedAsset = useSelected && props.selectedNode?.data.assetId
    ? props.assets.find((asset) => asset.id === props.selectedNode!.data.assetId) : undefined;
  const withSelectedAsset = (items: AssetView[]) => [...new Map([
    ...items, ...(selectedAsset ? [selectedAsset] : []),
  ].map((asset) => [asset.id, asset])).values()];
  const selectModel = (model?: AgentModelOption) => {
    if (model) {
      setSelection({ key: keyOf(model), snapshot: model });
      if (isTk1688Model(model, props.connections))
        writeUiPreference(`agent-model:${props.canvasId}`, keyOf(model));
    }
    setReasoningChoice({ model: "", value: "auto" });
  };
  const modelLoad = useCallback(async () => {
    const version = ++modelReadVersion.current;
    const snapshot = agentCatalogSnapshot(await agentRequest<AgentModelOption[] | AgentCatalogSnapshot<AgentModelOption>>(
      "/models?cached=1&includeConnections=1",
      undefined,
      "GET",
    ));
    const items = snapshot.models;
    if (alive.current && version === modelReadVersion.current) {
      const connectionsJson = JSON.stringify(snapshot.connections);
      if (connectionsJson !== publishedCatalogConnectionsJson.current) {
        publishedCatalogConnectionsJson.current = connectionsJson;
        setCatalogConnections(snapshot.connections);
      }
      const json = JSON.stringify(items);
      if (json !== publishedModelsJson.current) {
        publishedModelsJson.current = json;
        setModels(items);
      }
    }
    return items;
  }, []);
  const refresh = useCallback(async (id: string) => {
    const value = await agentRequest<AgentSession>(
      `/sessions/${id}`,
      undefined,
      "GET",
    );
    if (alive.current && taskRef.current?.id === id) setSession(value);
    return value;
  }, []);
  const run = async (work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    const workId = ++activity.current;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (alive.current && workId === activity.current)
        setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      if (workId === activity.current) {
        working.current = false;
        if (alive.current) setBusy(false);
      }
    }
  };
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    const savedModel = readUiPreference(`agent-model:${props.canvasId}`);
    void Promise.all([
      modelLoad(),
      agentRequest<Array<{ id: string; title: string; updatedAt?: string }>>(
        `/sessions?canvasId=${encodeURIComponent(props.canvasId)}`,
        undefined,
        "GET",
        controller.signal,
      ),
    ])
      .then(async ([items, list]) => {
        if (!alive.current) return;
        setSessions(list);
        if (savedModel) setSelection(current => current.key ? current : {
          key: savedModel, snapshot: items.find(model => keyOf(model) === savedModel),
        });
        setModelChoiceLoaded(true);
        const last = readUiPreference(
          `agent-task:${props.canvasId}`,
        );
        const id = list.find((s) => s.id === last)?.id ?? list[0]?.id;
        if (id) {
          const value = await agentRequest<AgentSession>(
            `/sessions/${id}`,
            undefined,
            "GET",
            controller.signal,
          );
          if (alive.current) setSession(value);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      alive.current = false;
      controller.abort();
      abort.current?.abort();
    };
  }, [props.canvasId, modelLoad]);
  useEffect(() => {
    if (sessionId)
      writeUiPreference(`agent-task:${props.canvasId}`, sessionId);
  }, [sessionId, props.canvasId]);
  const scrollConversation = useCallback(() => {
    if (focusExternalDraft.current && draftInput.current) { draftInput.current.focus(); focusExternalDraft.current = false; }
    conversation.current?.scrollTo({
      top: conversation.current.scrollHeight,
      behavior: canvasMotionEnabled() ? "smooth" : "instant",
    });
  }, []);
  useEffect(() => { scrollConversation(); }, [session?.messages.length, stage, streaming.text, scrollConversation]);
  useEffect(() => {
    const input = draftInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(176, Math.max(36, input.scrollHeight))}px`;
  }, [draft]);
  useEffect(() => {
    if (
      !session?.plans.some(
        (p) => p.status === "running" || p.status === "approved",
      )
    )
      return;
    const timer = setInterval(
      () => void refresh(session.id).catch(() => undefined),
      3000,
    );
    return () => clearInterval(timer);
  }, [session?.id, session?.plans, refresh]);
  const receivedDraft = useRef<string | null>(null);
  useEffect(() => {
    if (!props.draftRequest || receivedDraft.current === props.draftRequest.id)
      return;
    receivedDraft.current = props.draftRequest.id;
    // This is a one-time external canvas command, not a value derived on each render.
    /* eslint-disable react-hooks/set-state-in-effect */
    setDraft(props.draftRequest.text);
    requestAnimationFrame(() => draftInput.current?.focus());
    const asset = props.assets.find(
      (a) => a.id === props.draftRequest?.assetId,
    );
    if (asset)
      setAttachments((current) =>
        current.some((a) => a.id === asset.id) ? current : [...current, asset],
      );
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [props.draftRequest, props.assets]);
  useEffect(() => {
    if (modelChoiceLoaded && modelKey && !tk1688Selection)
      writeUiPreference(`agent-model:${props.canvasId}`, modelKey);
  }, [modelChoiceLoaded, modelKey, props.canvasId, tk1688Selection]);
  useEffect(() => {
    let reading = false;
    const load = () => {
      if (reading || document.hidden) return;
      reading = true;
      // Local saved facts only: onboarding completion updates the open menu.
      void modelLoad().catch(() => undefined).finally(() => { reading = false; });
    };
    load();
    const timer = window.setInterval(load, 5000);
    window.addEventListener("focus", load);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", load); };
  }, [props.connections, modelLoad]);
  const newTask = async () => {
    abort.current?.abort();
    operation.current++;
    const value = await agentRequest<AgentSession>("/sessions", {
      canvasId: props.canvasId,
    });
    if (!alive.current) return;
    setSession(value);
    setSessions((current) => [
      { id: value.id, title: value.title },
      ...current,
    ]);
    setAttachments([]);
    setStage("");
    setLegacy(null);
    setStreaming({ turnId: "", text: "" });
    setSessionPickerOpen(false);
    requestAnimationFrame(() => draftInput.current?.focus());
  };
  const addFiles = async (files: File[]) =>
    run(async () => {
      if (files.some((f) => !/^(image|audio|video)\//u.test(f.type)))
        throw new Error("请上传图片、音频或视频素材");
      if (!selected?.available) throw new Error("请先选择可用模型，再添加参考素材");
      const inputs = [...withSelectedAsset(attachments), ...files.map((file) => ({
        kind: file.type.split("/")[0] as AttachmentInput["kind"], size: file.size,
      }))];
      validateAppAttachments(inputs);
      validateModelAttachments(selected, inputs);
      for (const file of files) {
        const asset = await uploadAsset(file);
        if (alive.current) setAttachments((current) => [...current, asset]);
      }
    });
  const submit = async (
    message = draft,
    helper?: AgentTurnInput["helper"],
    skipVisualAnalysis = false,
    explicitIntent: NonNullable<AgentTurnInput["intent"]> = "auto",
    contextAssetIds: string[] = [],
  ) =>
    run(async () => {
      if (!selected?.available)
        throw new Error(selected?.reason ?? "请先配置智能体模型");
      const knownAssets = new Map([...props.assets, ...attachments].map(asset => [asset.id, asset]));
      if (contextAssetIds.some(id => !knownAssets.has(id))) {
        for (const asset of await fetchAssets()) knownAssets.set(asset.id, asset);
      }
      if (contextAssetIds.some(id => !knownAssets.has(id))) throw new Error("这轮讨论的部分参考素材已不存在，请补充后再制作方案。");
      const turnAttachments = withSelectedAsset([...new Map([...attachments, ...contextAssetIds.map(id => knownAssets.get(id)!)].map(asset => [asset.id, asset])).values()]);
      validateAppAttachments(turnAttachments);
      validateModelAttachments(selected, helper || skipVisualAnalysis
        ? turnAttachments.filter((asset) => asset.kind !== "image") : turnAttachments);
      if (helper) {
        const helperModel = models.find((model) => model.connectionId === helper.connectionId && model.modelId === helper.modelId);
        if (!helperModel?.available) throw new Error("此视觉助手已不可用，请重新选择模型");
        const helperAssets = [...new Map([...props.assets, ...turnAttachments].map((asset) => [asset.id, asset])).values()]
          .filter((asset) => helper.assetIds.includes(asset.id));
        validateAppAttachments(helperAssets);
        validateModelAttachments(helperModel, helperAssets);
      }
      if (bridge) await bridge.perform(async () => ({}));
      const task =
        taskRef.current ??
        (await agentRequest<AgentSession>("/sessions", {
          canvasId: props.canvasId,
        }));
      if (!alive.current) return;
      setSession(task);
      taskRef.current = task;
      const ids = turnAttachments.map((asset) => asset.id);
      const current = ++operation.current;
      const requestId = crypto.randomUUID();
      abort.current = new AbortController();
      setDraft("");
      setLegacy(null);
      setStage("正在读取任务");
      setStreaming({ turnId: "", text: "" });
      setStreamInterrupted(false);
      let succeeded = false;
      let streamFailure: unknown;
      try {
        await streamAgentTurn(
        {
          canvasId: props.canvasId,
          sessionId: task.id,
          requestId,
          connectionId: selected.connectionId,
          modelId: selected.modelId,
          intent: explicitIntent,
          message: message.trim() || "请分析这些素材并帮助我确定下一步",
          attachmentAssetIds: ids,
          selectedNodeIds:
            useSelected && props.selectedNode ? [props.selectedNode.id] : [],
          ...(reasoning !== "auto" ? { reasoningEffort: reasoning } : {}),
          ...(helper ? { helper } : {}),
          ...(skipVisualAnalysis ? { skipVisualAnalysis: true } : {}),
        },
        (event) => {
          if (!alive.current || current !== operation.current) return;
          if (event.type === "stage") setStage(event.message);
          if (event.type === "delta") setStreaming(previous => ({ turnId: event.turnId, text: event.reset || previous.turnId !== event.turnId ? event.text : previous.text + event.text }));
          if (event.type === "session") { setSession(event.session); setStreaming({ turnId: "", text: "" }); }
          if (event.type === "error") setError(event.message);
          if (event.type === "done") succeeded = event.status !== "failed" && event.status !== "cancelled";
        },
        abort.current.signal,
        );
      } catch (error) {
        if (alive.current && current === operation.current) { setStreamInterrupted(true); setDraft(message); }
        streamFailure = error;
      } finally {
        if (alive.current && current === operation.current) {
          if (succeeded) {
            setAttachments([]);
            setStreaming({ turnId: "", text: "" });
          }
          setStage("");
          // The durable session contains the result even if the event stream broke.
          const [durable] = await Promise.allSettled([refresh(task.id), modelLoad()]);
          if (alive.current && current === operation.current && durable.status === "fulfilled" && hasAgentTurnReply(durable.value, requestId)) {
            succeeded = true;
            setStreaming({ turnId: "", text: "" });
            setStreamInterrupted(false);
            setAttachments([]);
            setDraft(value => value === message ? "" : value);
          }
        }
      }
      if (streamFailure && !succeeded) throw streamFailure;
    });
  const stop = () => {
    abort.current?.abort();
    activity.current++;
    working.current = false;
    operation.current++;
    setStage("分析已停止");
    setBusy(false);
    setStreamInterrupted(true);
    if (session)
      void agentRequest(`/sessions/${session.id}`, {}).then(() => refresh(session.id)).catch((e) =>
        setError(e.message),
      );
  };
  const updatePlan = (value: AgentPlan) =>
    setSession((current) =>
      current
        ? {
            ...current,
            plans: [value, ...current.plans.filter((p) => p.id !== value.id)],
          }
        : current,
    );
  const editFailedRequest = (terminal: AgentMessage) => run(async () => {
    const previous = session?.messages.find((message) =>
      message.role === "user" && message.metadata.requestId === terminal.metadata.requestId,
    );
    if (!previous) return;
    setDraft(previous.content);
    const ids = Array.isArray(previous.metadata.attachmentAssetIds) ? previous.metadata.attachmentAssetIds : [];
    const known = new Map([...props.assets, ...attachments].map((asset) => [asset.id, asset]));
    if (ids.some((id) => !known.has(String(id)))) {
      for (const asset of await fetchAssets()) known.set(asset.id, asset);
    }
    setAttachments(ids.flatMap((id) => known.get(String(id)) ? [known.get(String(id))!] : []));
    const nodeIds = Array.isArray(previous.metadata.selectedNodeIds) ? previous.metadata.selectedNodeIds : [];
    const sameSelection = Boolean(props.selectedNode && nodeIds.includes(props.selectedNode.id));
    setUseSelected(sameSelection);
    if (ids.some((id) => !known.has(String(id)))) setError("部分参考素材已不存在，请补充后再发送。");
    else if (nodeIds.length && !sameSelection) setError("原引用节点已改变，请重新选择需要修改的节点后再发送。");
  });
  const planAction = async (
    plan: AgentPlan,
    action: string,
    acceptUnknownPrice = false,
  ) =>
    run(async () => {
      if (!bridge) throw new Error("请在画布编辑器中操作");
      const value = await bridge.perform<
        AgentCanvasResult & { plan?: AgentPlan }
      >(async (revision) => {
        const body = {
          version: plan.version,
          ...(action === "execute"
            ? { preflightId: plan.preflight?.id, acceptUnknownPrice }
            : { canvasRevision: revision }),
        };
        if (action === "preflight")
          return {
            plan: await agentRequest<AgentPlan>(
              `/plans/${plan.id}/preflight`,
              body,
            ),
          };
        return agentRequest(`/plans/${plan.id}/${action}`, body);
      });
      if (value.plan && alive.current) updatePlan(value.plan);
    });
  const intentHint = "聊想法，也能直接提出制作要求；方案由你确认后放入画布";
  const reasoningNotes = [reasoningOptions.length > 1 ? reasoningSourceLabel : "", selected?.reasoningNotice].filter((note): note is string => Boolean(note));
  const conversationItems = agentConversationItems(session?.messages ?? []);
  const sessionList: Array<{ id: string; title: string; updatedAt?: string }> = [...(session && !sessions.some(item => item.id === session.id) ? [session] : []), ...sessions];
  const showLegacy = () => void run(async () => {
    let local: Array<{ text?: string }> = [];
    try { const saved = JSON.parse(localStorage.getItem(agentHistoryStorageKey(props.canvasId)) ?? "[]"); if (Array.isArray(saved)) local = saved; } catch { /* Read-only legacy history. */ }
    const remote = await fetchProjectChat(props.canvasId);
    setLegacy([...local.flatMap(message => typeof message?.text === "string" ? [message.text] : []), ...remote.map(message => message.content)]);
    setSessionPickerOpen(false);
  });
  return (
    <section
      className={`agent-panel ${styles.panel}`}
      aria-label="通用创作智能体"
    >
      <header className={styles.header}>
        <button className={styles.sessionTrigger} type="button" data-agent-popover-trigger aria-haspopup="dialog" aria-label="切换对话" aria-expanded={sessionPickerOpen} data-session-id={session?.id ?? ""} disabled={busy}
          onClick={() => { setModelSettingsOpen(false); setSessionPickerOpen(value => !value); }} title={session?.title ?? "开始一段新对话"}>
          <MiniLightCore state={error ? "error" : busy ? streaming.text ? "streaming" : "thinking" : "idle"} />
          <span><strong>创作助手 <small>CHAT</small></strong><span>{session?.title ?? "开始一段新对话"}</span></span><ChevronDown size={13} />
        </button>
        <div className={styles.headerActions}>
          <button type="button" aria-label="新创作任务" title="新对话" disabled={busy} onClick={() => void run(newTask)}><Plus size={16} /></button>
          <button type="button" data-agent-popover-trigger aria-haspopup="dialog" aria-expanded={sessionPickerOpen} aria-label="对话历史" title="搜索与切换历史对话" disabled={busy} onClick={() => { setModelSettingsOpen(false); setSessionPickerOpen(value => !value); }}><History size={16} /></button>
          {props.onClose && <button type="button" aria-label="关闭智能体" title="关闭创作助手" onClick={props.onClose}><X size={16} /></button>}
        </div>
      </header>
      {sessionPickerOpen && <AgentPopover label="切换对话" position="top" onClose={() => setSessionPickerOpen(false)}>
        <label className={styles.popoverSearch}><Search size={14} /><input aria-label="搜索对话" type="search" placeholder="搜索对话…" value={sessionQuery} onChange={event => setSessionQuery(event.target.value)} /></label>
        <div className={styles.sessionList}>
          {sessionList.filter(item => item.title.toLocaleLowerCase().includes(sessionQuery.trim().toLocaleLowerCase())).map(item => <button type="button" key={item.id} data-session-id={item.id} data-choice aria-pressed={item.id === session?.id} disabled={busy} onClick={() => void run(async () => {
            operation.current++;
            const next = await agentRequest<AgentSession>(`/sessions/${item.id}`, undefined, "GET");
            if (alive.current) { setSession(next); setLegacy(null); setStreaming({ turnId:"", text:"" }); setSessionPickerOpen(false); }
          })}><span>{item.id === session?.id ? session.title : item.title}</span><small>{agentRelativeTime(item.id === session?.id ? session.messages.at(-1)?.createdAt ?? item.updatedAt : item.updatedAt)}</small>{item.id === session?.id && <Check size={13} />}</button>)}
          {!sessionList.length && <p>这里会保留你的创作对话。</p>}
        </div>
        <div className={styles.popoverFooter}><button type="button" disabled={busy} onClick={() => void run(newTask)}><Plus size={13} />新对话</button><button type="button" disabled={busy} onClick={showLegacy}>旧对话（只读）</button></div>
      </AgentPopover>}
      <DeferredPanelContent onReady={scrollConversation}>
      <VirtualList<AgentMessage>
        className={styles.conversation}
        scrollRef={conversation}
        label="智能体对话"
        items={legacy ? [] : conversationItems}
        itemKey={(message) => message.id}
        estimatedHeight={160}
        resetKey={session?.id ?? "new"}
        keepMountedKeys={new Set(session?.messages.filter(message => message.metadata.artifact).map(message => message.id))}
        header={legacy ? (
          <article className={styles.card}>
            <button onClick={() => setLegacy(null)}>返回当前任务</button>
            <p>旧对话只读保留；旧附件可能只有文件名记录。</p>
            {!legacy.length && <p>暂无旧对话。</p>}
            {legacy.map((text, i) => (
              <p key={i}>{text}</p>
            ))}
          </article>
        ) : (
          !session?.messages.length && !busy && (
              <div className={styles.welcome}>
                <MiniLightCore size={72} />
                <h3>有什么想法，聊聊吧。</h3>
                <p>聊灵感、写文案、做分镜；想做作品时直接告诉我，我会给出方案，你确认后再放入画布。</p>
                <div>
                  {[
                    "一起聊聊这次创作的方向",
                    "帮我梳理参考图里的设计思路",
                    "帮我完善这段提示词",
                  ].map((s) => (
                    <button type="button" key={s} onClick={() => { setDraft(s); }}>
                      <Layers3 size={14} aria-hidden="true" />
                      {s}
                    </button>
                  ))}
                </div>
                <div className={styles.contextChips} aria-label="助手能看到">
                  <span>当前画布{props.nodes ? ` · ${props.nodes.length} 个节点` : ""}</span>
                  {useSelected && props.selectedNode && <span>已选 1 个节点</span>}
                  {attachments.length > 0 && <span>已附 {attachments.length} 个素材</span>}
                </div>
              </div>
            )
        )}
        renderItem={(m) => m.metadata.kind === "timeline" ? (
          <details className={styles.timeline}><summary><MiniLightCore size={18} />思考过程 · {(m.metadata.steps as AgentMessage[]).length} 步</summary><ol>{(m.metadata.steps as AgentMessage[]).map(step => <li key={step.id}><Check size={12} /><span>{agentToolNames[String(step.metadata.tool)] ?? "读取任务资料"}</span></li>)}</ol></details>
        ) : (
              <article
                key={m.id}
                className={`${styles.message} ${m.role === "user" ? styles.user : ""}`}
              >
                <small className={styles.messageHeading}>{m.role === "user" ? <UserRound size={13} aria-hidden="true" /> : <MiniLightCore size={22} />}<span>{m.role === "user" ? "你" : "创作助手"}</span>{m.role !== "user" && <span className={styles.messageTools}><time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleTimeString("zh-CN", { hour:"2-digit", minute:"2-digit" })}</time><button type="button" aria-label="复制助手回复" title="复制这条回复" onClick={() => void navigator.clipboard.writeText(m.content).catch(() => setError("复制失败，请选中文字复制。"))}><Copy size={12} /></button></span>}</small>
                <MessageContent content={m.metadata.kind === "tool"
                    ? `已完成：${({ read_canvas: "读取当前画布", list_models: "检查可用模型", inspect_assets: "读取参考素材", read_results: "检查生成结果" } as Record<string, string>)[String(m.metadata.tool)] ?? "读取任务资料"}`
                    : m.content} />
                {m.role === "assistant" && m.metadata.suggestPlan === true && <button type="button" className={styles.convertChip} disabled={busy} onClick={() => {
                  const context = agentReplyContext(session?.messages ?? [], m.id);
                  void submit(agentPlanRequest(context.message, m.content), undefined, false, "canvas-plan", context.attachmentAssetIds);
                }}><WandSparkles size={13} />把这个做成画布方案</button>}
                {(m.metadata.kind === "error" || m.metadata.kind === "status") &&
                  ["failed", "cancelled"].includes(String(m.metadata.status)) && (
                  <button disabled={busy} onClick={() => void editFailedRequest(m)}>重新编辑</button>
                )}
                {m.metadata.kind === "clarify" &&
                  Array.isArray(m.metadata.questions) &&
                  m.metadata.questions.map((raw, i) => {
                    const q = raw as { question: string; options: string[] };
                    return (
                      <div key={i} className={styles.question}>
                        <strong>{q.question}</strong>
                        <div>
                          {q.options.map((o) => (
                            <button
                              disabled={busy}
                              key={o}
                              onClick={() =>
                                setDraft(
                                  (d) =>
                                    `${d}${d ? "\n" : ""}${q.question}：${o}`,
                                )
                              }
                            >
                              {o}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                {m.metadata.kind === "helper" && (
                  <div className={styles.question}>
                    {((m.metadata.helpers as AgentModelOption[]) ?? []).map(
                      (h) => (
                        <button
                          disabled={busy}
                          key={keyOf(h)}
                          onClick={() =>
                            void submit(
                              "已确认使用视觉助手分析这些图片，继续完成之前的任务。",
                              {
                                connectionId: h.connectionId,
                                modelId: h.modelId,
                                assetIds: m.metadata.assetIds as string[],
                              },
                            )
                          }
                        >
                          确认使用 {h.supplierName} / {h.modelName} 分析图片
                        </button>
                      ),
                    )}
                    <button
                      disabled={busy}
                      onClick={() =>
                        void submit(
                          "先根据我的文字描述继续，不分析图片像素；保留原图用于之后的编辑节点。",
                          undefined,
                          true,
                        )
                      }
                    >
                      根据文字描述继续
                    </button>
                  </div>
                )}
                {m.metadata.artifact && session ? (
                  <ArtifactEditor
                    key={`${m.id}-${session.id}`}
                    artifact={m.metadata.artifact as AgentArtifact}
                    busy={busy}
                    onSave={(a) =>
                      run(async () => {
                        await agentRequest(
                          `/artifacts/${encodeURIComponent(m.id)}`,
                          { artifact: a },
                          "PATCH",
                        );
                        await refresh(session.id);
                      })
                    }
                    onCanvas={(a, shotIds) =>
                      run(async () => {
                        const texts =
                          a.kind === "storyboard"
                            ? a.shots
                                .filter((s) => shotIds.includes(s.id))
                                .map((s) => ({
                                  id: s.id,
                                  title: `${a.title} · ${s.id}`,
                                  content: s.prompt,
                                }))
                            : [
                                {
                                  id: "text",
                                  title: a.title,
                                  content: a.content,
                                },
                              ];
                        const plan = await agentRequest<AgentPlan>("/plans", {
                          sessionId: session.id,
                          intent: "canvas-plan",
                          proposal: {
                            type: "proposal",
                            summary: `将「${a.title}」放入画布`,
                            assumptions: [],
                            calls: [],
                            texts,
                          },
                        });
                        updatePlan(plan);
                      })
                    }
                    onContinue={(a) => {
                      setDraft(
                        `请为这份成果制作图片或视频的待确认画布方案，先规划，不执行：\n${JSON.stringify(a)}`,
                      );
                    }}
                  />
                ) : null}
              </article>
            )}
        footer={<>
            {streaming.text && <article className={styles.streaming} data-testid="agent-stream-output" data-interrupted={streamInterrupted}><MiniLightCore state={streamInterrupted ? "idle" : "streaming"} /><MessageContent content={streaming.text} />{!streamInterrupted && busy && <span className={styles.streamCursor} aria-hidden="true" />}{streamInterrupted && <small>回复已中断，未自动重发。</small>}</article>}
            {!legacy && session?.plans.map((p) => (
              <PlanCard
                key={`${p.id}:${p.version}`}
                plan={p}
                nodes={props.nodes}
                connections={props.connections}
                catalogConnections={catalogConnections}
                onManage={connectionId => props.onManageApi(undefined, connectionId)}
                busy={busy}
                onAction={(a, accept) => void planAction(p, a, accept)}
                onSave={(proposal) =>
                  run(async () => {
                    updatePlan(
                      await agentRequest<AgentPlan>(
                        `/plans/${p.id}`,
                        {
                          version: p.version,
                          proposal,
                          ...(["failed", "succeeded", "cancelled"].includes(p.status) ? { intent: "canvas-plan" } : {}),
                        },
                        "PATCH",
                      ),
                    );
                  })
                }
                onCancel={() =>
                  void run(async () =>
                    updatePlan(
                      await agentRequest<AgentPlan>(
                        `/plans/${p.id}`,
                        { version: p.version },
                        "DELETE",
                      ),
                    ),
                  )
                }
              />
            ))}
        {stage && (
          <p className={styles.stage} role="status" data-active={busy}>
            <MiniLightCore size={18} state={busy ? "thinking" : "idle"} />{stage.startsWith("正在回复") ? "正在组织思路…" : stage}
          </p>
        )}
        </>}
      />
      {error && (
        <div className={styles.error} role="alert">
          {error}
          <button type="button" aria-label="关闭智能体错误" title="关闭错误提示" onClick={() => setError("")}>
            <X size={13} />
          </button>
        </div>
      )}
      <div
        className={`agent-composer ${styles.composer}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("application/x-super-canvas-asset");
          const asset = props.assets.find((a) => a.id === id);
          if (asset) void run(async () => {
            if (!selected?.available) throw new Error("请先选择可用模型，再添加参考素材");
            const next = [...new Map([...attachments, asset].map((item) => [item.id, item])).values()];
            validateAppAttachments(withSelectedAsset(next));
            validateModelAttachments(selected, withSelectedAsset(next));
            setAttachments(next);
          });
          else void addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <div className={styles.attachments}>
          {attachments.map((a) => (
            <span key={a.id}>
              {a.kind === "image" && (
                <img alt={a.name} src={`/api/assets/${a.id}/content`} />
              )}
              <small title={a.name}>{a.name}</small>
              <button
                type="button"
                aria-label={`移除 ${a.name}`}
                title={`移除参考素材：${a.name}`}
                onClick={() =>
                  setAttachments((v) => v.filter((x) => x.id !== a.id))
                }
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <textarea
          ref={draftInput}
          rows={1}
          aria-label="创作任务要求"
          placeholder="聊聊想法，或告诉我你想制作什么…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              if (!busy && draft.trim()) void submit();
            }
          }}
        />
        <div className={styles.actions}>
          <input
            hidden
            type="file"
            multiple
            accept={acceptedMedia.map((type) => `${type.kind}/*`).join(",")}
            ref={fileInput}
            onChange={(e) => {
              if (e.target.files) void addFiles(Array.from(e.target.files));
              e.target.value = "";
            }}
          />
          <button
            type="button"
            aria-label="添加参考素材"
            title="添加参考素材"
            disabled={busy || !selected?.available || !acceptedMedia.length}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip size={16} />
          </button>
          {props.selectedNode && <button className={styles.selectionChip} type="button" aria-pressed={useSelected} title={"使用所选节点：" + props.selectedNode.data.label} onClick={() => setUseSelected(value => !value)}><Layers3 size={13} /><span>使用所选节点</span></button>}
          <button className={styles.modelChip} type="button" data-agent-popover-trigger aria-haspopup="dialog" aria-label="对话模型" aria-expanded={modelSettingsOpen} data-model-key={modelKey} disabled={busy} title={selected ? selected.modelId + " · " + selected.supplierName + " / " + selected.group : "选择对话模型"} onClick={() => { setSessionPickerOpen(false); setModelSettingsOpen(value => !value); }}>
            <span>{selected?.modelName ?? "选择模型"}</span><small>{reasoningOptions.find(option => option.value === reasoning)?.label ?? "自动"}思考</small><ChevronDown size={12} />
          </button>
          {busy ? (
            <button type="button" aria-label="停止分析" title="停止本次分析" onClick={stop}>
              <Square size={16} />
            </button>
          ) : (
            <button
              type="button"
              className={styles.primary}
              aria-label="发送任务"
              title="发送消息（Enter 发送；Shift+Enter 换行）。制作方案仍需逐步确认。"
              disabled={
                !selected?.available || (!draft.trim() && !attachments.length)
              }
              onClick={() => void submit()}
            >
              <Send size={16} />
              <span>发送</span>
            </button>
          )}
        </div>
        <p className={styles.intentHint}>{!selected ? "接入供应商后选择对话模型" : !selected.available ? selected.reason : intentHint}</p>
      </div>
      {modelSettingsOpen && <AgentModelPopover models={modelInventory} catalogConnections={catalogConnections} selected={selected} busy={busy} reasoning={reasoning} reasoningNotes={reasoningNotes} tk1688={tk1688Selection}
        onSelect={selectModel} onReasoning={value => setReasoningChoice({ model: modelKey, value })} onRefresh={() => void run(async () => { await modelLoad(); })}
        onManage={connectionId => { setModelSettingsOpen(false); props.onManageApi(connectionId ? undefined : selected?.group, connectionId); }} onClose={() => setModelSettingsOpen(false)} />}
      </DeferredPanelContent>
    </section>
  );
});

function ArtifactEditor({
  artifact,
  busy,
  onSave,
  onCanvas,
  onContinue,
}: {
  artifact: AgentArtifact;
  busy: boolean;
  onSave: (a: AgentArtifact) => Promise<void>;
  onCanvas: (a: AgentArtifact, ids: string[]) => Promise<void>;
  onContinue: (a: AgentArtifact) => void;
}) {
  const [value, setValue] = useState(artifact);
  const [selected, setSelected] = useState(artifact.shots.map((s) => s.id));
  const [error, setError] = useState("");
  const checked = () => {
    const p = AgentArtifactSchema.safeParse(value);
    if (!p.success) {
      setError(p.error.issues.map((i) => i.message).join("；"));
      return null;
    }
    setError("");
    return p.data;
  };
  return (
    <div className={styles.artifact}>
      <strong>{value.title}</strong>
      {value.kind === "text" ? (
        <textarea
          aria-label="文字成果"
          value={value.content}
          onChange={(e) => setValue((v) => ({ ...v, content: e.target.value }))}
        />
      ) : (
        <>
          <p>
            共 {value.shots.length} 个镜头 · {value.totalDuration} 秒
          </p>
          <label>
            总时长（秒）
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={value.totalDuration ?? 0}
              onChange={(e) =>
                setValue((v) => ({
                  ...v,
                  totalDuration: Number(e.target.value),
                }))
              }
            />
          </label>
          {value.shots.map((shot, index) => (
            <details key={shot.id} className={styles.shotCard}>
              <summary>
                <input
                  aria-label={`选择镜头 ${shot.id}`}
                  type="checkbox"
                  checked={selected.includes(shot.id)}
                  onChange={(e) =>
                    setSelected((s) =>
                      e.target.checked
                        ? [...s, shot.id]
                        : s.filter((id) => id !== shot.id),
                    )
                  }
                />
                <span className={styles.shotSummary}>
                  <strong>{shot.id} · {shot.start}–{shot.end}s</strong>
                  <small>{shot.camera}</small><span>{shot.action}</span>
                  <small>对白：{shot.dialogue || "—"}</small><small>声音：{shot.sound || "—"}</small>
                  <small className={styles.shotPrompt}>提示词：{shot.prompt}</small>
                </span>
              </summary>
              {(["start", "end"] as const).map((k) => (
                <label key={k}>
                  {k === "start" ? "开始" : "结束"}时间（秒）
                  <input
                    aria-label={`${shot.id} ${k === "start" ? "开始" : "结束"}时间`}
                    type="number"
                    min={0}
                    step={0.1}
                    value={shot[k]}
                    onChange={(e) =>
                      setValue((v) => ({
                        ...v,
                        shots: v.shots.map((s, i) =>
                          i === index
                            ? { ...s, [k]: Number(e.target.value) }
                            : s,
                        ),
                      }))
                    }
                  />
                </label>
              ))}
              {shot.assetIds.length > 0 && (
                <small>参考素材：{shot.assetIds.join("、")}</small>
              )}
              {(
                ["camera", "action", "dialogue", "sound", "prompt"] as const
              ).map((k) => (
                <label key={k}>
                  {
                    {
                      camera: "景别与运镜",
                      action: "画面动作",
                      dialogue: "台词",
                      sound: "声音",
                      prompt: "镜头提示词",
                    }[k]
                  }
                  <textarea
                    aria-label={`${shot.id} ${{ camera: "景别与运镜", action: "画面动作", dialogue: "台词", sound: "声音", prompt: "镜头提示词" }[k]}`}
                    value={shot[k]}
                    onChange={(e) =>
                      setValue((v) => ({
                        ...v,
                        shots: v.shots.map((s, i) =>
                          i === index ? { ...s, [k]: e.target.value } : s,
                        ),
                      }))
                    }
                  />
                </label>
              ))}
            </details>
          ))}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <div className={styles.buttons}>
        <button
          className={styles.ghost}
          disabled={busy}
          onClick={() => {
            const a = checked();
            if (a) void onSave(a);
          }}
        >
          保存成果
        </button>
        <button
          className={styles.ghost}
          onClick={() =>
            void navigator.clipboard.writeText(
              value.kind === "text"
                ? value.content
                : JSON.stringify(value, null, 2),
            )
          }
        >
          复制
        </button>
        <button
          className={styles.primary}
          disabled={busy || (value.kind === "storyboard" && !selected.length)}
          onClick={() => {
            const a = checked();
            if (a) void onCanvas(a, selected);
          }}
        >
          预览放入画布方案
        </button>
        <button className={styles.ghost} disabled={busy} onClick={() => onContinue(value)}>
          继续规划配图或视频
        </button>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  nodes,
  connections,
  catalogConnections,
  onManage,
  busy,
  onAction,
  onSave,
  onCancel,
}: {
  plan: AgentPlan;
  nodes?: readonly CanvasNode[];
  connections: readonly ProviderConnectionView[];
  catalogConnections: readonly AgentCatalogConnection[];
  onManage: (connectionId: string) => void;
  busy: boolean;
  onAction: (action: string, accept?: boolean) => void;
  onSave: (p: AgentProposal) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(plan.proposal);
  const [dirty, setDirty] = useState(false);
  const [accept, setAccept] = useState(false);
  const editable = plan.status === "awaiting_approval";
  const nodeName = (nodeId: string, index: number) =>
    nodes?.find((node) => node.id === nodeId)?.data.label ||
    plan.patch?.nodes.find((node) => node.id === nodeId)?.data.label ||
    plan.proposal.texts.find((text) => text.targetNodeId === nodeId)?.title ||
    `节点 ${index + 1}`;
  return (
    <article className={`${styles.card} ${styles.productionCard}`}>
      <span className={styles.productionLabel}><Layers3 size={14} />画布方案</span>
      <small>
        {statusNames[plan.status] ?? plan.status} · 方案 v{plan.version}
      </small>
      <h4>{plan.summary}</h4>
      <ol className={styles.planProgress} aria-label="方案进度">
        <li aria-current={editable ? "step" : undefined}>① 检查方案</li>
        <li aria-current={plan.status === "materializing" || (plan.status === "awaiting_execution" && !plan.preflight) ? "step" : undefined}>② 放入画布</li>
        <li aria-current={plan.preflight || ["approved", "running", "succeeded"].includes(plan.status) ? "step" : undefined}>③ 估算费用并开始生成</li>
      </ol>
      {plan.error && <p role="alert">{plan.error}</p>}
      {plan.results?.map((result, index) => {
        const status = resultStatuses[result.status] ?? {
          label: "状态待确认", Icon: Circle, tone: "neutral",
        };
        const name = nodeName(result.nodeId, index);
        return (
          <div key={result.nodeId} className={styles.result}>
            <div className={styles.resultHeading}>
              <strong className={styles.resultName} title={name}>{name}</strong>
              <span className={styles.resultStatus} data-tone={status.tone}>
                <status.Icon size={13} aria-hidden="true" />
                {status.label}
              </span>
            </div>
            <small>{result.assetIds.length} 个成果</small>
            <details>
              <summary>节点详情</summary>
              <small>节点 ID：{result.nodeId}</small>
              {!resultStatuses[result.status] && <small>原始状态：{result.status}</small>}
            </details>
            {result.error && <p role="alert">{result.error}</p>}
          </div>
        );
      })}
      {plan.changes?.map((change, index) => (
        <details key={change.nodeId}>
          <summary className={styles.changeName} title={nodeName(change.nodeId, index)}>
            修改差异 · {nodeName(change.nodeId, index)}
          </summary>
          <small>节点 ID：{change.nodeId}</small>
          <p>修改前</p>
          <pre>{change.before}</pre>
          <p>修改后</p>
          <pre>{change.after}</pre>
        </details>
      ))}
      {draft.assumptions.length > 0 && <p>{draft.assumptions.join("；")}</p>}
      {draft.texts.map((t, i) => (
        <details key={t.id}>
          <summary>
            {t.targetNodeId ? "修改提示词" : "文本节点"} · {t.title}
          </summary>
          <textarea
            aria-label={`${t.title} 内容`}
            readOnly={!editable}
            value={t.content}
            onChange={(e) => {
              setDirty(true);
              setDraft((v) => ({
                ...v,
                texts: v.texts.map((x, j) =>
                  i === j ? { ...x, content: e.target.value } : x,
                ),
              }));
            }}
          />
        </details>
      ))}
      {draft.calls.map((c, i) => {
        const route = plan.calls.find((r) => r.id === c.id);
        const unmatchedReasons = route && !route.selected?.eligible ? [...new Set(route.alternatives.flatMap(option => option.exclusionReasons))] : [];
        const selected = route?.alternatives.find(option =>
          option.candidate.connectionId === c.preferredConnectionId && option.candidate.model.id === c.preferredModelId,
        )?.candidate ?? route?.selected?.candidate;
        return (
          <details key={c.id} className={styles.planStep}>
            <summary>
              <Layers3 size={16} aria-hidden="true" />
              <span><strong>{c.label}</strong><small title={c.requirements.operation}>{agentOperationNames[c.requirements.operation] ?? "创作步骤"} · {c.requirements.count} 项</small>
                <p className={styles.promptPreview}>{c.prompt}</p>
                <small className={styles.stepMeta}>依赖：{c.dependsOn?.map(id => draft.calls.find(call => call.id === id)?.label ?? id).join("、") || "无"} · 推荐模型：<code>{selected?.model.id ?? c.preferredModelId ?? "—"}</code>{selected?.model && <> · {modelPickerPriceCompact(selected.model)}</>}</small>
                {route && !route.selected?.eligible && <small className={styles.stepMeta} title={unmatchedReasons.join("；")}>
                  待选择合法渠道 · {unmatchedReasons[0] ?? "当前选择尚未匹配该步骤"}
                </small>}
              </span><ChevronDown size={13} />
            </summary>
            <textarea
              aria-label={`${c.label} 提示词`}
              readOnly={!editable}
              value={c.prompt}
              onChange={(e) => {
                setDirty(true);
                setDraft((v) => ({
                  ...v,
                  calls: v.calls.map((x, j) =>
                    i === j ? { ...x, prompt: e.target.value } : x,
                  ),
                }));
              }}
            />
            <small>
              <span title={c.sourceAssetIds.join("、")}>参考素材 {c.sourceAssetIds.length} 项</span> · 依赖：
              {c.dependsOn?.map(id => draft.calls.find(call => call.id === id)?.label ?? id).join("、") || "无"}
            </small>
            {route && !route.selected?.eligible && <p role="status" className={styles.parameterNotice}>
              待选择合法渠道：{unmatchedReasons.length ? unmatchedReasons.join("；") : "当前选择未匹配此步骤的要求，请选择渠道并检查参数。"}。所需规格已保留，尚不能放入画布。
            </p>}
            <AgentPlanStepEditor call={c} route={route} connections={connections} catalogConnections={catalogConnections} onManage={onManage} disabled={!editable || busy} onChange={next => {
              setDirty(true);
              setDraft(value => ({ ...value, calls: value.calls.map((call, index) => index === i ? next : call) }));
            }} />
            {c.recommendation && <small>{c.recommendation}</small>}
          </details>
        );
      })}
      {plan.preflight && plan.status === "awaiting_execution" && (
        <div className={styles.preflight}>
          <strong>费用与执行确认</strong>
          <p>{plan.preflight.summary}</p>
          <p>
            {plan.preflight.unknownPrice
              ? "部分费用未知，请根据渠道计费确认。"
              : `预计上限 ¥${plan.preflight.totalCnyMaximum}`}
          </p>
          {plan.preflight.unknownPrice && (
            <label>
              <input
                type="checkbox"
                checked={accept}
                onChange={(e) => setAccept(e.target.checked)}
              />
              我已了解价格未知，确认生成
            </label>
          )}
          <button
            className={styles.primary}
            disabled={busy || (plan.preflight.unknownPrice && !accept)}
            onClick={() => onAction("execute", accept)}
          >
            <Play size={14} />
            开始生成（{plan.preflight.unknownPrice ? "部分费用未知" : `预计上限 ¥${plan.preflight.totalCnyMaximum ?? "—"}`}）
          </button>
        </div>
      )}
      <div className={styles.buttons}>
        {editable && (
          <>
            <button className={styles.ghost} disabled={busy} onClick={() => void onSave(draft)}>
              <RefreshCw size={13} />
              {dirty ? "保存方案修改" : "检查方案与模型"}
            </button>
            <button
              className={styles.primary}
              disabled={busy || dirty || !plan.patch}
              onClick={() => onAction("materialize")}
            >
              <Check size={14} />
              放入画布
            </button>
          </>
        )}
        {plan.status === "materializing" && (
          <button className={styles.primary} disabled={busy} onClick={() => onAction("materialize")}>
            恢复放入画布
          </button>
        )}
        {plan.status === "awaiting_execution" && (
          <button className={plan.preflight ? styles.ghost : styles.primary} disabled={busy} onClick={() => onAction("preflight")}>
            {plan.preflight ? "重新估算费用" : "估算费用"}
          </button>
        )}
        {["awaiting_approval", "awaiting_execution"].includes(plan.status) && (
          <button className={styles.dangerText} disabled={busy} onClick={onCancel}>
            取消方案
          </button>
        )}
        {["failed", "succeeded", "cancelled"].includes(plan.status) && (
          <button className={styles.primary} disabled={busy} onClick={() => void onSave(draft)}>
            以此创建新方案
          </button>
        )}
      </div>
    </article>
  );
}
