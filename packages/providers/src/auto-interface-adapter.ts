import type { ModelDescriptor, NormalizedRequest, ProviderAdapter, ProviderConnectionResolver, ProviderTask } from "./contracts.js";
import type { DocumentedModelInterface } from "./documented-interface.js";
import { GenericRestAdapter, type GenericRestAdapterOptions, type RestConnectorConfig } from "./rest.js";
import { BananaImageAdapter, bananaImageRoute, applyBananaImageCapabilities, bananaNativeOutputs } from "./banana-image.js";
import { isPdogImageConnection, PdogImageAdapter } from "./pdog-image.js";
import { isChuangxiangImageConnection, ChuangxiangImageAdapter } from "./chuangxiang-images-contract.js";
import { imageEditingConnection, imageEditingRequestIssues, usesDeclaredImagesEditingRoute } from "./image-editing-capabilities.js";
import { assertValidResult } from "./contracts.js";
import { verifiedTransparentImageEvidence, verifiedTransparentImageJsonEndpoint } from "./transparent-image-evidence.js";
import { isCangyuanMusicRequest } from "./cangyuan-music.js";
import { cangyuanVideoModel, cangyuanVideoTransport, isCangyuanNativeSeedanceRequest } from "./cangyuan-video-contract.js";
import { chuangxiangVideoModel, chuangxiangVideoTransport, isChuangxiangVideoConnection } from "./chuangxiang-video-contract.js";
import { remainingVideoSupplier, remainingVideoModel, remainingVideoTransport, type RemainingVideoContext } from "./remaining-video-contracts.js";
import { modelSupportsGenerationMedia } from "./model-media.js";

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
    const binding = savedModelInterfaces(connection.settings)[request.model];
    if (["openai", "weai"].includes(connection.provider) && (request.operation.startsWith("video.") || request.operation === "music.generate")) {
      const ids = connection.settings?.scannedModelIds;
      const unavailableReason = String(current?.metadata?.canvasUnavailableReason ?? "");
      if (connection.settings?.supplierArchived === true || ["empty", "unauthorized"].includes(String(connection.settings?.modelScanStatus)) ||
          current?.metadata?.canvasRunnable === false || (Array.isArray(ids) && !ids.includes(request.model)) ||
          /401|403|权限|未开通|拒绝|下架|停用|未返回|unauthorized|forbidden|not.?returned|unavailable|disabled/iu.test(unavailableReason))
        throw new Error("当前 Key 或分组没有此媒体型号的可用权限或完整接口");
      const media = request.operation === "music.generate" ? "music" : "video";
      if (current && !modelSupportsGenerationMedia(current, media))
        throw new Error(media === "video" ? "当前型号未声明视频输出，不能用于视频节点" : "当前型号未声明音乐输出，不能用于音乐节点");
      if (media === "video") {
        const supplier = remainingVideoSupplier(connection.baseUrl);
        const group = connection.settings?.accountKeyGroup ?? connection.settings?.modelGroup ?? connection.settings?.group ?? connection.settings?.supplierGroupId;
        const description = connection.settings?.supplierGroupDescription ?? connection.settings?.groupDescription;
        // Account settings are authoritative: cached catalog group metadata
        // cannot grant another Key's Flow/SD transport when group is absent.
        const context: RemainingVideoContext = { group: typeof group === "string" ? group : "",
          groupDescription: typeof description === "string" ? description : "", ...(current ? { model: current } : {}) };
        const nativeCangyuan = connection.provider === "openai" && isCangyuanNativeSeedanceRequest(request.model, connection.baseUrl);
        const nativeChuangxiang = connection.provider === "openai" && isChuangxiangVideoConnection(imageEditingConnection(connection).config, request.model);
        const descriptor = nativeCangyuan ? cangyuanVideoModel(current ?? {
          id: request.model, name: request.model, operations: ["video.generate"],
        }) : nativeChuangxiang ? chuangxiangVideoModel(request.model, current)
          : supplier ? remainingVideoModel(supplier, request.model, current, context) : undefined;
        const transport = nativeCangyuan ? cangyuanVideoTransport(request.model)
          : nativeChuangxiang ? chuangxiangVideoTransport()
            : supplier && descriptor ? remainingVideoTransport(supplier, request.model, context) : undefined;
        if (descriptor && transport?.submit && transport.output) {
          // Supplying the connector through the resolver keeps REST's native
          // validation and parameter normalization active; options.config would
          // freeze them out. Saved credentials, provider and settings stay intact.
          const connector: RestConnectorConfig = { ...transport, submit: transport.submit, output: transport.output,
            auth: { type: "bearer" }, allowedHosts: [new URL(connection.baseUrl!).hostname],
            assetsRequirePublicUrls: true, models: [descriptor], restrictModels: true };
          const resolver: ProviderConnectionResolver = { resolve: async id => id === connection.id
            ? { ...connection, settings: { ...connection.settings, connector } } : this.connections.resolve(id) };
          const { config: _fixedConfig, ...nativeOptions } = this.options;
          return new GenericRestAdapter(resolver, nativeOptions);
        }
      }
      // An explicitly saved media contract can still handle custom routes. An
      // unknown music/video name must never reach an Images fallback adapter.
      if (!binding?.connector || binding.model?.id !== request.model || !binding.model.operations.includes(request.operation) ||
          binding.connector.output.kind !== (media === "video" ? "video" : "audio"))
        throw new Error("此媒体型号的供应商接口说明待补充，暂不能生成");
    }
    if (connection.provider === "rest" && isCangyuanMusicRequest(request.model, connection.baseUrl)) {
      const ids = connection.settings?.scannedModelIds;
      if (current?.metadata?.canvasRunnable === false || (Array.isArray(ids) && !ids.includes(request.model)))
        throw new Error("当前沧元分组没有此音乐模型的可用权限");
      return this.fallback;
    }
    const source = imageEditingConnection(connection);
    const transparentEvidence = verifiedTransparentImageEvidence(source, request.model, request.parameters);
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
      const mode = request.parameters?.background === "transparent" && transparentEvidence?.transport.kind === "pdog-async"
        ? "async" : connection.settings?.pdogImageMode === "sync" ? "sync" : "async";
      return new PdogImageAdapter(this.connections, this.options, mode);
    }
    if (connection.provider === "openai" && request.operation.startsWith("image.") && isChuangxiangImageConnection(source.config, request.model)) {
      const ids = connection.settings?.scannedModelIds;
      if (current?.metadata?.canvasRunnable === false || (Array.isArray(ids) && !ids.includes(request.model)))
        throw new Error("当前创想分组没有此图片模型的可用权限或接口");
      return new ChuangxiangImageAdapter(this.connections, this.options);
    }
    // These contracts are implemented by the dedicated Images adapter. A saved
    // generic mapping must not silently omit a newly selected background/mask.
    // New measured capabilities pin only transparent requests. Ordinary requests
    // keep their saved route; legacy declared Images and mask contracts stay intact.
    if (["openai", "weai"].includes(connection.provider) && (usesDeclaredImagesEditingRoute(source, request.model, request.parameters) ||
        transparentEvidence && request.parameters?.background === "transparent")) {
      const ids = connection.settings?.scannedModelIds;
      if (current?.metadata?.canvasRunnable === false || current?.metadata?.autoInterfaceStatus === "incomplete" ||
          (Array.isArray(ids) && !ids.includes(request.model)))
        throw new Error("当前分组没有此图片型号的可用权限或完整接口");
      if (transparentEvidence && request.parameters?.background === "transparent" &&
          !verifiedTransparentImageJsonEndpoint(source, request.model, request.parameters, transparentEvidence, "openai-images"))
        throw new Error("此已验证透明接口需要对应的专用传输配置，不能切换为通用图片接口");
      return this.fallback;
    }
    if (current?.metadata?.autoInterfaceStatus === "incomplete") throw new Error(String(current.metadata.canvasUnavailableReason ?? "供应商接口说明待补充"));
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
