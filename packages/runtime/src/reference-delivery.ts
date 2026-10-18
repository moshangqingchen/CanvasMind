import {
  bananaRequiresPublicAssets, cangyuanOwnMediaUploadAvailable, chuangxiangMidjourneyRequiresPublicAssets,
  chuangxiangRequiresPublicAssets, isJiasuApiUrl, isJijiuGptImage, isJijiuMultipartImageEdit,
  isRemainingVideoModel, remainingVideoRequiresPublicUrls, remainingVideoSupplier,
  preservesMiaowuExplicitVideoContract, restRequestRequiresPublicAssets, secureSkillRequiresPublicAssets,
  type ModelDescriptor, type ProviderAssetInput, type ProviderOperation, type RestConnectorConfig,
} from "@super-canvas/providers";

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const explicitModel = (value: unknown): boolean => record(value) && record(value.metadata) &&
  (["manual", "paid-test"].includes(String(value.metadata.source)) || value.metadata.protocolEvidence === "paid-test");

export interface ReferenceDeliveryRequest {
  provider: string;
  config?: Readonly<Record<string, unknown>>;
  model?: string;
  operation: ProviderOperation;
  descriptor?: unknown;
  assets?: readonly ProviderAssetInput[];
  maskRequiresUrl?: boolean;
}

/** Match the existing adapter's transport, without changing saved supplier contracts. */
export function requiresPublicReferenceUrls(input: ReferenceDeliveryRequest): boolean {
  const { provider, config, model, operation } = input;
  if (provider === "fake" || provider === "cli" || provider === "langframe") return false;
  const catalog = Array.isArray(config?.modelCatalogModels) ? config.modelCatalogModels : [];
  const connectorModels = record(config?.connector) && Array.isArray(config.connector.models) ? config.connector.models : [];
  const descriptor = input.descriptor ?? [...catalog, ...connectorModels].find(candidate => record(candidate) && candidate.id === model);
  const binding = model && record(config?.autoModelInterfaces) && record(config.autoModelInterfaces[model])
    ? config.autoModelInterfaces[model] : undefined;
  const hasBinding = binding && record(binding.connector) && record(binding.model) && binding.model.id === model &&
    Array.isArray(binding.model.operations) && binding.model.operations.includes(operation);
  const connector = hasBinding ? binding.connector : config?.connector;

  // These adapters already upload original bytes to their own documented media
  // endpoint. Requiring an unrelated local/public host first prevents that path.
  if (cangyuanOwnMediaUploadAvailable(provider, config, model, operation) ||
      (["openai", "rest"].includes(provider) && operation.startsWith("video.") && isJiasuApiUrl(config?.baseUrl))) return false;

  const explicitImage = config?.manualProtocol === true || explicitModel(descriptor) || explicitModel(hasBinding ? binding.model : undefined) ||
    connectorModels.some(candidate => record(candidate) && candidate.id === model && explicitModel(candidate));
  if (["openai", "rest"].includes(provider) && model && !explicitImage && !input.maskRequiresUrl &&
      isJijiuGptImage(config ?? {}, model) && isJijiuMultipartImageEdit(model, operation)) return false;

  // Existing video contracts can supply multipart files even if an older
  // directory row still says remoteMediaUrlsOnly. A saved binding stays first.
  const supplier = remainingVideoSupplier(typeof config?.baseUrl === "string" ? config.baseUrl : undefined);
  const group = config?.accountKeyGroup ?? config?.modelGroup ?? config?.group ?? config?.supplierGroupId;
  const videoContext = { baseUrl: typeof config?.baseUrl === "string" ? config.baseUrl : undefined,
    manualProtocol: config?.manualProtocol, group: typeof group === "string" ? group : "",
    ...(typeof config?.accountKeyGroupId === "string" || typeof config?.accountKeyGroupId === "number" ? { officialGroupId: config.accountKeyGroupId } : {}),
    groupDescription: String(config?.supplierGroupDescription ?? config?.groupDescription ?? ""),
    ...(input.assets ? { assets: input.assets } : {}),
    ...(record(descriptor) ? { model: descriptor as unknown as ModelDescriptor } : {}) };
  const preservesVideoContract = record(descriptor) && preservesMiaowuExplicitVideoContract(config ?? {}, descriptor as unknown as ModelDescriptor, operation);
  const nativeVideo = ["openai", "rest", "weai"].includes(provider) && operation.startsWith("video.") &&
    !hasBinding && !preservesVideoContract && supplier && model && isRemainingVideoModel(supplier, model, videoContext);
  if (nativeVideo && !input.maskRequiresUrl && !remainingVideoRequiresPublicUrls(supplier!, model!, videoContext)) return false;

  // Positive evidence from the selected request body outranks a legacy blanket
  // URL flag. Do not apply a stale saved template over a current native video route.
  if ((provider === "rest" || hasBinding) && !nativeVideo && record(connector)) {
    const rest = connector as unknown as RestConnectorConfig;
    const selected = (operation ? rest.modelOverrides?.[model ?? ""]?.operationOverrides?.[operation]?.submit : undefined)
      ?? rest.operationOverrides?.[operation]?.submit ?? rest.modelOverrides?.[model ?? ""]?.submit ?? rest.submit;
    const assets = selected?.mappings?.filter(mapping => mapping.source.kind === "assets") ?? [];
    const inlineAssets = selected?.bodyMode === "json" && assets.length > 0 && assets.every(mapping =>
      mapping.source.kind === "assets" && ["gemini-part", "gemini-inline-part"].includes(mapping.source.encoding ?? ""));
    if (!input.maskRequiresUrl && assets.length > 0 && (selected?.bodyMode === "multipart" || inlineAssets)) return false;
  }

  return Boolean(input.maskRequiresUrl || nativeVideo && remainingVideoRequiresPublicUrls(supplier!, model!, videoContext) ||
    (provider === "rest" && restRequestRequiresPublicAssets(connector, model, operation, config)) ||
    (hasBinding && restRequestRequiresPublicAssets(connector, model, operation, config)) ||
    (operation.startsWith("video.") && record(descriptor) && record(descriptor.metadata) && descriptor.metadata.remoteMediaUrlsOnly === true) ||
    secureSkillRequiresPublicAssets(provider, config, model, operation) ||
    chuangxiangRequiresPublicAssets(provider, config, model, operation) ||
    chuangxiangMidjourneyRequiresPublicAssets(provider, config, model, operation) ||
    (["openai", "rest"].includes(provider) && operation === "image.edit" && model && isJijiuGptImage(config ?? {}, model)) ||
    bananaRequiresPublicAssets(provider, config, model));
}
