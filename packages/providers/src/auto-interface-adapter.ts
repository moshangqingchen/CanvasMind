import type { ModelDescriptor, NormalizedRequest, ProviderAdapter, ProviderConnectionResolver, ProviderTask } from "./contracts.js";
import type { DocumentedModelInterface } from "./documented-interface.js";
import { GenericRestAdapter, type GenericRestAdapterOptions } from "./rest.js";
import { BananaImageAdapter, bananaImageRoute, applyBananaImageCapabilities, bananaNativeOutputs } from "./banana-image.js";
import { isPdogImageConnection, PdogImageAdapter } from "./pdog-image.js";
import { isChuangxiangImageConnection, ChuangxiangImageAdapter } from "./chuangxiang-images-contract.js";
import { getImageEditingCapabilities, imageEditingConnection, imageEditingRequestIssues } from "./image-editing-capabilities.js";
import { assertValidResult } from "./contracts.js";

export function savedModelInterfaces(settings: Readonly<Record<string, unknown>> | undefined): Record<string, DocumentedModelInterface> {
  const value = settings?.autoModelInterfaces;
  return Object.assign(Object.create(null) as Record<string, DocumentedModelInterface>,
    value && typeof value === "object" && !Array.isArray(value) ? value : {});
}

const marked = (result: unknown) => result && typeof result === "object" && "autoInterface" in result && result.autoInterface === true;
function mark(task: ProviderTask): ProviderTask {
  return { ...task, result: { ...(task.result as Record<string, unknown>), autoInterface: true } };
}

/** Prefer supplier-documented routes and freeze each task's transport for recovery. */
export class AutoInterfaceAdapter implements ProviderAdapter {
  private readonly rest: GenericRestAdapter;
  constructor(private readonly connections: ProviderConnectionResolver, private readonly fallback: ProviderAdapter,
    private readonly options: GenericRestAdapterOptions = {}) {
    this.rest = new GenericRestAdapter(connections, options);
  }

  private async selected(request: NormalizedRequest): Promise<ProviderAdapter> {
    if (!request.model) return this.fallback;
    const connection = await this.connections.resolve(request.connectionId);
    const editingIssues = imageEditingRequestIssues(imageEditingConnection(connection), request);
    assertValidResult({ valid: !editingIssues.length, issues: editingIssues });
    const catalog = connection.settings?.modelCatalogModels;
    const current = Array.isArray(catalog) ? (catalog as ModelDescriptor[]).find(model => model?.id === request.model) : undefined;
    const source = imageEditingConnection(connection);
    const bananaRoute = bananaImageRoute(source, request.model);
    if (bananaRoute && request.operation.startsWith("image.")) {
      const ids = connection.settings?.scannedModelIds;
      if (current?.metadata?.canvasRunnable === false || (Array.isArray(ids) && !ids.includes(request.model)))
        throw new Error("当前分组没有此香蕉模型的可用权限或接口");
      const descriptor = applyBananaImageCapabilities(source, current ?? {
        id: request.model, name: request.model, operations: ["image.generate", "image.edit"],
      });
      const submitRoute = bananaRoute.asyncTextGeneration && !request.assets?.length
        ? { ...bananaRoute, kind: "secure-async" as const } : bananaRoute;
      return new BananaImageAdapter(this.connections, submitRoute, descriptor, this.options);
    }
    if (connection.provider === "openai" && request.operation.startsWith("image.") && isPdogImageConnection(source.config, request.model)) {
      const ids = connection.settings?.scannedModelIds;
      if (current?.metadata?.canvasRunnable === false || (Array.isArray(ids) && !ids.includes(request.model)))
        throw new Error("当前 PDog 分组没有此图片模型的可用权限或接口");
      return new PdogImageAdapter(this.connections, this.options, connection.settings?.pdogImageMode === "sync" ? "sync" : "async");
    }
    if (connection.provider === "openai" && request.operation.startsWith("image.") && isChuangxiangImageConnection(source.config, request.model)) {
      const ids = connection.settings?.scannedModelIds;
      if (current?.metadata?.canvasRunnable === false || (Array.isArray(ids) && !ids.includes(request.model)))
        throw new Error("当前创想分组没有此图片模型的可用权限或接口");
      return new ChuangxiangImageAdapter(this.connections, this.options);
    }
    // These contracts are implemented by the dedicated Images adapter. A saved
    // generic mapping must not silently omit a newly selected background/mask.
    const editing = getImageEditingCapabilities(source, request.model, request.parameters);
    if (connection.provider === "openai" && (editing.transparent || editing.mask === "multipart")) {
      const ids = connection.settings?.scannedModelIds;
      if (current?.metadata?.canvasRunnable === false || current?.metadata?.autoInterfaceStatus === "incomplete" ||
          (Array.isArray(ids) && !ids.includes(request.model)))
        throw new Error("当前分组没有此图片型号的可用权限或完整接口");
      return this.fallback;
    }
    if (current?.metadata?.autoInterfaceStatus === "incomplete") throw new Error(String(current.metadata.canvasUnavailableReason ?? "供应商接口说明待补充"));
    const binding = savedModelInterfaces(connection.settings)[request.model];
    if (!binding?.connector || binding.model?.id !== request.model || !binding.model.operations.includes(request.operation)) return this.fallback;
    return new GenericRestAdapter(this.connections, { ...this.options,
      config: { ...binding.connector, models: [current ?? binding.model], restrictModels: true } });
  }

  testConnection(id: string) { return this.fallback.testConnection(id); }
  listModels(id: string) { return this.fallback.listModels(id); }
  async validate(request: NormalizedRequest) {
    try { return await (await this.selected(request)).validate(request); }
    catch (error) { return { valid: false, issues: [{ path: "model", code: "interface_unavailable", message: error instanceof Error ? error.message : "供应商接口配置无法读取" }] }; }
  }
  async submit(request: NormalizedRequest) {
    const adapter = await this.selected(request);
    const task = await adapter.submit(request);
    return adapter === this.fallback ? task : mark(task);
  }
  async poll(task: ProviderTask) {
    if (marked(task.result)) {
      const state = await this.rest.poll(task);
      if (state.status === "succeeded" && task.result && typeof task.result === "object" &&
          "bananaImage" in task.result && task.result.bananaImage === true &&
          !(await this.extractOutputs(state.result)).length) return { ...state, status: "running" as const };
      return state;
    }
    if (!this.fallback.poll) throw new Error("当前接口不支持任务查询");
    return this.fallback.poll(task);
  }
  async cancel(task: ProviderTask) {
    if (marked(task.result)) return this.rest.cancel(task);
    return this.fallback.cancel?.(task);
  }
  async verifyWebhook(request: Request, id?: string) {
    if (!this.fallback.verifyWebhook) throw new Error("当前接口不支持回调");
    return this.fallback.verifyWebhook(request, id);
  }
  extractOutputs(result: unknown) {
    const banana = bananaNativeOutputs(result);
    if (banana) return Promise.resolve(banana);
    return marked(result) ? this.rest.extractOutputs(result) : this.fallback.extractOutputs(result);
  }
  async cleanup(result: unknown) { if (!marked(result)) await this.fallback.cleanup?.(result); }
}
