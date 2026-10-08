import {
  catalogPriceLabel,
  type ModelDescriptor,
  type RestConnectorConfig,
  type RestRequestDefinition,
  cangyuanCurrentModel,
  canApplyCangyuanCurrentContract,
  cangyuanMusicModel,
  isCangyuanMusicRequest,
  cangyuanVideoModel,
  isCangyuanNativeSeedanceRequest,
  modelGenerationMediaKinds,
  remainingVideoModel,
  remainingVideoSupplier,
  isMiaowuUnverifiedKeyScanVideoModel,
  isMiaowuUnverifiedAutoVideoContract,
  MIAOWU_VIDEO_CONTRACT_PENDING_REASON,
  savedModelInterfaces,
} from "@super-canvas/providers";
import { applyPdogImageCapabilities } from "@super-canvas/providers/pdog-image-contract";
import { applyBananaImageCapabilities } from "@super-canvas/providers/banana-image-contract";
import { applyChuangxiangCurrentImageCapabilities } from "@super-canvas/providers/chuangxiang-image-contract";
import { applyChuangxiangCurrentVideoCapabilities, chuangxiangVideoModel, isChuangxiangVideoConnection } from "@super-canvas/providers/chuangxiang-video-contract";
import { mikotoGroup } from "./mikoto-presets";
import { chentuFallbackImageDescriptor } from "./chentu-catalog";
import { supplierKeyForConnection } from "./supplier-identity";
import { matchesSupplierTemplate } from "./supplier-template-source";
import { applyVerifiedImage25Capabilities } from "./verified-image25-capabilities";
import { applyMonsterImageCapabilities } from "@super-canvas/providers/monster-image-capabilities";
import { applyChuangxiangImageCapabilities } from "@super-canvas/providers/chuangxiang-image-capabilities";
import { withHighestModelQualityDefault } from "./model-quality";
import { applyGenimageImageCapabilities } from "@super-canvas/providers/genimage-image-capabilities";
import { applySavedModelInterfaces } from "./supplier-interface-discovery";
import { guardNativeVideoRunnableContract } from "./native-video-runnable-contract";

type Connection = { provider: string; config: Record<string, unknown> };

function isDefaultMiaowuConnection(connection: Connection): boolean {
  if (connection.provider !== "rest" || connection.config.preset !== "miaowu-openai-videos" ||
      (connection.config.accountKeyGroup ?? connection.config.modelGroup) !== "default") return false;
  try {
    const url = new URL(String(connection.config.baseUrl ?? ""));
    return url.origin === "https://api.miaowuai.store" && !url.username && !url.password && !url.search && !url.hash && /^(?:\/v1)?\/?$/u.test(url.pathname);
  } catch { return false; }
}

function connectorOf(connection: Connection): RestConnectorConfig | undefined {
  const value = connection.config.connector;
  return value && typeof value === "object" && "submit" in value
    ? (value as RestConnectorConfig)
    : undefined;
}

function family(id: string): string {
  // Supplier channel prefixes select distinct payloads even within one model family.
  const scoped = /^(?:sd\d+-seedance|(?:mm\d+-)?minimax-h\d+)/iu.exec(id)?.[0];
  if (scoped) return scoped.toLowerCase();
  return (
    id
      .toLowerCase()
      .match(
        /gpt-image|gemini|nano-banana|seedance|seedream|kling-omni|kling|sora|veo|grok|flux|wan|hailuo|dall-e/,
      )?.[0] ?? ""
  );
}

function capability(model: ModelDescriptor): string | undefined {
  const kinds = modelGenerationMediaKinds(model);
  return kinds.length ? [...kinds].sort().join("+") : undefined;
}

function hasDeclaredOutput(model: ModelDescriptor): boolean {
  return model.metadata?.outputKindsSource === "declared" || model.metadata?.operationsSource === "declared" ||
    ["chat", "text", "audio", "other"].includes(String(model.metadata?.catalogCapability ?? ""));
}

function hasFixedResolution(id: string): boolean {
  return /^(?:sd\d+-seedance|(?:mm\d+-)?minimax-h\d+)/iu.test(id) &&
    /-(?:480p|720p|768p|1080p|2k|4k)$/iu.test(id);
}

