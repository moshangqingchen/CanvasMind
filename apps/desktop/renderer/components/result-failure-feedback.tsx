"use client";

import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import type { LocalizedRunError } from "../lib/error-localization";
import { resultFailureFeedback } from "../lib/result-failure-feedback";
import { runErrorDiagnostic, runErrorTechnicalTitle } from "../lib/run-error-diagnostics";
import { FailureDiagnosis } from "./failure-diagnosis";
import styles from "./result-feedback.module.css";

export function ResultFailureFeedback({ error, rawError, taskId, runId, status, providerTaskStatus, recoveryAction, context }: {
  error?: LocalizedRunError | null;
  rawError?: unknown;
  taskId?: string;
  runId?: string;
  status?: string;
  providerTaskStatus?: string;
  recoveryAction?: string;
  context?: Record<string, unknown>;
}) {
  const feedback = resultFailureFeedback(error, rawError);
  const diagnostic = runErrorDiagnostic(error);
  const original = rawError && typeof rawError === "object" ? rawError as Record<string, unknown> : undefined;
  const recordedType = typeof original?.type === "string" && original.type.trim() ? original.type : error?.type;
  const technicalType = feedback.kind === "quota" && /余额不足/u.test(recordedType ?? "") ? "额度不足" : recordedType;
  const [copied, setCopied] = useState("");
  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(() => setCopied(`已复制${label}`)).catch(() => setCopied("复制失败，请选中文字手动复制"));
  };
  return <div className={styles.feedback} onClick={event => event.stopPropagation()}>
    <p className={`result-error-summary ${styles.summary}`} title={`${feedback.cause}${feedback.action}`}>{feedback.cause}{feedback.action}</p>
    <details className={`${styles.details} nodrag nopan nowheel`}>
      <summary title={runErrorTechnicalTitle(error)}>查看完整错误详情</summary>
      <div className={styles.technical}>
        <p>{feedback.cause}{feedback.action}</p>
        <dl>
          <dt>错误代码</dt><dd><code>{error?.code ?? "未提供"}</code></dd>
          {technicalType ? <><dt>错误类型</dt><dd><code>{technicalType}</code></dd></> : null}
          <dt>供应商任务编号</dt><dd className={styles.taskId}><code>{taskId ?? "未取得"}</code>{taskId ? <button type="button" className={styles.copyIcon} aria-label="复制供应商任务编号" title="复制供应商任务编号" onClick={() => copy(taskId, "任务编号")}><Copy size={12} aria-hidden="true" /></button> : null}</dd>
          {runId ? <><dt>本地运行编号</dt><dd className={styles.taskId}><code>{runId}</code><button type="button" className={styles.copyIcon} aria-label="复制本地运行编号" title="复制本地运行编号" onClick={() => copy(runId, "运行编号")}><Copy size={12} aria-hidden="true" /></button></dd></> : null}
          {error?.api ? <><dt>接口协议</dt><dd>{error.api}</dd></> : null}
          {error?.statusCode ? <><dt>HTTP 状态</dt><dd><code>{error.statusCode}</code></dd></> : null}
        </dl>
        <div><strong>{error?.source === "local_validation" ? "本地校验原文" : "供应商原始错误"}</strong><pre>{feedback.raw}</pre></div>
        {diagnostic ? <p>{diagnostic}</p> : null}
        <FailureDiagnosis error={error} status={status} providerTaskStatus={providerTaskStatus} recoveryAction={recoveryAction} />
        <button type="button" className={styles.copyIcon} aria-label="复制错误详情" title="复制错误详情" onClick={() => copy(JSON.stringify({ error: rawError ?? error, ...context, runId, taskId }, null, 2), "错误详情")}><Copy size={12} aria-hidden="true" /></button>
        {error?.actionUrl ? <a className="generated-result-error-doc nodrag nopan" href={error.actionUrl} target="_blank" rel="noreferrer"><ExternalLink size={11} aria-hidden="true" />{error.actionLabel ?? "前往供应商官网"}</a> : null}
        {error?.docsUrl ? <a className="generated-result-error-doc nodrag nopan" href={error.docsUrl} target="_blank" rel="noreferrer"><ExternalLink size={11} aria-hidden="true" />API 错误文档</a> : null}
        {copied ? <span className={styles.copyStatus} role="status">{copied}</span> : null}
      </div>
    </details>
  </div>;
}
