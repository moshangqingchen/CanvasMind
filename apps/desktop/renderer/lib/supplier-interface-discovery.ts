import {
  compileDocumentedInterface, savedModelInterfaces,
  type ModelDescriptor, type DocumentedModelInterface,
  cangyuanMusicModel, isCangyuanMusicRequest,
  cangyuanVideoModel, isCangyuanNativeSeedanceRequest, modelGenerationMediaKinds,
  chuangxiangVideoModel, isChuangxiangVideoConnection,
  remainingVideoModel, remainingVideoSupplier,
  jiasuVideoGroupMismatch,
  preservesMiaowuExplicitVideoContract,
} from "@super-canvas/providers";
import { bananaImageRoute, applyBananaImageCapabilities } from "@super-canvas/providers/banana-image-contract";
import { applyChuangxiangMidjourneyCapabilities, isChuangxiangMidjourneyConnection } from "@super-canvas/providers/chuangxiang-midjourney-contract";
import { cyberAfeiDocumentedModel } from "./cyberafei-catalog";
import { supplierKeyForConnection } from "./supplier-identity";
import { matchesSupplierTemplate } from "./supplier-template-source";

import { readSupplierInterfaceDocuments, type InterfaceDocumentReadOptions } from "./supplier-interface-documents";
export { readSupplierInterfaceDocuments, type InterfaceDocument } from "./supplier-interface-documents";
type Connection = { provider: string; config: Record<string, unknown> };

/** A saved exact video interface and a user's custom route precede catalog defaults. */
export function hasMiaowuExplicitVideoInterface(connection: Connection, model: ModelDescriptor): boolean {
  if (remainingVideoSupplier(connection.config.baseUrl) !== "miaowu") return false;
  if (preservesMiaowuExplicitVideoContract(connection.config, model)) return true;
  const binding = savedModelInterfaces(connection.config)[model.id];
  return Boolean(binding?.model?.id === model.id && binding.model.operations?.some(operation => operation.startsWith("video.")) &&
    binding.connector?.submit?.path && binding.connector.output?.kind === "video");
}

function mayBind(model: ModelDescriptor) {
  const reason = String(model.metadata?.canvasUnavailableReason ?? "");
  if (/401|403|权限|未开通|拒绝|下架|停用|未返回|unauthorized|forbidden|not.?returned|unavailable|disabled/iu.test(reason)) return false;
  return model.metadata?.canvasRunnable !== false || model.metadata?.autoInterfaceStatus === "incomplete" || /协议|接口|尚未内置|protocol|adapter/iu.test(reason);
}

