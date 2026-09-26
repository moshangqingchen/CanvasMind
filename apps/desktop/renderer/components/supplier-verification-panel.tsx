"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Pause, Play, Copy, ExternalLink } from "lucide-react";
import type {
  SupplierVerificationRecord,
  SupplierVerificationCase,
} from "@super-canvas/db";
import { EVIDENCE_LABELS } from "../lib/supplier-capabilities";

type RecordView = Omit<SupplierVerificationRecord, "cases"> & {
  cases: Array<
    Omit<SupplierVerificationCase, "task" | "fingerprint"> & { taskId?: string }
  >;
};
const labels: Record<string, string> = {
  queued: "等待开始",
  submitting: "正在提交",
  running: "正在生成",
  archiving: "下载保存",
  succeeded: "已完成",
  unsupported: "此参数不可用",
  inconclusive: "暂未确认",
  needs_attention: "需要处理",
  cancelled: "已取消",
  superseded: "已替代，无需提交",
};

type SupplierVerificationPanelProps = {
  supplierId?: string;
  active: boolean;
};

export function SupplierVerificationPanel(props: SupplierVerificationPanelProps) {
  return <SupplierVerificationSession key={props.supplierId ?? ""} {...props} />;
}

function SupplierVerificationSession({
  supplierId,
  active,
}: SupplierVerificationPanelProps) {
  const [record, setRecord] = useState<RecordView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retestId, setRetestId] = useState<string | null>(null);
  const [newRound, setNewRound] = useState(false);
  const [group, setGroup] = useState("");
  const requestVersion = useRef(0);
  const actionPending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestVersion.current += 1;
    };
  }, []);
  const read = useCallback(
    async (signal?: AbortSignal) => {
      if (!supplierId || actionPending.current) return;
      const version = ++requestVersion.current;
      const response = await fetch(
        `/api/suppliers/${encodeURIComponent(supplierId)}/verification`,
        { cache: "no-store", signal },
      );
      if (!response.ok) throw new Error("核验记录暂时无法读取");
      const next = await response.json();
      if (signal?.aborted || !mounted.current || version !== requestVersion.current) return;
      setRecord(next);
      setError("");
    },
    [supplierId],
  );
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let loading = false;
    const load = () => {
      if (document.hidden || loading) return;
      loading = true;
      void read(controller.signal).catch((error: unknown) => {
        if (!controller.signal.aborted && !actionPending.current)
          setError(error instanceof Error ? error.message : "核验记录暂时无法读取");
      }).finally(() => { loading = false; });
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [active, read]);
  async function action(value: string, caseId?: string) {
    if (!supplierId || actionPending.current) return;
    actionPending.current = true;
    requestVersion.current += 1;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/suppliers/${encodeURIComponent(supplierId)}/verification`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: value, caseId }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "核验操作失败");
      if (!mounted.current) return;
      setRecord(data);
      setNewRound(false);
      setRetestId(null);
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : "核验操作失败");
    } finally {
      actionPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  if (!active) return null;
  const groups = [...new Set([...(record?.coverage ?? []).map(item => item.group), ...(record?.cases ?? []).map(item => item.group), ...(record?.skipped ?? []).flatMap(item => item.group ? [item.group] : [])])];
  const cases = record?.cases.filter(item => !group || item.group === group) ?? [];
  const evidence = record?.evidence.filter(item => !group || item.group === group) ?? [];
  const skipped = record?.skipped.filter(item => !group || item.group === group) ?? [];
  return (
    <section className="sm-verification" aria-label="供应商自动核验">
      <div className="sm-verification-heading">
        <div>
          <h3>能力与价格核验</h3>
          <p>覆盖每个分组的不同图片型号，只测试说明未明确的能力。</p>
        </div>
        <span className="sm-badge">
          已提交 {record?.used ?? 0} 次 · 待测 {record?.cases.filter(item => item.status === "queued").length ?? 0} 项
        </span>
      </div>
      <div className="sm-notice">
        每个分组的生图模型优先使用最高质量，只选一个尺寸。说明已明确的能力直接采用；失败且确认未扣费时继续降低质量测试。仅明确拒绝参数才标为不支持；供应商缺少账号时暂存最高档位，等待核验。
      </div>
      <div className="sm-actions">
        <button
          className="sm-button sm-primary"
          disabled={busy || !supplierId}
          onClick={() => void action("plan")}
        >
          <RefreshCw size={14} />
          {record ? "补齐核验计划" : "读取并开始核验"}
        </button>
        {record && (
          <>
            <button
              className="sm-button"
              disabled={busy}
              onClick={() => void action(record.paused ? "resume" : "pause")}
            >
              {record.paused ? <Play size={14} /> : <Pause size={14} />}
              {record.paused ? "恢复队列" : "暂停队列"}
            </button>
            <button
              className="sm-button"
              disabled={busy}
              onClick={() => void action("reconcile")}
            >
              核对任务／取回结果
            </button>
            <button
              className="sm-button"
              disabled={busy}
              onClick={() => void action("cancel")}
            >
              取消未提交
            </button>
          </>
        )}
      </div>
      {record?.reason && (
        <p role="status" className="sm-notice">
          {record.reason}
        </p>
      )}
      {error && (
        <p role="alert" className="sm-notice is-error">
          {error}
        </p>
      )}
      {record?.policyVersion === 1 && record.used >= record.limit && (
        <div className="sm-notice">
          本轮额度已用完。
          {newRound ? (
            <>
              <span>新一轮允许再提交最多 6 次付费请求。</span>
              <button
                className="sm-button"
                disabled={busy}
                onClick={() => void action("new-round")}
              >
                开启新一轮
              </button>
              <button className="sm-button" onClick={() => setNewRound(false)}>
                取消
              </button>
            </>
          ) : (
            <button className="sm-button" onClick={() => setNewRound(true)}>
              追加一轮核验
            </button>
          )}
        </div>
      )}
      {!!groups.length && (
        <div className="sm-verification-filter">
          <label>分组 <select aria-label="核验分组" value={group} onChange={event => setGroup(event.target.value)}>
            <option value="">全部分组（{groups.length}）</option>
            {groups.map(name => <option key={name} value={name}>{name}</option>)}
          </select></label>
          <span className="sm-muted">{(record?.coverage ?? []).filter(item => !group || item.group === group).length} 个分组型号 · {cases.filter(item => item.status === "succeeded").length} 项通过 · {cases.filter(item => item.status === "queued").length} 项待测</span>
        </div>
      )}
      <div className="sm-verification-cases">
        {cases.map((test) => (
          <article
            key={test.id}
            className="sm-verification-case"
            data-status={test.status}
          >
            {test.assetId && (
              <a
                href={`/api/assets/${test.assetId}/content`}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src={`/api/assets/${test.assetId}/preview?size=160`}
                  alt={`${test.resolution} 核验结果`}
                  loading="lazy"
                />
              </a>
            )}
            <div>
              <header>
                <strong title={test.modelId}>{test.modelId}</strong>
                <span className="sm-badge">{labels[test.status]}</span>
              </header>
              <p>
                {test.group} · {test.resolution} ·{" "}
                {test.quality ?? "模型决定质量"} · {test.ratio}
              </p>
              {test.actualWidth && (
                <p>
                  {test.approximate ? "近似档位 · " : ""}实际 {test.actualWidth}{" "}
                  × {test.actualHeight}，请求 {test.expectedWidth} ×{" "}
                  {test.expectedHeight}
                </p>
              )}
              <p>{test.reason}</p>
              <p>
                说明价格：
                {test.expectedCharge
                  ? `${test.expectedCharge.amount} ${test.expectedCharge.currency}/${test.expectedCharge.unit === "image" ? "张" : "次"}`
                  : "未知"}{" "}
                · 实际扣费：
                {test.actualCharge
                  ? `${test.actualCharge.amount} ${test.actualCharge.currency}`
                  : "未核对"}
                {test.chargeStatus === "mismatch"
                  ? " · 与说明不符"
                  : test.chargeStatus === "matched"
                    ? " · 与说明相符"
                    : ""}
              </p>
              <details>
                <summary>请求详情</summary>
                <p className="sm-monospace">{test.requestId}</p>
                <p>
                  {new Date(test.createdAt).toLocaleString("zh-CN")}
                  {test.taskId && ` · 任务 ${test.taskId}`}
                </p>
                <pre>{JSON.stringify(test.parameters, null, 2)}</pre>
                <button
                  className="sm-button"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(test.requestId)
                      .catch(() => setError("复制失败，请选中编号复制"))
                  }
                >
                  <Copy size={13} />
                  复制请求编号
                </button>
                {["succeeded", "inconclusive"].includes(test.status) && (
                  <div>
                    {retestId === test.id ? (
                      <>
                        <p>将额外发起一张新的付费生成。</p>
                        <button
                          className="sm-button"
                          disabled={busy}
                          onClick={() => void action("retest", test.id)}
                        >
                          确认重新生成核验
                        </button>
                        <button
                          className="sm-button"
                          onClick={() => setRetestId(null)}
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        className="sm-button"
                        disabled={
                          busy || record?.paused || (record?.policyVersion === 1 && record.used >= record.limit)
                        }
                        onClick={() => setRetestId(test.id)}
                      >
                        重新生成核验
                      </button>
                    )}
                  </div>
                )}
              </details>
            </div>
          </article>
        ))}
      </div>
      {!!evidence.length && (
        <details className="sm-evidence">
          <summary>参数依据与来源 · {evidence.length} 条</summary>
          {evidence.map((item) => (
            <div key={item.id}>
              <strong>
                {item.modelId} · {item.resolution ?? item.quality}
              </strong>
              <span className="sm-badge">{EVIDENCE_LABELS[item.status]}</span>
              <p>
                {item.group} · {item.excerpt}
              </p>
              <small>{new Date(item.checkedAt).toLocaleString("zh-CN")}</small>
              {item.sourceUrl && (
                <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                  查看来源 <ExternalLink size={12} />
                </a>
              )}
            </div>
          ))}
        </details>
      )}
      {!!skipped.length && (
        <details className="sm-evidence">
          <summary>未测试项目 · {skipped.length}</summary>
          {skipped.map((item, index) => (
            <p key={`${item.connectionId}:${item.modelId}:${index}`}>
              {item.group ? `${item.group} · ` : ""}{item.modelId || "连接"}：{item.reason}
            </p>
          ))}
        </details>
      )}
      {!record && (
        <p className="sm-muted">
          保存有效连接并读取模型后，会自动建立核验计划。没有可执行协议的型号会显示原因。
        </p>
      )}
    </section>
  );
}