function transportForModel(connector: RestConnectorConfig, sourceId: string, targetId: string) {
  const original = connector.modelOverrides?.[sourceId];
  if (!original || !hasFixedResolution(targetId)) return original;
  const override = structuredClone(original);
  const omitResolution = (submit?: RestRequestDefinition) => {
    if (submit?.mappings) submit.mappings = submit.mappings.filter(mapping =>
      !(mapping.omitIfUndefined && mapping.source.kind === "request" &&
        mapping.source.path === "$.parameters.resolution"));
  };
  omitResolution(override.submit);
  for (const operation of Object.values(override.operationOverrides ?? {}))
    omitResolution(operation?.submit);
  return override;
}

function canInherit(model: ModelDescriptor): boolean {
  if (model.metadata?.canvasRunnable !== false) return true;
  // A pending directory ID cannot regain a guessed sibling transport on a
  // second cached read. Exact documented bindings are applied separately.
  if (model.metadata.miaowuVideoContractPending === true && isMiaowuUnverifiedKeyScanVideoModel(model)) return false;
  const reason = String(model.metadata.canvasUnavailableReason ?? "");
  // An absent catalog entry is different from an upstream permission denial.
  return (
    /协议|尚未内置/u.test(reason) &&
    !/403|权限|未开通|拒绝|下架|停用/u.test(reason)
  );
}

function savedMusicContract(connector: RestConnectorConfig, id: string): boolean {
  const override = connector.modelOverrides?.[id];
  const operation = override?.operationOverrides?.["music.generate"] ?? connector.operationOverrides?.["music.generate"];
  const submit = operation?.submit ?? override?.submit ?? connector.submit;
  const output = operation?.output ?? override?.output ?? connector.output;
  return output?.kind === "audio" && Boolean(submit.path) && !/\/images(?:\/|$)/iu.test(submit.path);
}

function savedWeAiSeedanceContract(connection: Connection, connector: RestConnectorConfig, id: string): boolean {
  if (remainingVideoSupplier(connection.config.baseUrl) !== "weai" || !/^seedance-2\.0(?:-|$)/iu.test(id)) return true;
  const override = connector.modelOverrides?.[id];
  const submit = override?.submit ?? connector.submit;
  // Preserve an exact user-configured SD2 contract, including its chosen path.
  // An Omni-shaped body is not the standardised SD2 request in the official guide.
  return Boolean(submit.mappings?.some(mapping => mapping.target === "/duration_seconds") &&
    submit.mappings?.some(mapping => /^\/reference_(?:images|videos|audios)/u.test(mapping.target)));
}

function knownChentuVideoContract(connection: Connection, model: ModelDescriptor): boolean {
  if (remainingVideoSupplier(connection.config.baseUrl) !== "chentu" || capability(model) !== "video") return true;
  if (remainingVideoModel("chentu", model.id)) return true;
  const metadata = model.metadata ?? {};
  return Boolean(model.parameters?.length && (metadata.source === "manual" || metadata.operationsSource === "declared" ||
    metadata.autoInterfaceStatus === "connected" || metadata.protocolEvidence === "paid-test"));
}

function unresolved(model: ModelDescriptor): ModelDescriptor {
  return {
    ...model,
    metadata: {
      ...model.metadata,
      canvasRunnable: false,
      canvasUnavailableReason:
        "当前分组没有匹配的调用协议，请选择对应的图片或视频分组",
    },
  };
}

function withKnownPriceLabel(model: ModelDescriptor): ModelDescriptor {
  const pricing = model.pricing;
  const placeholder = /价格以(?:平台|模型广场)为准|价格未公布|价格查询失败|价格需登录查询|价格未查询/u;
  if (!pricing || pricing.confidence !== "exact") return model;
  const label = catalogPriceLabel({ pricing });
  if (!label) return model;
  const name = model.name.replace(placeholder, () => label);
  const oldLabel = model.metadata?.priceLabel;
  const metadata =
    !oldLabel || (typeof oldLabel === "string" && placeholder.test(oldLabel))
      ? { ...model.metadata, priceLabel: label }
      : model.metadata;
  return name === model.name && metadata === model.metadata
    ? model
    : { ...model, name, metadata };
}

