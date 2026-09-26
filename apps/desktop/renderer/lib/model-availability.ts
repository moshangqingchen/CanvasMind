import type { ModelDescriptor } from "@super-canvas/providers";

export interface InventoryModel { id: string; name: string }

/** Reject a removed selection using only this connection's saved Key inventory. */
export function savedModelAvailabilityError(
  config: Readonly<Record<string, unknown>>,
  requestedModel?: string,
): string | null {
  const status = config.modelScanStatus;
  if (status === "unauthorized") return "当前分组 Key 鉴权失败，请更新密钥并刷新模型后再运行";
  if (status === "empty") return "当前分组 Key 的最新模型列表为空，请刷新或重新选择可用模型";
  if (status !== "live" && status !== "failed") return null;
  if (!Array.isArray(config.modelCatalogModels)) return null;
  const model = requestedModel?.trim() ||
    (typeof config.defaultModel === "string" ? config.defaultModel.trim() : "");
  if (!model) return "请先选择当前分组 Key 模型列表中的可用模型";
  const selected = (config.modelCatalogModels as ModelDescriptor[]).find(item => item?.id === model);
  if (!selected) return `模型 ${model} 已不在当前分组 Key 的最新模型列表中，请重新选择；不会自动切换模型或分组`;
  if (selected.metadata?.canvasRunnable === false || !selected.operations?.length)
    return `模型 ${model} 当前不可用于画布：${String(selected.metadata?.canvasUnavailableReason || "调用协议尚未适配")}`;
  return null;
}

export function inventoryModels(value: unknown): InventoryModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || typeof item.id !== "string") return [];
    return [{ id: item.id, name: typeof item.name === "string" ? item.name : item.id }];
  });
}

/** Compare only successful Key inventories, never a public catalog or a failed scan. */
export function inventoryChanges(previous: Record<string, unknown>, models: readonly ModelDescriptor[]) {
  const old = inventoryModels(previous.modelCatalogModels);
  const fallback = Array.isArray(previous.scannedModelIds)
    ? previous.scannedModelIds.filter((id): id is string => typeof id === "string").map(id => ({ id, name: id })) : [];
  const known = new Map([...fallback, ...old].map(m => [m.id, m]));
  const current = new Set(models.map(m => m.id));
  const removed = new Map(inventoryModels(previous.modelRemovedModels).map(m => [m.id, m]));
  for (const model of known.values()) if (!current.has(model.id)) removed.set(model.id, model);
  for (const id of current) removed.delete(id);
  return {
    modelAddedIds: models.filter(m => !known.has(m.id)).map(m => m.id),
    modelRemovedModels: [...removed.values()],
  };
}

export function modelAvailability(model: ModelDescriptor, status: string): { label: string; tone: string; detail: string } {
  if (status === "unauthorized") return { label: "鉴权失败", tone: "error", detail: "当前 Key 没有访问权限，请更新 Key 后刷新" };
  if (status !== "live") return { label: "待确认", tone: "unknown", detail: "本次未确认可用性，展示上次读取结果" };
  if (model.metadata?.canvasRunnable === false || !model.operations.length)
    return { label: "协议待适配", tone: "unknown", detail: String(model.metadata?.canvasUnavailableReason || "Key 已返回此模型，但应用尚未支持其调用协议") };
  if (typeof model.metadata?.imageCapabilitiesVerifiedAt === "string")
    return { label: "已实测", tone: "ok", detail: `${model.metadata.imageCapabilitiesVerifiedAt} 已完成付费出图验证。${String(model.metadata.imageCapabilityNote ?? "支持范围以当前模型的参数选项为准。")}` };
  return { label: "可用", tone: "ok", detail: "Key 的模型列表已返回，调用协议已支持；未进行付费生成测试" };
}