function nativeContract(connection: Connection, model: ModelDescriptor): ModelDescriptor | undefined {
  if (hasMiaowuExplicitVideoInterface(connection, model)) return undefined;
  if (!mayBind(model)) return undefined;
  if (connection.provider === "rest" && isCangyuanMusicRequest(model.id, String(connection.config.baseUrl ?? ""))) return cangyuanMusicModel(model);
  const nativeCangyuan = connection.provider === "openai" && isCangyuanNativeSeedanceRequest(model.id, String(connection.config.baseUrl ?? ""));
  const nativeChuangxiang = ["rest", "openai"].includes(connection.provider) && isChuangxiangVideoConnection(connection.config, model.id);
  const declaredOutput = model.metadata?.outputKindsSource === "declared" || model.metadata?.operationsSource === "declared" ||
    model.metadata?.outputKindsSource !== "inferred" && model.metadata?.operationsSource !== "inferred" &&
      ["chat", "text", "audio", "other"].includes(String(model.metadata?.catalogCapability ?? ""));
  if ((nativeCangyuan || nativeChuangxiang) && (!declaredOutput || modelGenerationMediaKinds(model).join("+") === "video") &&
      connection.config.supplierArchived !== true && !["empty", "unauthorized"].includes(String(connection.config.modelScanStatus)) &&
      (!Array.isArray(connection.config.scannedModelIds) || connection.config.scannedModelIds.includes(model.id))) {
    const metadata: Record<string, unknown> = { ...model.metadata, canvasRunnable: true };
    delete metadata.canvasUnavailableReason;
    if (metadata.autoInterfaceStatus === "incomplete") delete metadata.autoInterfaceStatus;
    delete metadata.parameterControlsUnavailable;
    return nativeCangyuan ? cangyuanVideoModel({ ...model, metadata }) : chuangxiangVideoModel(model.id, { ...model, metadata });
  }
  if (isChuangxiangMidjourneyConnection(connection.config, model.id)) return applyChuangxiangMidjourneyCapabilities(connection, model);
  if (connection.provider === "rest" && supplierKeyForConnection(connection) === "cyberafei" && matchesSupplierTemplate(connection) &&
      connection.config.supplierArchived !== true && !["agent", "disabled"].includes(String(connection.config.usage)) &&
      !["empty", "unauthorized"].includes(String(connection.config.modelScanStatus)) &&
      (!Array.isArray(connection.config.scannedModelIds) || connection.config.scannedModelIds.includes(model.id))) {
    const endpoints = model.metadata?.endpointTypes;
    const descriptor = cyberAfeiDocumentedModel(model.id, Array.isArray(endpoints) && endpoints.length ? {
      endpointTypes: endpoints.filter((value): value is string => typeof value === "string"),
    } : undefined);
    if (descriptor && (!declaredOutput || modelGenerationMediaKinds(model).join("+") === modelGenerationMediaKinds(descriptor).join("+"))) {
      const metadata: Record<string, unknown> = { ...model.metadata, ...descriptor.metadata, canvasRunnable: true };
      delete metadata.canvasUnavailableReason;
      if (metadata.autoInterfaceStatus === "incomplete") delete metadata.autoInterfaceStatus;
      return { ...model, operations: descriptor.operations, inputKinds: descriptor.inputKinds,
        outputKinds: descriptor.outputKinds, parameters: descriptor.parameters, limits: descriptor.limits, metadata };
    }
  }
  const remainingSupplier = remainingVideoSupplier(connection.config.baseUrl);
  if (remainingSupplier && !(remainingSupplier === "jiasu" && jiasuVideoGroupMismatch(connection.config)) && !["agent", "disabled"].includes(String(connection.config.usage)) && (!declaredOutput || modelGenerationMediaKinds(model).join("+") === "video") &&
      connection.config.supplierArchived !== true && !["empty", "unauthorized"].includes(String(connection.config.modelScanStatus)) &&
      (!Array.isArray(connection.config.scannedModelIds) || connection.config.scannedModelIds.includes(model.id))) {
    const descriptor = remainingVideoModel(remainingSupplier, model.id, model, {
      group: String(connection.config.accountKeyGroup ?? connection.config.modelGroup ?? ""),
      groupDescription: String(connection.config.supplierGroupDescription ?? connection.config.groupDescription ?? ""),
    });
    if (descriptor) {
      const metadata: Record<string, unknown> = { ...descriptor.metadata, canvasRunnable: true };
      delete metadata.canvasUnavailableReason;
      if (metadata.autoInterfaceStatus === "incomplete") delete metadata.autoInterfaceStatus;
      delete metadata.parameterControlsUnavailable;
      return { ...descriptor, metadata };
    }
  }
  if (bananaImageRoute(connection, model.id)) {
    const metadata: Record<string, unknown> = { ...model.metadata, canvasRunnable: true };
    delete (metadata as Record<string, unknown>).canvasUnavailableReason;
    if (metadata.autoInterfaceStatus === "incomplete") delete metadata.autoInterfaceStatus;
    return applyBananaImageCapabilities(connection, { ...model, metadata });
  }
  return undefined;
}

export function applySavedModelInterfaces(connection: Connection, models: readonly ModelDescriptor[]): ModelDescriptor[] {
  const bindings = savedModelInterfaces(connection.config);
  return models.map(model => {
    const native = nativeContract(connection, model);
    if (native) return native;
    const binding = bindings[model.id];
    if (binding && hasMiaowuExplicitVideoInterface(connection, model) && model.metadata?.autoInterfaceStatus === "incomplete")
      return { ...model, metadata: { ...model.metadata, canvasRunnable: false } };
    if (!binding || !mayBind(model) || model.metadata?.autoInterfaceStatus === "incomplete") return model;
    const metadata = { ...model.metadata, canvasRunnable: true, autoInterfaceStatus: "connected", protocol: "documented-rest",
      documentationUrl: model.metadata?.documentationUrl ?? binding.sourceUrl, autoInterfacePath: binding.connector.submit.path,
      autoInterfaceLabel: binding.connector.poll ? "已自动接入异步接口" : "已自动接入接口" };
    delete (metadata as Record<string, unknown>).canvasUnavailableReason;
    const keepsOtherOperations = model.operations.some(operation => !binding.model.operations.includes(operation));
    return { ...model, operations: [...new Set([...binding.model.operations, ...model.operations])],
      inputKinds: keepsOtherOperations ? model.inputKinds : binding.model.inputKinds,
      outputKinds: binding.model.outputKinds, parameters: binding.model.parameters,
      limits: keepsOtherOperations ? model.limits : binding.model.limits, metadata };
  });
}