/** Bind live model IDs to this connection's existing transport, including polling and edits. */
function bindExistingModelProtocols(
  connection: Connection,
  scanned: readonly ModelDescriptor[],
  previous: Connection = connection,
): {
  models: ModelDescriptor[];
  connector?: RestConnectorConfig;
  templateConnector?: RestConnectorConfig;
} {
  if (
    connection.provider === "openai" &&
    supplierKeyForConnection(connection) === "chentu" &&
    matchesSupplierTemplate(connection)
  ) {
    return {
      models: scanned.map((model) => {
        if (model.metadata?.canvasRunnable !== false || !canInherit(model))
          return model;
        const descriptor = chentuFallbackImageDescriptor(
          model.id,
          String(connection.config.modelGroup ?? ""),
        );
        const nativeGemini = model.id === "gemini-nano-banana-2.1" && descriptor?.metadata?.protocol === "gemini-generate-content";
        if (!descriptor || capability(model) !== "image" || descriptor.metadata?.protocol !== "openai-images" && !nativeGemini) return model;
        const metadata: Record<string, unknown> = {
          ...descriptor.metadata,
          ...model.metadata,
          canvasRunnable: true,
        };
        delete metadata.canvasUnavailableReason;
        delete metadata.pendingLiveScan;
        return {
          ...model,
          operations: descriptor.operations,
          inputKinds: descriptor.inputKinds,
          outputKinds: descriptor.outputKinds,
          parameters: descriptor.parameters,
          limits: descriptor.limits,
          metadata: { ...metadata, protocol: descriptor.metadata?.protocol },
        };
      }),
    };
  }
  const current = connectorOf(connection);
  const old = connectorOf(previous);
  const savedTemplate = connectorOf({
    ...previous,
    config: { connector: previous.config.modelProtocolTemplate },
  });
  const geminiGroup =
    connection.provider === "weai" && connection.config.preset === "mikoto-pro"
      ? mikotoGroup(connection.config.modelGroup)
      : undefined;
  if (geminiGroup?.protocol === "gemini-generate-content") {
    const template = geminiGroup.models[0]!;
    return {
      models: scanned.map((model) => {
        if (!canInherit(model) || capability(model) !== "image" || !/^gemini-.*image/iu.test(model.id))
          return model;
        if (geminiGroup.models.some((m) => m.id === model.id)) return model;
        const metadata = { ...model.metadata };
        delete metadata.canvasUnavailableReason;
        return {
          ...model,
          name: `${model.id}（价格以平台为准）`,
          pricing: undefined,
          operations: template.operations,
          inputKinds: template.inputKinds,
          outputKinds: template.outputKinds,
          parameters: template.parameters,
          limits: template.limits,
          metadata: {
            ...metadata,
            priceLabel: "价格以平台为准",
            canvasRunnable: true,
            protocolSourceModel: template.id,
            protocol: geminiGroup.protocol,
          },
        };
      }),
    };
  }
  if (connection.provider !== "rest" || !current)
    return { models: [...scanned] };
  const connector: RestConnectorConfig = {
    ...structuredClone(current),
    modelOverrides: {
      ...savedTemplate?.modelOverrides,
      ...old?.modelOverrides,
      ...current.modelOverrides,
    },
  };
  const templates = [
    ...new Map(
      [
        ...(savedTemplate?.models ?? []),
        ...(old?.models ?? []),
        ...(current.models ?? []),
      ].map((m) => [m.id, m]),
    ).values(),
  ].filter((m) => {
    const inheritedFrom = m.metadata?.protocolSourceModel;
    return m.metadata?.canvasRunnable !== false && m.operations.length && Boolean(capability(m)) &&
      (typeof inheritedFrom !== "string" ||
        (Boolean(family(m.id)) && family(m.id) === family(inheritedFrom)));
  });
  const templateConnector = {
    ...structuredClone(connector),
    models: templates,
  };
  const models = scanned.map((model): ModelDescriptor => {
    if (!canInherit(model)) return model;
    if (hasDeclaredOutput(model) && !capability(model)) return model;
    if (supplierKeyForConnection(connection) === "cangyuan" && matchesSupplierTemplate(connection) &&
      isCangyuanMusicRequest(model.id, String(connection.config.baseUrl ?? ""))) return cangyuanMusicModel(model);
    // Dedicated contracts execute dynamically for their exact IDs. Do not
    // inherit and persist a generic sibling route into the shared connector.
    if (supplierKeyForConnection(connection) === "cangyuan" && matchesSupplierTemplate(connection) &&
      canApplyCangyuanCurrentContract(connection.config, String(connection.config.baseUrl ?? ""), model.id))
      return cangyuanCurrentModel(model);
    const existing = templates.find((m) => m.id === model.id);
    if (existing) {
      if ((hasDeclaredOutput(model) || capability(model) === "music") && capability(existing) !== capability(model)) return unresolved(model);
      if (capability(model) === "music" && !savedMusicContract(connector, model.id)) return unresolved(model);
      if (!savedWeAiSeedanceContract(connection, connector, model.id)) return unresolved(model);
      if (!knownChentuVideoContract(connection, model) && !knownChentuVideoContract(connection, existing)) return {
        ...unresolved(model), parameters: [], metadata: { ...unresolved(model).metadata, parameterControlsUnavailable: true,
          canvasUnavailableReason: "该型号的视频参数与调用协议待供应商文档确认" },
      };
      const metadata = { ...existing.metadata, ...model.metadata, canvasRunnable: true };
      delete (metadata as Record<string, unknown>).canvasUnavailableReason;
      if (remainingVideoSupplier(connection.config.baseUrl) === "chentu" && knownChentuVideoContract(connection, existing) && existing.parameters?.length) delete (metadata as Record<string, unknown>).parameterControlsUnavailable;
      return {
        ...existing, ...model,
        operations: existing.operations,
        inputKinds: model.metadata?.inputKindsSource === "declared" ? model.inputKinds : existing.inputKinds ?? model.inputKinds,
        outputKinds: model.metadata?.outputKindsSource === "declared" ? model.outputKinds : existing.outputKinds ?? model.outputKinds,
        parameters: model.parameters ?? existing.parameters,
        limits: model.limits ?? existing.limits,
        metadata,
      };
    }
    const kind = capability(model);
    if (!kind) return model;
    if (kind.split("+").includes("music")) return unresolved(model);
    if (!knownChentuVideoContract(connection, model)) return { ...unresolved(model), parameters: [], metadata: {
      ...unresolved(model).metadata, parameterControlsUnavailable: true, canvasUnavailableReason: "该型号的视频参数与调用协议待供应商文档确认" } };
    if (remainingVideoSupplier(connection.config.baseUrl) === "weai" && /^seedance-2\.0(?:-|$)/iu.test(model.id)) return unresolved(model);
    let candidates = existing
      ? [existing]
      : templates.filter((m) => capability(m) === kind);
    const sameFamily = candidates.filter(
      (m) => family(m.id) && family(m.id) === family(model.id),
    );
    // Similar output kinds alone do not make Grok, Veo, MiniMax, etc. share a protocol.
    candidates = sameFamily;
    // A mixed group may have incompatible video/image APIs. Only infer a
    // transport when the candidate family has one consistent configuration.
    const transports = new Set(
      candidates.map((m) =>
        JSON.stringify(transportForModel(connector, m.id, model.id) ?? {}),
      ),
    );
    if (!candidates.length || transports.size !== 1) return unresolved(model);
    const template = candidates.find((m) => m.isDefault) ?? candidates[0]!;
    const override = transportForModel(connector, template.id, model.id);
    // Only reuse transports that send the selected model ID. A hard-coded
    // model endpoint must not silently generate with the template's model.
    if (
      !template.operations.every((operation) => {
        const submit =
          override?.operationOverrides?.[operation]?.submit ??
          connector.operationOverrides?.[operation]?.submit ??
          override?.submit ??
          connector.submit;
        return submit.mappings?.some(
          (mapping) =>
            mapping.source.kind === "request" &&
            mapping.source.path === "$.model",
        );
      })
    )
      return unresolved(model);
    if (override)
      connector.modelOverrides = {
        ...connector.modelOverrides,
        [model.id]: structuredClone(override),
      };
    const metadata = { ...template.metadata, ...model.metadata };
    delete metadata.canvasUnavailableReason;
    // Snapshot prices belong to the original model, never to a new alias.
    for (const key of [
      "priceLabel",
      "billingLabel",
      "pricing",
      "price",
      "cost",
    ])
      if (model.metadata?.[key] === undefined) delete metadata[key];
    return {
      id: model.id,
      name:
        model.pricing || model.name.includes("价格")
          ? model.name
          : `${model.name}（${model.metadata?.priceLabel ?? "价格以平台为准"}）`,
      provider: model.provider,
      operations: template.operations,
      inputKinds: template.inputKinds,
      outputKinds: template.outputKinds,
      parameters: structuredClone(model.parameters ?? template.parameters)?.filter(parameter =>
        !(hasFixedResolution(model.id) && parameter.key === "resolution")),
      limits: structuredClone(model.limits ?? template.limits),
      ...(model.pricing ? { pricing: model.pricing } : {}),
      isDefault: model.isDefault,
      description: "当前 Key 扫描到的模型，使用当前分组的调用协议。",
      metadata: {
        ...metadata,
        canvasRunnable: true,
        protocolSourceModel: template.id,
      },
    };
  });
  connector.models = models.filter(
    (m) => m.operations.length && m.metadata?.canvasRunnable !== false,
  );
  const liveIds = new Set(connector.models.map((m) => m.id));
  connector.modelOverrides = Object.fromEntries(
    Object.entries(connector.modelOverrides ?? {}).filter(([id]) =>
      liveIds.has(id),
    ),
  );
  return { models, connector, templateConnector };
}

