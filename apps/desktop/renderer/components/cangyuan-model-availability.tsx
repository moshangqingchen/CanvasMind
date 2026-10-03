"use client";

import { cangyuanAvailabilityBuckets, cangyuanAvailabilityTitle, cangyuanPaceLabel,
  CANGYUAN_AVAILABILITY_LABELS, modelAvailabilityBadgeState,
  type ModelAvailabilityLoadState, type ResolvedCangyuanAvailability } from "../lib/cangyuan-availability-ui";
import styles from "./cangyuan-model-availability.module.css";

function timeLabel(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function CangyuanAvailabilityBadge({ availability, loadState, checkedAt }: {
  availability: ResolvedCangyuanAvailability | undefined;
  loadState: ModelAvailabilityLoadState;
  checkedAt?: string;
}) {
  const state = modelAvailabilityBadgeState(availability, loadState, checkedAt);
  return <span className={styles.badge} data-tone={state.tone}
    title={cangyuanAvailabilityTitle(availability, loadState, checkedAt)}>{state.label}</span>;
}

export function CangyuanModelAvailability({ availability, loadState, checkedAt }: {
  availability: ResolvedCangyuanAvailability | undefined;
  loadState: ModelAvailabilityLoadState;
  checkedAt?: string;
}) {
  const state = modelAvailabilityBadgeState(availability, loadState, checkedAt);
  const buckets = cangyuanAvailabilityBuckets(availability?.timeline ?? null);
  const historical = ["error", "stale", "preparing"].includes(state.tone);
  const date = checkedAt ? new Date(checkedAt) : undefined;
  return <section className={styles.panel} aria-label="当前模型渠道可用性">
    <header className={styles.header}><strong>渠道可用性</strong>
      <CangyuanAvailabilityBadge availability={availability} loadState={loadState} checkedAt={checkedAt} /></header>
    {availability ? <>
      <p className={styles.identity}>{availability.productName} · {availability.name}</p>
      {historical && <p className={styles.notice} role="status">{state.tone === "preparing" ? "监测数据准备中" :
        state.tone === "error" ? "监测数据更新失败" : "监测记录已过期"}；以下为上次记录，当前状态待确认。</p>}
      <p className={styles.pace}>{historical ? "上次记录：" : ""}{cangyuanPaceLabel(availability)}
        {availability.cause && <span> · {availability.cause === "slow" ? "响应变慢" : "服务异常"}</span>}</p>
      {buckets.length > 0 ? <div className={styles.history} data-history-stale={historical || undefined}>
        <div className={styles.historyHeading}><span>最近最多 8 小时</span><span>每 10 分钟一块</span></div>
        <div className={styles.timeline} aria-label={`${availability.name} 渠道状态时间线`} role="group">
          {buckets.map(bucket => <span key={bucket.startedAt} className={styles.bucket} data-status={bucket.status}
            role="img" aria-label={`${timeLabel(bucket.startedAt)}–${timeLabel(bucket.endedAt)} ${CANGYUAN_AVAILABILITY_LABELS[bucket.status]}`}
            title={`${timeLabel(bucket.startedAt)}–${timeLabel(bucket.endedAt)} · ${CANGYUAN_AVAILABILITY_LABELS[bucket.status]}`} />)}
        </div>
        <div className={styles.historyHeading}><span>{timeLabel(buckets[0].startedAt)}</span><span>{timeLabel(buckets[buckets.length - 1].endedAt)}</span></div>
      </div> : <p className={styles.note}>暂无历史状态记录</p>}
    </> : <p className={styles.note} role="status">{loadState === "loading" ? "正在读取渠道监测状态…" :
      loadState === "preparing" ? "渠道监测数据准备中，暂未取得当前模型记录。" :
      loadState === "disabled" ? "渠道监测已停用，当前状态未提供。" :
      loadState === "error" ? "渠道监测查询失败，当前状态待确认。" : "监测接口暂未收录当前模型或分组。"}</p>}
    <div className={styles.legend}><span data-status="available">正常</span><span data-status="degraded">变慢 / 波动</span><span data-status="unavailable">暂不可用</span></div>
    <p className={styles.note}>正常表示服务当前开放，不是调用成功率承诺；可使用的模型仍以当前 Key 的扫描结果为准。</p>
    {date && !Number.isNaN(date.getTime()) && <p className={styles.checkedAt}>{historical ? "上次读取" : "读取于"} {date.toLocaleTimeString("zh-CN", { hour12: false })} · 监测约 5 分钟更新一次</p>}
  </section>;
}