/** All live models consult supplier documentation before keeping a compatibility route. */
export async function discoverSupplierModelInterfaces(connection: Connection, models: readonly ModelDescriptor[], previous: Connection,
  read = readSupplierInterfaceDocuments, options: InterfaceDocumentReadOptions = {}): Promise<{ models: ModelDescriptor[]; bindings: Record<string, DocumentedModelInterface> }> {
  const visible = new Set(models.filter(mayBind).map(model => model.id));
  const sameSource = connection.config.baseUrl === previous.config.baseUrl && connection.config.supplierSourceId === previous.config.supplierSourceId;
  const bindings = Object.assign(Object.create(null) as Record<string, DocumentedModelInterface>,
    Object.fromEntries(Object.entries(sameSource ? savedModelInterfaces(connection.config) : {}).filter(([id]) => visible.has(id))));
  const native = new Map(models.flatMap(model => { const descriptor = nativeContract(connection, model); return descriptor ? [[model.id, descriptor] as const] : []; }));
  for (const id of native.keys()) delete bindings[id];
  if (["agent", "disabled"].includes(String(connection.config.usage)) || connection.config.supplierArchived === true
    || !["openai", "weai", "rest", "runway"].includes(connection.provider)) return { models: [...models], bindings };
  const candidates = models.filter(model => !native.has(model.id) && !hasMiaowuExplicitVideoInterface(connection, model) && mayBind(model) && model.operations.length);
  if (!candidates.length) return { models: models.map(model => native.get(model.id) ?? model), bindings };
  const baseUrl = String(connection.config.baseUrl ?? "");
  const docs = await read(baseUrl, candidates, String(connection.config.supplierWebsiteUrl ?? baseUrl), options);
  const reasons = new Map<string, string>();
  const connected = new Set<string>();
  for (const model of candidates) {
    const results = docs.flatMap(document => {
      const result = compileDocumentedInterface(document.body, model, baseUrl, document.url);
      return result ? [{ result, priority: document.priority ?? 0 }] : [];
    });
    const priority = Math.min(...results.map(item => item.priority));
    const preferred = results.filter(item => item.priority === priority).map(item => item.result);
    const compiled = preferred.flatMap(result => result.binding ? [result.binding] : []);
    const unique = new Map(compiled.map(binding => [JSON.stringify({ connector: { ...binding.connector, models: undefined }, parameters: binding.model.parameters }), binding]));
    if (unique.size === 1 && !preferred.some(result => result.reason)) {
      bindings[model.id] = [...unique.values()][0]!;
      connected.add(model.id);
    } else if (preferred.length) {
      delete bindings[model.id];
      reasons.set(model.id, unique.size > 1 ? "供应商文档提供了不同的调用配置，尚无法唯一匹配" : preferred.find(result => result.reason)?.reason ?? "接口说明不完整");
    } else if (!bindings[model.id] && Array.isArray(model.metadata?.endpointTypes) && model.metadata.endpointTypes.some(value => typeof value === "string"
      && value.startsWith("/") && !["/images/generations", "/v1/images/generations", "/images/edits", "/v1/images/edits"].includes(value)))
      reasons.set(model.id, "供应商声明了专用接口，尚未取得完整的请求、鉴权和结果定义");
  }
  const annotated = models.map(model => native.get(model.id) ?? (reasons.has(model.id) ? { ...model, metadata: { ...model.metadata,
    canvasRunnable: false, autoInterfaceStatus: "incomplete", autoInterfaceLabel: "接口说明待补充", canvasUnavailableReason: reasons.get(model.id) } }
    : connected.has(model.id) ? { ...model, metadata: { ...model.metadata, autoInterfaceStatus: "connected" } } : model));
  return { models: applySavedModelInterfaces({ ...connection, config: { ...connection.config, autoModelInterfaces: bindings } }, annotated), bindings };
}