export function bindScannedModelProtocols(
  connection: Connection,
  scanned: readonly ModelDescriptor[],
  previous: Connection = connection,
): ReturnType<typeof bindExistingModelProtocols> {
  // Only undo a refusal that this guard produced, after its automatic transport
  // was replaced with a custom/verified contract. Existing Key denials stay put.
  const prepared = scanned.map(model => {
    if (model.metadata?.miaowuVideoContractPending !== true || model.metadata.canvasRunnable !== false ||
        model.metadata.canvasUnavailableReason !== MIAOWU_VIDEO_CONTRACT_PENDING_REASON ||
        !isDefaultMiaowuConnection(connection) ||
        connection.config.supplierArchived === true || ["empty", "unauthorized"].includes(String(connection.config.modelScanStatus)) ||
        Array.isArray(connection.config.scannedModelIds) && !connection.config.scannedModelIds.includes(model.id) ||
        !connectorOf(connection) || isMiaowuUnverifiedAutoVideoContract(connection.config, model)) return model;
    const metadata: Record<string, unknown> = { ...model.metadata, canvasRunnable: true };
    delete metadata.miaowuVideoContractPending;
    delete metadata.canvasUnavailableReason;
    return { ...model, metadata };
  });
  const bound = bindExistingModelProtocols(connection, prepared, previous);
  const compatibleModels = bound.models.map((model) =>
    withHighestModelQualityDefault(
      withKnownPriceLabel(
        applyGenimageImageCapabilities(connection, applyChuangxiangImageCapabilities(
          connection,
          applyMonsterImageCapabilities(connection, applyVerifiedImage25Capabilities(connection, model)),
        )),
      ),
    ),
  );
  const currentCangyuan = connection.provider === "rest" && supplierKeyForConnection(connection) === "cangyuan" && matchesSupplierTemplate(connection);
  let models = applySavedModelInterfaces(connection, compatibleModels)
    .map(model => applyBananaImageCapabilities(connection, model))
    .map(model => applyPdogImageCapabilities(connection, applyChuangxiangCurrentImageCapabilities(connection, model)))
    .map(model => applyChuangxiangCurrentVideoCapabilities(connection, model)).map(withHighestModelQualityDefault);
  if (currentCangyuan) {
    for (let i = 0; i < models.length; i++) if (canInherit(models[i]!) &&
      canApplyCangyuanCurrentContract(connection.config, String(connection.config.baseUrl ?? ""), models[i]!.id))
      models[i] = cangyuanCurrentModel(models[i]!);
  }
  // Cached transport and native-contract enrichment cannot rewrite an explicit
  // live output declaration into a different node type for the same ID.
  const originalById = new Map(scanned.map(model => [model.id, model]));
  const remainingSupplier = remainingVideoSupplier(connection.config.baseUrl);
  models = models.map(model => {
    if (model.metadata?.autoInterfaceStatus === "connected" && model.parameters?.length && model.metadata.parameterControlsUnavailable) {
      const metadata = { ...model.metadata };
      delete metadata.parameterControlsUnavailable;
      model = { ...model, metadata };
    }
    const original = originalById.get(model.id);
    if (original && hasDeclaredOutput(original) && capability(original) !== capability(model)) return unresolved(original);
    const nativeCangyuan = connection.provider === "openai" && isCangyuanNativeSeedanceRequest(model.id, String(connection.config.baseUrl));
    const nativeChuangxiang = connection.provider === "openai" && isChuangxiangVideoConnection(connection.config, model.id);
    if (nativeCangyuan || nativeChuangxiang) {
      if (connection.config.supplierArchived === true || ["empty", "unauthorized"].includes(String(connection.config.modelScanStatus)) ||
          Array.isArray(connection.config.scannedModelIds) && !connection.config.scannedModelIds.includes(model.id) ||
          /401|403|权限|未开通|拒绝|下架|停用|未返回|unauthorized|forbidden|not.?returned|unavailable|disabled/iu.test(String(model.metadata?.canvasUnavailableReason ?? ""))) {
        return { ...model, metadata: { ...model.metadata, canvasRunnable: false,
          canvasUnavailableReason: model.metadata?.canvasUnavailableReason ?? "当前 Key 或分组没有此媒体型号的可用权限" } };
      }
    }
    if ((nativeCangyuan || nativeChuangxiang) && canInherit(model) && (!hasDeclaredOutput(model) || capability(model) === "video")) {
      const documented = nativeCangyuan ? cangyuanVideoModel(model) : chuangxiangVideoModel(model.id, model);
      const metadata: Record<string, unknown> = { ...documented.metadata, canvasRunnable: true };
      delete (metadata as Record<string, unknown>).canvasUnavailableReason;
      delete (metadata as Record<string, unknown>).parameterControlsUnavailable;
      if (metadata.autoInterfaceStatus === "incomplete") delete (metadata as Record<string, unknown>).autoInterfaceStatus;
      return { ...documented, metadata };
    }
    // Native OpenAI-compatible connections also need an exact video contract;
    // an inferred directory operation alone does not establish request parameters.
    if (canInherit(model) && !knownChentuVideoContract(connection, model)) return {
      ...unresolved(model), parameters: [], metadata: { ...unresolved(model).metadata,
        parameterControlsUnavailable: true, canvasUnavailableReason: "该型号的视频参数与调用协议待供应商文档确认" },
    };
    const documented = remainingSupplier && canInherit(model) && (!hasDeclaredOutput(model) || capability(model) === "video")
      ? remainingVideoModel(remainingSupplier, model.id, model, {
          group: String(connection.config.modelGroup ?? connection.config.group ?? ""),
          groupDescription: String(connection.config.modelGroupDescription ?? connection.config.groupDescription ?? ""),
        }) : undefined;
    if (!documented) return model;
    const metadata = { ...documented.metadata, canvasRunnable: true };
    delete (metadata as Record<string, unknown>).canvasUnavailableReason;
    return { ...documented, metadata };
  });
  models = models.map(model => guardNativeVideoRunnableContract(connection, model));
  const miaowuPending = new Set<string>();
  const miaowuBindings = isDefaultMiaowuConnection(connection) ? savedModelInterfaces(connection.config) : {};
  models = models.map(model => {
    const original = originalById.get(model.id), binding = miaowuBindings[model.id];
    if (isMiaowuUnverifiedKeyScanVideoModel(original) && model.metadata?.canvasRunnable !== false &&
        model.metadata?.autoInterfaceStatus === "connected" && modelGenerationMediaKinds(model).join("+") === "video" &&
        binding?.model.id === model.id && binding.connector.submit?.path && binding.connector.output?.kind === "video" &&
        modelGenerationMediaKinds(binding.model).join("+") === "video") {
      // A documented text-to-video binding cannot also grant the inferred
      // image-to-video operation from the old Key-only directory descriptor.
      const operations = model.operations.filter(operation => original!.operations.includes(operation) && binding.model.operations.includes(operation));
      if (operations.length) model = { ...model, operations };
    }
    if (connection.provider !== "rest" || !isMiaowuUnverifiedAutoVideoContract(connection.config, model, bound.connector)) return model;
    miaowuPending.add(model.id);
    return { ...model, metadata: { ...model.metadata, canvasRunnable: false, parameterControlsUnavailable: true,
      miaowuVideoContractPending: true, canvasUnavailableReason: model.metadata?.canvasRunnable === false &&
        model.metadata.canvasUnavailableReason ? model.metadata.canvasUnavailableReason : MIAOWU_VIDEO_CONTRACT_PENDING_REASON } };
  });
  const withoutAutomaticMiaowuOverrides = (connector: RestConnectorConfig): RestConnectorConfig => ({
    ...connector,
    models: connector.models?.filter(model => !miaowuPending.has(model.id)),
    modelOverrides: Object.fromEntries(Object.entries(connector.modelOverrides ?? {}).filter(([id]) => !miaowuPending.has(id))),
  });
  return {
    ...bound,
    models,
    ...(miaowuPending.size && bound.templateConnector ? { templateConnector: withoutAutomaticMiaowuOverrides(bound.templateConnector) } : {}),
    ...(bound.connector
      ? {
          connector: {
            ...(miaowuPending.size ? withoutAutomaticMiaowuOverrides(bound.connector) : bound.connector),
            models: models.filter(
              (m) =>
                m.operations.length && m.metadata?.canvasRunnable !== false,
            ),
          },
        }
      : {}),
  };
}
