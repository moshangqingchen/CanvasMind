"use client";

import { taskConnectionLabel } from "../lib/task-evidence";
import type { RunSnapshot, RunTaskEvidence } from "./types";
import styles from "./task-evidence.module.css";

export function TaskEvidence({ request, evidence }: {
  request?: RunSnapshot["nodes"][number]["request"];
  evidence?: RunTaskEvidence;
}) {
  return <div className={styles.facts} aria-label="供应商任务信息">
    <span>渠道：{taskConnectionLabel(request)}</span>
    {evidence ? <span>供应商任务号：<code>{evidence.taskId}</code></span> : <span>供应商任务号：未取得</span>}
  </div>;
}
