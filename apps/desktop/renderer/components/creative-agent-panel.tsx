"use client";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  Bot,
  Plus,
  Paperclip,
  Send,
  Square,
  Plug,
  X,
  RefreshCw,
  Check,
  Play,
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
import {
  uploadAsset,
  fetchProjectChat,
  fetchAssets,
  type ProviderConnectionView,
} from "../lib/client-api";
import { agentHistoryStorageKey } from "../lib/agent-chat-history";
import type { AssetView, CanvasNode } from "./types";
import {
  AgentCanvasContext,
  type AgentCanvasResult,
} from "./agent-canvas-context";
import styles from "./creative-agent-panel.module.css";

type Props = {
  connections: ProviderConnectionView[];
  assets: AssetView[];
  canvasId: string;
  selectedNode: CanvasNode | null;
  selectedPrompt: string;
  draftRequest: { id: string; text: string; assetId?: string } | null;
  onManageApi: (group?: string) => void;
  onClose?: () => void;
  placement?: "left" | "right";
};
const keyOf = (m: AgentModelOption) => `${m.connectionId}\n${m.modelId}`;
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
  cancelled: "已取消",
  expired: "方案已过期",
};

export function AgentPanel(props: Props) {
  const bridge = useContext(AgentCanvasContext);
  const [session, setSession] = useState<AgentSession | null>(null);
  const [sessions, setSessions] = useState<
    Array<{ id: string; title: string }>
  >([]);
  const [models, setModels] = useState<AgentModelOption[]>([]);
  const [choice, setChoice] = useState("");
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AssetView[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [legacy, setLegacy] = useState<string[] | null>(null);
  const [useSelected, setUseSelected] = useState(true);
  const [reasoningChoice, setReasoningChoice] = useState({ model: "", value: "auto" });
  const abort = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const modelReadVersion = useRef(0);
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
  const selected =
    models.find((m) => keyOf(m) === choice) ??
    models.find((m) => m.available) ??
    models[0];
  const modelKey = selected ? keyOf(selected) : "";
  const reasoningOptions = selected?.reasoningOptions ?? [{ value: "auto", label: "自动" }];
  const reasoning = reasoningChoice.model === modelKey &&
    reasoningOptions.some((option) => option.value === reasoningChoice.value)
    ? reasoningChoice.value : "auto";
  const reasoningSourceLabel = selected?.reasoningFallback && selected.reasoningSource !== "official-model"
    ? "渠道实测＋官网默认（未全部实测）" : ({
    live: "已知思考档位（含当前连接实测）",
    "channel-verification": "已知思考档位（含同渠道实测）",
    "provider-catalog": "供应商声明的思考档位",
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
    if (model) setChoice(keyOf(model));
    setReasoningChoice({ model: "", value: "auto" });
  };
  const firstAvailable = (items: AgentModelOption[]) => items.find((m) => m.available) ?? items[0];
  const suppliers = [
    ...new Map(models.map((m) => [m.supplierId, m.supplierName])).entries(),
  ];
  const groups = [
    ...new Set(
      models
        .filter((m) => m.supplierId === selected?.supplierId)
        .map((m) => m.group),
    ),
  ];
  const connections = [
    ...new Map(
      models
        .filter(
          (m) =>
            m.supplierId === selected?.supplierId &&
            m.group === selected?.group,
        )
        .map((m) => [m.connectionId, m.connectionName]),
    ).entries(),
  ];
  const groupModels = models.filter(
    (m) => m.connectionId === selected?.connectionId,
  );
  const modelLoad = useCallback(async () => {
    const version = ++modelReadVersion.current;
    const items = await agentRequest<AgentModelOption[]>(
      "/models",
      undefined,
      "GET",
    );
    if (alive.current && version === modelReadVersion.current)
      setModels(current => JSON.stringify(current) === JSON.stringify(items) ? current : items);
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
    const savedModel = localStorage.getItem(`agent-model:${props.canvasId}`);
    void Promise.all([
      modelLoad(),
      agentRequest<Array<{ id: string; title: string }>>(
        `/sessions?canvasId=${encodeURIComponent(props.canvasId)}`,
        undefined,
        "GET",
        controller.signal,
      ),
    ])
      .then(async ([, list]) => {
        if (!alive.current) return;
        setSessions(list);
        if (savedModel) setChoice(savedModel);
        const last = window.localStorage.getItem(
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
      window.localStorage.setItem(`agent-task:${props.canvasId}`, sessionId);
  }, [sessionId, props.canvasId]);
  useEffect(() => {
    conversation.current?.scrollTo({
      top: conversation.current.scrollHeight,
      behavior: "smooth",
    });
  }, [session?.messages.length, stage]);
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
    if (modelKey)
      localStorage.setItem(`agent-model:${props.canvasId}`, modelKey);
  }, [modelKey, props.canvasId]);
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
  ) =>
    run(async () => {
      if (!selected?.available)
        throw new Error(selected?.reason ?? "请先配置智能体模型");
      const turnAttachments = withSelectedAsset(attachments);
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
      abort.current = new AbortController();
      setDraft("");
      setLegacy(null);
      setStage("正在读取任务");
      let succeeded = false;
      try {
        await streamAgentTurn(
        {
          canvasId: props.canvasId,
          sessionId: task.id,
          requestId: crypto.randomUUID(),
          connectionId: selected.connectionId,
          modelId: selected.modelId,
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
          if (event.type === "session") setSession(event.session);
          if (event.type === "error") setError(event.message);
          if (event.type === "done") succeeded = event.status !== "failed" && event.status !== "cancelled";
        },
        abort.current.signal,
        );
      } catch (error) {
        if (alive.current && current === operation.current) setDraft(message);
        throw error;
      } finally {
        if (alive.current && current === operation.current) {
          if (succeeded) setAttachments([]);
          setStage("");
          // The durable session contains the result even if the event stream broke.
          await Promise.allSettled([refresh(task.id), modelLoad()]);
        }
      }
    });
  const stop = () => {
    abort.current?.abort();
    activity.current++;
    working.current = false;
    operation.current++;
    setStage("分析已停止");
    setBusy(false);
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
  return (
    <section
      className={`agent-panel ${styles.panel}`}
      aria-label="通用创作智能体"
    >
      <header className={styles.header}>
        <span>
          <Bot size={19} />
          <strong>创作智能体</strong>
        </span>
        <div>
          <button
            aria-label="新创作任务"
            disabled={busy}
            onClick={() => void run(newTask)}
          >
            <Plus size={17} />
          </button>
          <button
            aria-label="刷新模型列表"
            title="刷新已接入模型"
            disabled={busy}
            onClick={() => void run(modelLoad)}
          >
            <RefreshCw size={16} />
          </button>
          <button
            aria-label="管理供应商与模型"
            title="管理供应商与模型"
            onClick={() => props.onManageApi(selected?.group)}
          >
            <Plug size={17} />
          </button>
          {props.onClose && (
            <button aria-label="关闭智能体" title="关闭智能体" onClick={props.onClose}>
              <X size={17} />
            </button>
          )}
        </div>
      </header>
      <div className={styles.tasks}>
        <select
          aria-label="创作任务"
          value={session?.id ?? ""}
          disabled={busy}
          onChange={(e) =>
            void run(async () => {
              operation.current++;
              const next = await agentRequest<AgentSession>(
                `/sessions/${e.target.value}`,
                undefined,
                "GET",
              );
              if (alive.current) {
                setSession(next);
                setLegacy(null);
              }
            })
          }
        >
          <option value="" disabled>
            开始一个创作任务
          </option>
          {[
            ...(session && !sessions.some((s) => s.id === session.id)
              ? [session]
              : []),
            ...sessions,
          ].map((s) => (
            <option value={s.id} key={s.id}>
              {s.id === session?.id ? session.title : s.title}
            </option>
          ))}
        </select>
        <button
          onClick={() =>
            void run(async () => {
              let local: Array<{ text?: string }> = [];
              try {
                const saved = JSON.parse(localStorage.getItem(agentHistoryStorageKey(props.canvasId)) ?? "[]");
                if (Array.isArray(saved)) local = saved;
              } catch { /* Older local history may be incomplete. */ }
              const [remote, history] = await Promise.all([
                fetchProjectChat(props.canvasId),
                agentRequest<{ sessions: Array<{ title: string; messages: Array<{ role: string; content: string }> }> }>(
                  `/legacy?canvasId=${encodeURIComponent(props.canvasId)}`, undefined, "GET",
                ),
              ]);
              setLegacy([
                ...local.flatMap((m) => typeof m?.text === "string" ? [m.text] : []),
                ...remote.map((m) => m.content),
                ...history.sessions.flatMap((s) => [
                  `历史任务：${s.title}`,
                  ...s.messages.map((m) => `${m.role === "user" ? "你" : "智能体"}：${m.content}`),
                ]),
              ]);
            })
          }
        >
          旧对话
        </button>
      </div>
      <div className={styles.conversation} ref={conversation}>
        {legacy ? (
          <article className={styles.card}>
            <button onClick={() => setLegacy(null)}>返回当前任务</button>
            <p>旧对话只读保留；旧附件可能只有文件名记录。</p>
            {!legacy.length && <p>暂无旧对话。</p>}
            {legacy.map((text, i) => (
              <p key={i}>{text}</p>
            ))}
          </article>
        ) : (
          <>
            {!session?.messages.length && (
              <div className={styles.welcome}>
                <Bot size={30} />
                <h3>把创作任务交给我</h3>
                <p>写分镜、改图片、优化文案，或把多个步骤组合成画布工作流。</p>
                <div>
                  {[
                    "帮我写一份广告分镜",
                    "分析参考图并制定修改方案",
                    "帮我完善这段提示词",
                  ].map((s) => (
                    <button key={s} onClick={() => setDraft(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {session?.messages.map((m) => (
              <article
                key={m.id}
                className={`${styles.message} ${m.role === "user" ? styles.user : ""}`}
              >
                <small>{m.role === "user" ? "你" : "智能体"}</small>
                <p>
                  {m.metadata.kind === "tool"
                    ? `已完成：${({ read_canvas: "读取当前画布", list_models: "检查可用模型", inspect_assets: "读取参考素材", read_results: "检查生成结果" } as Record<string, string>)[String(m.metadata.tool)] ?? "读取任务资料"}`
                    : m.content}
                </p>
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
                    onContinue={(a) =>
                      setDraft(
                        `请为这份成果规划图片或视频节点，先给我确认方案：\n${JSON.stringify(a)}`,
                      )
                    }
                  />
                ) : null}
              </article>
            ))}
            {session?.plans.map((p) => (
              <PlanCard
                key={`${p.id}:${p.version}`}
                plan={p}
                busy={busy}
                onAction={(a, accept) => void planAction(p, a, accept)}
                onSave={(proposal) =>
                  run(async () => {
                    updatePlan(
                      await agentRequest<AgentPlan>(
                        `/plans/${p.id}`,
                        { version: p.version, proposal },
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
          </>
        )}
        {stage && (
          <p className={styles.stage} role="status">
            {stage}
          </p>
        )}
      </div>
      {error && (
        <div className={styles.error} role="alert">
          {error}
          <button aria-label="关闭智能体错误" onClick={() => setError("")}>
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
        {props.selectedNode && (
          <label className={styles.context}>
            <input
              type="checkbox"
              checked={useSelected}
              onChange={(e) => setUseSelected(e.target.checked)}
            />
            引用所选节点：{props.selectedNode.data.label}
          </label>
        )}
        <div className={styles.attachments}>
          {attachments.map((a) => (
            <span key={a.id}>
              {a.kind === "image" && (
                <img alt={a.name} src={`/api/assets/${a.id}/content`} />
              )}
              <small>{a.name}</small>
              <button
                aria-label={`移除 ${a.name}`}
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
          aria-label="创作任务要求"
          placeholder="描述你想完成的任务，也可以粘贴或拖入参考素材…"
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
        <div className={styles.selectors}>
          <select
            aria-label="智能体 API 供应商"
            value={selected?.supplierId ?? ""}
            disabled={busy}
            onChange={(e) => {
              selectModel(firstAvailable(models.filter((m) => m.supplierId === e.target.value)));
            }}
          >
            <option value="" disabled>
              选择供应商
            </option>
            {suppliers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="智能体模型群组"
            value={selected?.group ?? ""}
            disabled={busy}
            onChange={(e) => {
              const items = models.filter(
                (m) =>
                  m.supplierId === selected?.supplierId &&
                  m.group === e.target.value,
              );
              selectModel(firstAvailable(items));
            }}
          >
            <option value="" disabled>
              选择分组
            </option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          {connections.length > 1 && (
            <select
              aria-label="智能体分组连接"
              value={selected?.connectionId ?? ""}
              disabled={busy}
              onChange={(e) => {
                selectModel(firstAvailable(models.filter((m) => m.connectionId === e.target.value)));
              }}
            >
              {connections.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="智能体模型"
            value={modelKey}
            disabled={busy}
            onChange={(e) => selectModel(models.find((m) => keyOf(m) === e.target.value))}
          >
            <option value="" disabled>
              选择主模型
            </option>
            {groupModels.map((m) => (
              <option key={keyOf(m)} value={keyOf(m)} disabled={!m.available}>
                {m.modelName}
                {!m.available ? ` · ${m.reason}` : ""}
              </option>
            ))}
          </select>
          <select
              aria-label="思考强度"
              title={selected?.reasoningNotice}
              value={reasoning}
              disabled={busy || !selected?.available}
              onChange={(e) => setReasoningChoice({ model: modelKey, value: e.target.value })}
            >
              {reasoningOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.value === "auto" ? (reasoningOptions.length > 1 ? "思考强度：自动"
                    : selected?.reasoningNotice ? "思考强度：自动（资料待补充）" : selected?.reasoningSource && selected.reasoningSource !== "unknown"
                      ? "思考强度：自动（无可选档位）" : "思考强度：自动（待识别）") : option.label}
                </option>
              ))}
          </select>
        </div>
        {reasoningOptions.length > 1 && reasoningSourceLabel && <small className={styles.reasoningSource}>{reasoningSourceLabel}</small>}
        {selected?.reasoningNotice && <small className={styles.reasoningSource}>{selected.reasoningNotice}</small>}
        {selected?.available && <div className={styles.mediaSupport} aria-label="模型参考素材支持">
          {mediaKinds.map((type) => {
            const supported = selected.capabilities[type.capability];
            const limit = selected.inputLimits?.[type.limit];
            return <span key={type.kind}>
              {type.label}：{!supported ? "暂不可用" : `${type.kind === "image" && selected.imageInputStatus === "assumed" ? "默认支持" : "支持"} · ${limit === undefined ? "供应商未注明数量" : `最多 ${limit} ${type.unit}`}`}
            </span>;
          })}
          {selected.inputLimits?.maxAssets !== undefined && <span>供应商每轮总量：最多 {selected.inputLimits.maxAssets} 个附件</span>}
          <small>本应用每轮最多 16 个附件，单个 16 MB，总计 24 MB；引用节点素材计入。</small>
        </div>}
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
            aria-label="添加参考素材"
            disabled={busy || !selected?.available || !acceptedMedia.length}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip size={16} />
          </button>
          <small>
            {!selected ? "接入供应商后自动读取可用模型"
              : !selected.available ? selected.reason
              : attachments.length ? `已添加 ${attachments.length} 个参考素材`
              : acceptedMedia.length ? "添加参考素材" : "当前模型仅可读取文字"}
          </small>
          {busy ? (
            <button aria-label="停止分析" onClick={stop}>
              <Square size={16} />
            </button>
          ) : (
            <button
              className={styles.primary}
              aria-label="发送任务"
              disabled={
                !selected?.available || (!draft.trim() && !attachments.length)
              }
              onClick={() => void submit()}
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

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
            <details key={shot.id}>
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
                {shot.id} · {shot.start}–{shot.end}s · {shot.camera}
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
          disabled={busy}
          onClick={() => {
            const a = checked();
            if (a) void onSave(a);
          }}
        >
          保存成果
        </button>
        <button
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
          disabled={busy || (value.kind === "storyboard" && !selected.length)}
          onClick={() => {
            const a = checked();
            if (a) void onCanvas(a, selected);
          }}
        >
          预览放入画布方案
        </button>
        <button disabled={busy} onClick={() => onContinue(value)}>
          继续规划配图或视频
        </button>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  busy,
  onAction,
  onSave,
  onCancel,
}: {
  plan: AgentPlan;
  busy: boolean;
  onAction: (action: string, accept?: boolean) => void;
  onSave: (p: AgentProposal) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(plan.proposal);
  const [dirty, setDirty] = useState(false);
  const [accept, setAccept] = useState(false);
  const editable = plan.status === "awaiting_approval";
  return (
    <article className={styles.card}>
      <small>
        {statusNames[plan.status] ?? plan.status} · 方案 v{plan.version}
      </small>
      <h4>{plan.summary}</h4>
      {plan.error && <p role="alert">{plan.error}</p>}
      {plan.results?.map((result) => (
        <div key={result.nodeId}>
          <small>
            {result.nodeId} · {result.status} · {result.assetIds.length} 个成果
          </small>
          {result.error && <p role="alert">{result.error}</p>}
        </div>
      ))}
      {plan.changes?.map((change) => (
        <details key={change.nodeId}>
          <summary>修改差异 · {change.nodeId}</summary>
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
        const selected = route?.selected?.candidate;
        return (
          <details key={c.id} open>
            <summary>
              {c.label} · {c.requirements.operation}
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
              源素材：{c.sourceAssetIds.join("、") || "无"}　依赖：
              {c.dependsOn?.join("、") || "无"}
            </small>
            <select
              aria-label={`${c.label} 执行模型`}
              disabled={!editable || busy}
              value={`${c.preferredConnectionId ?? selected?.connectionId ?? ""}\n${c.preferredModelId ?? selected?.model.id ?? ""}`}
              onChange={(e) => {
                const [connectionId, modelId] = e.target.value.split("\n");
                setDirty(true);
                setDraft((v) => ({
                  ...v,
                  calls: v.calls.map((x, j) =>
                    i === j
                      ? {
                          ...x,
                          preferredConnectionId: connectionId,
                          preferredModelId: modelId,
                        }
                      : x,
                  ),
                }));
              }}
            >
              <option value="\n">请选择可用执行模型</option>
              {route?.alternatives.map((q) => (
                <option
                  key={`${q.candidate.connectionId}:${q.candidate.model.id}`}
                  disabled={!q.eligible}
                  value={`${q.candidate.connectionId}\n${q.candidate.model.id}`}
                >
                  {q.candidate.connectionName} / {q.candidate.model.name}
                  {q.eligible
                    ? q.pricingStatus === "known"
                      ? ` · ≤¥${q.cnyMaximum}`
                      : " · 价格未知"
                    : ` · ${q.exclusionReasons.join("；")}`}
                </option>
              ))}
            </select>
            <label>
              数量
              <input
                type="number"
                min={1}
                max={c.requirements.operation.startsWith("video") ? 1 : 20}
                disabled={!editable}
                value={c.requirements.count}
                onChange={(e) => {
                  setDirty(true);
                  setDraft((v) => ({
                    ...v,
                    calls: v.calls.map((x, j) =>
                      i === j
                        ? {
                            ...x,
                            requirements: {
                              ...x.requirements,
                              count: Number(e.target.value),
                            },
                          }
                        : x,
                    ),
                  }));
                }}
              />
            </label>
            {c.recommendation && <small>{c.recommendation}</small>}
            {(
              [
                ["aspectRatio", "画面比例"],
                ["resolution", "分辨率"],
                ["durationSeconds", "时长（秒）"],
                ["quality", "质量"],
              ] as const
            )
              .filter(
                ([k]) =>
                  k !== "durationSeconds" ||
                  c.requirements.operation.startsWith("video"),
              )
              .map(([k, label]) => (
                <label key={k}>
                  {label}
                  <input
                    aria-label={`${c.label} ${label}`}
                    type={k === "durationSeconds" ? "number" : "text"}
                    disabled={!editable || busy}
                    value={c.requirements[k] ?? ""}
                    placeholder="模型默认"
                    onChange={(e) => {
                      const value = e.target.value;
                      setDirty(true);
                      setDraft((v) => ({
                        ...v,
                        calls: v.calls.map((x, j) =>
                          i === j
                            ? {
                                ...x,
                                requirements: {
                                  ...x.requirements,
                                  [k]: value
                                    ? k === "durationSeconds"
                                      ? Number(value)
                                      : value
                                    : undefined,
                                },
                              }
                            : x,
                        ),
                      }));
                    }}
                  />
                </label>
              ))}
          </details>
        );
      })}
      {plan.preflight && plan.status === "awaiting_execution" && (
        <div className={styles.preflight}>
          <strong>最终执行检查</strong>
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
            第二次确认：开始生成
          </button>
        </div>
      )}
      <div className={styles.buttons}>
        {editable && (
          <>
            <button disabled={busy} onClick={() => void onSave(draft)}>
              <RefreshCw size={13} />
              {dirty ? "保存方案修改" : "刷新方案与模型"}
            </button>
            <button
              className={styles.primary}
              disabled={busy || dirty || !plan.patch}
              onClick={() => onAction("materialize")}
            >
              <Check size={14} />
              第一次确认：放入画布
            </button>
          </>
        )}
        {plan.status === "materializing" && (
          <button disabled={busy} onClick={() => onAction("materialize")}>
            恢复放入画布
          </button>
        )}
        {plan.status === "awaiting_execution" && (
          <button disabled={busy} onClick={() => onAction("preflight")}>
            我已检查节点，进行预检
          </button>
        )}
        {["awaiting_approval", "awaiting_execution"].includes(plan.status) && (
          <button disabled={busy} onClick={onCancel}>
            取消方案
          </button>
        )}
        {["failed", "succeeded", "cancelled"].includes(plan.status) && (
          <button disabled={busy} onClick={() => void onSave(draft)}>
            以此创建新方案
          </button>
        )}
      </div>
    </article>
  );
}
