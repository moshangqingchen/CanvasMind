import {
  compileDocumentedInterface, savedModelInterfaces,
  type ModelDescriptor, type DocumentedModelInterface,
} from "@super-canvas/providers";

import { readSupplierInterfaceDocuments, type InterfaceDocumentReadOptions } from "./supplier-interface-documents";
export { readSupplierInterfaceDocuments, type InterfaceDocument } from "./supplier-interface-documents";
type Connection = { provider: string; config: Record<string, unknown> };

function mayBind(model: ModelDescriptor) {
  return model.metadata?.canvasRunnable !== false || (model.metadata?.autoInterfaceStatus === "incomplete" || /协议|接口|尚未内置/u.test(String(model.metadata.canvasUnavailableReason ?? "")))
    && !/403|权限|未开通|拒绝|下架|停用|未返回/u.test(String(model.metadata.canvasUnavailableReason ?? ""));
}

export function applySavedModelInterfaces(connection: Connection, models: readonly ModelDescriptor[]): ModelDescriptor[] {
  const bindings = savedModelInterfaces(connection.config);
  return models.map(model => {
    const binding = bindings[model.id];
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
  if (["agent", "disabled"].includes(String(connection.config.usage)) || connection.config.supplierArchived === true
    || !["openai", "weai", "rest", "runway"].includes(connection.provider)) return { models: [...models], bindings };
  const candidates = models.filter(model => mayBind(model) && model.operations.length);
  if (!candidates.length) return { models: [...models], bindings };
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
  const annotated = models.map(model => reasons.has(model.id) ? { ...model, metadata: { ...model.metadata,
    canvasRunnable: false, autoInterfaceStatus: "incomplete", autoInterfaceLabel: "接口说明待补充", canvasUnavailableReason: reasons.get(model.id) } }
    : connected.has(model.id) ? { ...model, metadata: { ...model.metadata, autoInterfaceStatus: "connected" } } : model);
  return { models: applySavedModelInterfaces({ ...connection, config: { ...connection.config, autoModelInterfaces: bindings } }, annotated), bindings };
}
