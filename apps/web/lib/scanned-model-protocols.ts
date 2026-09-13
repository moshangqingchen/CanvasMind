import {
  scanProviderModelCatalog,
  catalogPriceLabel,
  type ModelDescriptor,
  type RestConnectorConfig,
  type RestRequestDefinition,
} from "@super-canvas/providers";
import { mikotoGroup } from "./mikoto-presets";
import { chentuFallbackImageDescriptor } from "./chentu-catalog";
import { supplierKeyForConnection } from "./supplier-identity";
import { matchesSupplierTemplate } from "./supplier-template-source";
import { applyVerifiedImage25Capabilities } from "./verified-image25-capabilities";

type Connection = { provider: string; config: Record<string, unknown> };

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
  const operations = model.operations.length
    ? model.operations
    : (scanProviderModelCatalog({ data: [{ id: model.id }] }).models[0]
        ?.operations ?? []);
  return operations.some((op) => op.startsWith("video."))
    ? "video"
    : operations.some((op) => op.startsWith("image."))
      ? "image"
      : undefined;
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
  const reason = String(model.metadata.canvasUnavailableReason ?? "");
  // An absent catalog entry is different from an upstream permission denial.
  return (
    /协议|尚未内置/u.test(reason) &&
    !/403|权限|未开通|拒绝|下架|停用/u.test(reason)
  );
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
  if (connection.config.usage === "agent") return { models: [...scanned] };
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
        if (!descriptor || descriptor.metadata?.protocol !== "openai-images") return model;
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
          parameters: descriptor.parameters,
          limits: descriptor.limits,
          metadata: { ...metadata, protocol: "openai-images" },
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
        if (!canInherit(model) || !/^gemini-.*image/iu.test(model.id))
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
    return m.metadata?.canvasRunnable !== false && m.operations.length &&
      (typeof inheritedFrom !== "string" ||
        (Boolean(family(m.id)) && family(m.id) === family(inheritedFrom)));
  });
  const templateConnector = {
    ...structuredClone(connector),
    models: templates,
  };
  const models = scanned.map((model): ModelDescriptor => {
    if (!canInherit(model)) return model;
    const existing = templates.find((m) => m.id === model.id);
    if (existing) {
      const metadata = { ...existing.metadata, ...model.metadata, canvasRunnable: true };
      delete (metadata as Record<string, unknown>).canvasUnavailableReason;
      return {
        ...existing, ...model,
        operations: existing.operations,
        inputKinds: existing.inputKinds ?? model.inputKinds,
        outputKinds: existing.outputKinds ?? model.outputKinds,
        parameters: model.parameters ?? existing.parameters,
        limits: model.limits ?? existing.limits,
        metadata,
      };
    }
    const kind = capability(model);
    if (!kind) return model;
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
      parameters: structuredClone(template.parameters)?.filter(parameter =>
        !(hasFixedResolution(model.id) && parameter.key === "resolution")),
      limits: structuredClone(template.limits),
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
  const bound = bindExistingModelProtocols(connection, scanned, previous);
  const models = bound.models.map((model) =>
    withKnownPriceLabel(applyVerifiedImage25Capabilities(connection, model)),
  );
  return {
    ...bound,
    models,
    ...(bound.connector
      ? {
          connector: {
            ...bound.connector,
            models: models.filter(
              (m) =>
                m.operations.length && m.metadata?.canvasRunnable !== false,
            ),
          },
        }
      : {}),
  };
}
