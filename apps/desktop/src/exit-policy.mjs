/** Describe existing lifecycle counts without changing the exit protection. */
export function exitWaitPresentation(activity, install = false) {
  // The lifecycle API includes supplier verifications in activeRuns.
  const verifications = activity.activeVerifications ?? 0;
  const generations = Math.max(0, (activity.activeRuns ?? 0) - verifications);
  const writes = activity.activeWrites ?? 0;
  const pending = [
    generations > 0 && { label: "生成任务", count: generations, unit: "个", title: "仍有生成任务正在运行", completion: "生成完成" },
    verifications > 0 && { label: "供应商核验", count: verifications, unit: "项", title: "仍有供应商核验正在进行", completion: "供应商核验完成" },
    writes > 0 && { label: "保存与后台写入", count: writes, unit: "项", title: "正在完成保存与后台写入", completion: "保存与后台写入完成" },
  ].filter(Boolean);
  const single = pending.length === 1 ? pending[0] : undefined;
  return {
    title: single?.title ?? "仍有操作尚未完成",
    message: `${single?.completion ?? "这些操作完成"}后${install ? "重启并更新" : "退出超级画布"}？`,
    detail: `${pending.map(item => `${item.label}：${item.count} ${item.unit}。`).join("\n")}\n等待期间暂停新的编辑和提交。你可以随时返回软件。`,
  };
}

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Closing requires a complete, drained lifecycle snapshot, never truthiness. */
export function exitActivityIsIdle(activity) {
  const runs = count(activity?.activeRuns), writes = count(activity?.activeWrites);
  const verifications = count(activity?.activeVerifications);
  if (activity?.draining !== true || runs === null || writes === null || verifications === null || verifications > runs) {
    throw new Error("无法确认任务与保存状态，未退出；请返回软件后重试");
  }
  return runs === 0 && writes === 0;
}

/** Unknown activity stays unknown until the authenticated lifecycle read ends. */
export function makeExitProgress(phase, install = false, activity) {
  return { phase, install, activeRuns: count(activity?.activeRuns),
    activeVerifications: count(activity?.activeVerifications), activeWrites: count(activity?.activeWrites) };
}

/** Shared with the renderer: lifecycle activeRuns already includes verification. */
export function exitProgressPresentation(progress) {
  const install = progress?.install === true;
  const completion = install ? "完成后将安装已下载的更新并重新打开软件。" : "完成后将退出超级画布。";
  const label = install ? "正在准备安装更新" : "正在准备退出";
  const base = { label, title: label, message: `正在保存并确认退出条件。${completion}`, details: [], canCancel: true };
  if (!progress) return base;
  if (progress.phase === "saving") return { ...base, title: install ? "正在保存，准备安装更新" : "正在保存",
    message: `正在保存已打开的画布与设置。${completion}` };
  if (progress.phase === "closing") return { ...base, title: install ? "正在关闭软件并启动更新安装" : "正在退出超级画布",
    message: install ? "正在结束本地服务，随后安装已下载的更新并重新打开软件。" : "正在结束本地服务并关闭软件。", canCancel: false };
  const checking = { ...base, title: install ? "正在检查更新安装条件" : "正在检查退出条件",
    message: "正在核对生成、供应商核验和后台写入状态。" };
  if (progress.phase !== "waiting") return checking;
  const total = count(progress.activeRuns), verifications = count(progress.activeVerifications), writes = count(progress.activeWrites);
  const generations = total === null || verifications === null ? null : Math.max(0, total - verifications);
  const pending = [
    generations > 0 && { title: "正在等待生成任务完成", detail: `生成任务：${generations} 个` },
    verifications > 0 && { title: "正在等待供应商核验完成", detail: `供应商核验：${verifications} 项` },
    verifications === null && total > 0 && { title: "正在等待当前任务完成", detail: `当前任务：${total} 个` },
    writes > 0 && { title: "正在完成保存与后台写入", detail: `保存与后台写入：${writes} 项` },
  ].filter(Boolean);
  if (!pending.length) return checking;
  return { ...base, title: pending.length === 1 ? pending[0].title : "正在等待当前操作完成",
    message: completion, details: pending.map(item => item.detail) };
}

/** Only stage/count transitions enter diagnostics; task content never does. */
export function createExitProgressReporter({ send, log }) {
  let current, signature, attempt;
  const event = name => log(`exit ${JSON.stringify({ event: name, attempt, ...current })}`);
  return {
    progress(phase, install, activity, nextAttempt) {
      const next = makeExitProgress(phase, install, activity);
      const nextSignature = JSON.stringify([nextAttempt, next]);
      if (nextSignature === signature) return;
      current = next; attempt = nextAttempt; signature = nextSignature;
      event("progress"); send(current);
    },
    event,
    error(message) { event("failed"); if (current) send({ ...current, error: message }); },
  };
}
