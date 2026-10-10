import {
  cangyuanVideoModel, cangyuanVideoTransport, isCangyuanNativeSeedanceRequest,
  chuangxiangVideoModel, chuangxiangVideoTransport, isChuangxiangVideoConnection,
  jiasuVideoGroupMismatch, modelGenerationMediaKinds, modelSupportsGenerationMedia, remainingVideoModel, remainingVideoSupplier, remainingVideoTransport,
  savedModelInterfaces, type ModelDescriptor, type ProviderOperation,
} from "@super-canvas/providers";

type Connection = { provider: string; config: Readonly<Record<string, unknown>> };
const unavailable = /401|403|权限|未开通|拒绝|下架|停用|未返回|unauthorized|forbidden|not.?returned|unavailable|disabled/iu;
const pendingReason = "该型号的视频参数与调用协议待供应商文档确认";

function pending(model: ModelDescriptor, reason = pendingReason): ModelDescriptor {
  return { ...model, parameters: [], metadata: { ...model.metadata,
    canvasRunnable: false, parameterControlsUnavailable: true, canvasUnavailableReason: reason } };
}

/** Mirror AutoInterfaceAdapter's native-video gate without inferring endpoints. */
function executableOperations(connection: Connection, model: ModelDescriptor): readonly ProviderOperation[] | undefined {
  const config = connection.config, baseUrl = String(config.baseUrl ?? "");
  if (connection.provider === "openai" && isCangyuanNativeSeedanceRequest(model.id, baseUrl)) {
    const transport = cangyuanVideoTransport(model.id);
    if (transport?.submit && transport.output?.kind === "video") return cangyuanVideoModel(model).operations;
  }
  if (connection.provider === "openai" && isChuangxiangVideoConnection(config, model.id)) {
    const transport = chuangxiangVideoTransport();
    if (transport.submit && transport.output?.kind === "video") return chuangxiangVideoModel(model.id, model).operations;
  }
  const supplier = remainingVideoSupplier(baseUrl);
  const group = config.accountKeyGroup ?? config.modelGroup ?? config.group ?? config.supplierGroupId;
  const description = config.supplierGroupDescription ?? config.groupDescription;
  const context = { group: typeof group === "string" ? group : "",
    groupDescription: typeof description === "string" ? description : "", model };
  const descriptor = supplier ? remainingVideoModel(supplier, model.id, model, context) : undefined;
  const transport = supplier && descriptor ? remainingVideoTransport(supplier, model.id, context) : undefined;
  if (descriptor && transport?.submit && transport.output?.kind === "video") return descriptor.operations;
  const binding = savedModelInterfaces(config)[model.id];
  if (model.metadata?.autoInterfaceStatus !== "incomplete" && binding?.model?.id === model.id && binding.connector?.submit && binding.connector.output?.kind === "video")
    return binding.model.operations;
  return undefined;
}

/** Seal pure native-video directories after enrichment; mixed outputs retain their existing policy. */
export function guardNativeVideoRunnableContract(connection: Connection, model: ModelDescriptor): ModelDescriptor {
  if (!["openai", "weai"].includes(connection.provider) || !model.operations.some(operation => operation.startsWith("video."))) return model;
  // Existing failures retain their evidence; this guard never grants access.
  if (model.metadata?.canvasRunnable === false) return model;
  // canvasRunnable applies to the entire descriptor. Mixed outputs need a
  // separate operation policy; a missing video route cannot disable its images.
  if (modelGenerationMediaKinds(model).some(kind => kind !== "video")) return model;
  const config = connection.config, ids = config.scannedModelIds;
  if (remainingVideoSupplier(config.baseUrl) === "jiasu" &&
    (jiasuVideoGroupMismatch(config) || ["agent", "disabled"].includes(String(config.usage))))
    return pending(model, "当前 Key 分组或连接用途不允许此视频型号在画布运行");
  if (config.supplierArchived === true || ["empty", "unauthorized"].includes(String(config.modelScanStatus)) ||
    Array.isArray(ids) && !ids.includes(model.id) || unavailable.test(String(model.metadata?.canvasUnavailableReason ?? "")))
    return pending(model, String(model.metadata?.canvasUnavailableReason || "当前 Key 或分组没有此视频型号的可用权限"));
  if (!modelSupportsGenerationMedia(model, "video")) return pending(model, "当前型号未声明视频输出，不能用于视频节点");
  const contracted = executableOperations(connection, model);
  const supported = model.operations.filter(operation => operation.startsWith("video.") && contracted?.includes(operation));
  if (!supported.length) return pending(model);
  // A saved text-to-video route does not also grant image-to-video permission.
  const operations = model.operations.filter(operation => !operation.startsWith("video.") || supported.includes(operation));
  if (model.metadata?.parameterControlsUnavailable === true) {
    const metadata = { ...model.metadata };
    delete metadata.parameterControlsUnavailable;
    return { ...model, operations, metadata };
  }
  return operations.length === model.operations.length ? model : { ...model, operations };
}
