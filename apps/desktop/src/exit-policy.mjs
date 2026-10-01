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
