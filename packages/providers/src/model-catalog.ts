import type { ModelDescriptor, ProviderOperation } from "./contracts.js";
import { catalogPriceLabel } from "./catalog-pricing.js";
import { modelInterfaceEvidence } from "./documented-interface.js";

export interface ProviderCatalogGroup {
  id: string;
  label: string;
  modelIds: readonly string[];
}

export interface ProviderCatalogScan {
  models: ModelDescriptor[];
  groups: ProviderCatalogGroup[];
  checkedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 256): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result ? result.slice(0, max) : undefined;
}

function number(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value.replace(/[$￥¥,\s]/gu, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function operationsForModel(
  id: string,
  value: Record<string, unknown>,
): ProviderOperation[] {
  const declared = value.operations ?? value.capabilities;
  if (Array.isArray(declared)) {
    const operations = declared.filter(
      (item): item is ProviderOperation =>
        item === "image.generate" ||
        item === "image.edit" ||
        item === "video.generate" ||
        item === "video.image-to-video" ||
        item === "music.generate",
    );
    if (operations.length > 0) return operations;
  }
  // Explicit output modalities beat a suggestive ID (e.g. image-understanding).
  const metadata = isRecord(value.metadata) ? value.metadata : {};
  const architecture = isRecord(value.architecture) ? value.architecture : {};
  const output = value.output_modalities ?? value.outputKinds ?? metadata.output_modalities ?? architecture.output_modalities;
  if (Array.isArray(output)) {
    const kinds = output.filter((item): item is string => typeof item === "string").map(item => item.toLowerCase());
    if (kinds.some(kind => kind === "video" || kind === "video[]")) return ["video.generate", "video.image-to-video"];
    if (kinds.some(kind => kind === "image" || kind === "image[]")) return ["image.generate", "image.edit"];
    if (kinds.some(kind => kind === "audio" || kind === "audio[]")) return ["music.generate"];
    if (kinds.includes("text")) return [];
  }
  const kind = `${id} ${text(value.type) ?? ""} ${text(value.kind) ?? ""}`;
  if (/^lyria-(?:3-pro|3\.5)$/iu.test(id)) return ["music.generate"];
  if (/video|kling|runway|seedance|sora|hailuo|luma|veo|happyhorse|minimax-h\d|(?:^|[\s/_-])wan\d|视频/iu.test(kind))
    return ["video.generate", "video.image-to-video"];
  if (
    /image|midjourney|nano[-_ ]?banana|dall[-_ ]?e|flux|stable[-_ ]?diffusion|sdxl|imagen|seedream|画图|绘图/iu.test(
      kind,
    )
  )
    return ["image.generate", "image.edit"];
  return [];
}

type ModelFactsSource = "model-api" | "supplier-catalog";

function modalities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const aliases: Record<string, string> = { images: "image", videos: "video", audios: "audio" };
  return [...new Set(value.filter((item): item is string => typeof item === "string")
    .map(item => item.trim().toLowerCase()).map(item => aliases[item] ?? item))];
}

/** Only explicit upload/input limits are read from prose; output counts are unrelated. */
function documentedInputCount(documentation: string, kind: "image" | "video" | "audio"): number | undefined {
  const chinese = { image: "(?:图片|图像)", video: "视频", audio: "音频" }[kind];
  const patterns = [
    new RegExp(`(?:最多|至多)\\s*(?:支持|可)?\\s*(?:上传|输入|附加)\\s*(\\d+)\\s*(?:张|个|段|条)?\\s*${chinese}`, "iu"),
    new RegExp(`${chinese}\\s*(?:输入|上传)(?:数量)?\\s*(?:上限(?:为)?|最多(?:为)?|[:：])\\s*(\\d+)`, "iu"),
    new RegExp(`(?:upload|attach|input)\\s+(?:up to\\s+|at most\\s+|a maximum of\\s+)?(\\d+)\\s+(?:input\\s+)?${kind}s?\\b`, "iu"),
    new RegExp(`(?:up to|at most|maximum(?: of)?)\\s+(\\d+)\\s+input\\s+${kind}s?\\b`, "iu"),
    new RegExp(`(?:maximum|max)\\s+(?:number of\\s+)?input\\s+${kind}s?\\s*[:=]?\\s*(\\d+)`, "iu"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(documentation);
    if (match) return Number(match[1]);
  }
  return undefined;
}

const documentedReasoningValues = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
type ReasoningOption = { value: string; label: string };

/** A named parameter and an explicit enumeration are required; prose adjectives are not evidence. */
function documentedReasoningOptions(records: Record<string, unknown>[], prose: string): ReasoningOption[] {
  const found = new Map<string, ReasoningOption>();
  const add = (raw: unknown) => {
    const value = (typeof raw === "string" ? text(raw, 20) : isRecord(raw) ? text(raw.value ?? raw.const, 20) : undefined)?.toLowerCase();
    if (value && documentedReasoningValues.has(value) && !found.has(value)) {
      found.set(value, { value, label: isRecord(raw) ? text(raw.label, 40) ?? value : value });
    }
  };
  const isParameter = (path: string) => /(?:^|\.)(?:reasoning(?:[._]effort)?|thinking(?:[._](?:effort|level))?|思考强度|思考档位)$/iu.test(path);
  let visited = 0;
  const visit = (raw: unknown, path = "", depth = 0) => {
    if (depth > 7 || ++visited > 600) return;
    if (Array.isArray(raw)) {
      for (const entry of raw.slice(0, 100)) visit(entry, path, depth + 1);
      return;
    }
    if (!isRecord(raw)) return;
    const name = text(raw.name ?? raw.key ?? raw.parameter);
    const currentPath = name ?? path;
    if (isParameter(currentPath)) {
      for (const value of [raw.enum, raw.options].filter(Array.isArray)) value.slice(0, 50).forEach(add);
    }
    for (const [key, value] of Object.entries(raw)) {
      if (["enum", "options", "name", "key", "parameter"].includes(key)) continue;
      const next = ["properties", "schema", "parameters"].includes(key) ? currentPath : `${currentPath}.${key}`;
      visit(value, next, depth + 1);
    }
  };
  for (const record of records) for (const schema of [record.parameters, record.input_schema, record.request_schema, record.schema]) visit(schema);
  if (found.size) return [...found.values()];
  const label = /(?:\breasoning[._]effort\b|思考强度|思考档位)[`"']?\s*/giu;
  const marker = /^(?:(?:支持(?:的)?(?:值|选项|档位)?|可选(?:值|项|档位)?|取值|枚举)(?:为)?\s*[:：=]?|(?:allowed values|supported values|enum|one of|can be)\s*[:=]?|[:：=]|\|\s*(?:string\s*\|\s*)?(?:enum\s*[:=]?\s*)?)\s*/iu;
  const token = "[`\"']?(?:none|minimal|low|medium|high|xhigh|max|ultra)[`\"']?";
  const list = new RegExp(`^[\\[({]?\\s*(${token}(?:(?:\\s*[,，、/|]\\s*|\\s+(?:or|and)\\s+|\\s*或\\s*)${token})*)(?=\\s*(?:[\\])}|。.;；]|$))`, "iu");
  for (const match of prose.matchAll(label)) {
    const tail = prose.slice(match.index + match[0].length).split(/[\r\n]/u, 1)[0]!.slice(0, 300);
    const declaration = marker.exec(tail);
    if (!declaration) continue;
    const choices = list.exec(tail.slice(declaration[0].length));
    if (choices) for (const value of choices[1]!.match(/[a-z]+/giu) ?? []) add(value);
  }
  return [...found.values()];
}

/** Preserve explicit model facts separately from the scanner's display defaults. */
export function parseProviderModelFacts(entry: Record<string, unknown>, source: ModelFactsSource = "model-api"): {
  inputKinds?: ModelDescriptor["inputKinds"];
  outputKinds?: ModelDescriptor["outputKinds"];
  limits?: ModelDescriptor["limits"];
  metadata: Record<string, unknown>;
} {
  const metadata = isRecord(entry.metadata) ? entry.metadata : {};
  const capabilities = isRecord(entry.capabilities) ? entry.capabilities : {};
  const architecture = isRecord(entry.architecture) ? entry.architecture : {};
  const documentation = [entry.documentation, entry.docs].filter(isRecord);
  const records = [entry, metadata, capabilities, architecture,
    ...(isRecord(metadata.agentCapabilities) ? [metadata.agentCapabilities] : []),
    ...documentation.flatMap(value => [value, ...(isRecord(value.capabilities) ? [value.capabilities] : [])])];
  const input = modalities(entry.input_modalities ??
    (metadata.inputKindsSource === "inferred" ? undefined : entry.inputKinds) ??
    records.map(record => record.input_modalities ?? record.inputModalities).find(Array.isArray));
  const output = modalities(entry.output_modalities ??
    (metadata.outputKindsSource === "inferred" ? undefined : entry.outputKinds) ??
    records.map(record => record.output_modalities ?? record.outputModalities).find(Array.isArray));
  const flags: Record<string, boolean> = {};
  const names: Record<string, string[]> = {
    imageInput: ["imageInput", "image_input", "vision", "supports_vision", "supports_image_input"],
    audioInput: ["audioInput", "audio_input", "supports_audio_input"],
    videoInput: ["videoInput", "video_input", "supports_video_input"],
    structuredOutput: ["structuredOutput", "structured_output", "structured_outputs", "json_schema"],
    toolCalling: ["toolCalling", "tool_calling", "function_calling"], reasoning: ["reasoning", "supportsReasoning", "supports_reasoning"],
  };
  for (const [key, aliases] of Object.entries(names)) {
    const explicit = records.flatMap(record => aliases.map(alias => record[alias])).find(value => typeof value === "boolean");
    if (typeof explicit === "boolean") flags[key] = explicit;
  }
  if (input) for (const kind of ["image", "audio", "video"]) {
    flags[`${kind}Input`] ??= input.some(value => value === kind || value === `${kind}[]`);
  }
  const prose = records.flatMap(record => [record.description, record.documentation, record.notes, record.text, record.content])
    .flatMap(value => typeof value === "string" ? [value.slice(0, 16000)] : []).join("\n");
  const limits: NonNullable<ModelDescriptor["limits"]> = {};
  const limitSources: Record<string, "declared" | "documentation"> = {};
  const limitRecords = records.flatMap(record => [record, record.limits, record.inputLimits, record.input_limits].filter(isRecord));
  for (const kind of ["image", "video", "audio"] as const) {
    const title = `${kind[0]!.toUpperCase()}${kind.slice(1)}`;
    const key = `maxInput${title}s` as "maxInputImages" | "maxInputVideos" | "maxInputAudios";
    const aliases = [key, `max_input_${kind}s`, `max_input_${kind}_count`, `max_${kind}_inputs`];
    const inputRecords = records.flatMap(record => [record.inputLimits, record.input_limits].filter(isRecord));
    const declared = [...limitRecords.flatMap(record => aliases.map(alias => number(record[alias]))),
      ...inputRecords.flatMap(record => [number(record[`max_${kind}s`]), number(record[`${kind}_limit`]), number(record[`${kind}s`])])]
      .find(value => value !== undefined && Number.isSafeInteger(value) && value >= 0);
    const documented = declared === undefined ? documentedInputCount(prose, kind) : undefined;
    const count = declared ?? documented;
    if (count !== undefined && Number.isSafeInteger(count) && count >= 0) {
      limits[key] = count;
      limitSources[key] = declared === undefined ? "documentation" : "declared";
      flags[`${kind}Input`] ??= count > 0;
    }
    const chinese = { image: "(?:图片|图像|视觉)", video: "视频", audio: "音频" }[kind];
    const denied = new RegExp(`(?:不支持|禁止)\\s*${chinese}\\s*(?:输入|上传|理解)|(?:does not support|no)\\s+${kind}\\s+inputs?`, "iu").test(prose);
    const supported = new RegExp(`支持\\s*${chinese}\\s*(?:输入|上传|理解)|supports?\\s+${kind}\\s+inputs?`, "iu").test(prose);
    if (flags[`${kind}Input`] === undefined && (denied || supported)) flags[`${kind}Input`] = !denied;
  }
  const total = limitRecords.flatMap(record => [record.maxInputAssets, record.max_input_assets, record.maxAttachments, record.max_attachments].map(number))
    .find(value => value !== undefined && Number.isSafeInteger(value) && value >= 0);
  if (total !== undefined) {
    limits.maxInputAssets = total;
    limitSources.maxInputAssets = "declared";
  }
  const reasoningRecord = records.find(record => Array.isArray(record.reasoningOptions ?? record.reasoning_efforts ?? record.supported_reasoning_efforts ??
    (isRecord(record.reasoning) ? record.reasoning.efforts : undefined)));
  const reasoning = reasoningRecord && (reasoningRecord.reasoningOptions ?? reasoningRecord.reasoning_efforts ?? reasoningRecord.supported_reasoning_efforts ??
    (isRecord(reasoningRecord.reasoning) ? reasoningRecord.reasoning.efforts : undefined));
  const reasoningOptions = Array.isArray(reasoning) ? reasoning.flatMap(raw => {
    const value = typeof raw === "string" ? text(raw, 20) : isRecord(raw) ? text(raw.value, 20) : undefined;
    return value && /^[a-z][a-z0-9_-]*$/u.test(value) ? [{ value, label: isRecord(raw) ? text(raw.label, 40) ?? value : value }] : [];
  }) : documentedReasoningOptions(records, prose);
  const reasoningOptionsSource = reasoningRecord
    ? (reasoningRecord.reasoningOptionsSource === "documentation" || documentation.includes(reasoningRecord) ? "documentation" : "declared")
    : "documentation";
  const protocol = records.map(record => text(record.agentProtocol ?? record.protocol)).find(Boolean);
  // Preserve explicit upstream identities, including conflicts/dynamic routes.
  // Similar names and reseller suffixes are never an identity mapping.
  const officialModelCandidates = [...new Set(records.flatMap(record => [
    record.officialModelId, record.official_model, record.upstreamModelId, record.upstream_model,
    record.base_model, record.actual_model, record.aliasFor, record.alias_for,
    ...(Array.isArray(record.officialModelCandidates) ? record.officialModelCandidates : []),
  ]).flatMap(value => typeof value === "string" && value.trim() ? [value.trim().slice(0, 256)] : []))];
  const kind = text(entry.type ?? entry.kind ?? metadata.modelKind);
  return {
    ...(input ? { inputKinds: input.filter((v): v is NonNullable<ModelDescriptor["inputKinds"]>[number] => ["text", "image", "image[]", "video", "video[]", "audio", "audio[]"].includes(v)) } : {}),
    ...(output ? { outputKinds: output.filter((v): v is NonNullable<ModelDescriptor["outputKinds"]>[number] => ["text", "image", "image[]", "video", "video[]", "audio", "audio[]"].includes(v)) } : {}),
    ...(Object.keys(limits).length ? { limits } : {}),
    metadata: {
      modelFactsSource: source,
      ...modelInterfaceEvidence(entry),
      inputKindsSource: input ? "declared" : "inferred",
      outputKindsSource: output ? "declared" : "inferred",
      ...(Object.keys(limitSources).length ? { inputLimitSources: limitSources } : {}),
      ...(Object.keys(flags).length ? { agentCapabilities: flags } : {}),
      ...(reasoningOptions.length ? { reasoningOptions, reasoningOptionsSource } : {}),
      ...(protocol ? { agentProtocol: protocol } : {}),
      ...(officialModelCandidates.length ? { officialModelCandidates } : {}),
      ...(kind ? { modelKind: kind } : {}),
    },
  };
}

function pricing(value: Record<string, unknown>): {
  priceLabel?: string;
  billingLabel?: string;
} {
  const nested = [value.pricing, value.price, value.billing].find(isRecord);
  const priceLabel =
    catalogPriceLabel(value) ??
    text(value.priceLabel) ??
    text(value.price_label) ??
    text(value.billingLabel) ??
    text(value.billing_label) ??
    text(typeof value.price === "string" ? value.price : undefined) ??
    (typeof value.price === "number" ? String(value.price) : undefined) ??
    (nested
      ? (text(nested.label) ??
        text(nested.priceLabel) ??
        (() => {
          const input = number(nested.input ?? nested.input_price);
          const output = number(nested.output ?? nested.output_price);
          if (input === undefined && output === undefined) return undefined;
          return [
            input === undefined ? "" : `输入 ${input}/1M`,
            output === undefined ? "" : `输出 ${output}/1M`,
          ]
            .filter(Boolean)
            .join(" · ");
        })())
      : undefined);
  const billingLabel =
    text(value.billingLabel) ??
    text(value.billing_label) ??
    text(value.billingMode) ??
    text(value.billing_mode) ??
    (nested ? (text(nested.unit) ?? text(nested.dimension)) : undefined);
  return {
    ...(priceLabel ? { priceLabel: priceLabel.slice(0, 256) } : {}),
    ...(billingLabel ? { billingLabel: billingLabel.slice(0, 128) } : {}),
  };
}

function entriesFromPayload(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload))
    return payload.filter(isRecord) as Record<string, unknown>[];
  if (!isRecord(payload)) return [];
  const candidates = [
    payload.data,
    payload.models,
    payload.items,
    payload.result,
  ];
  return candidates.flatMap((candidate) => {
    if (Array.isArray(candidate))
      return candidate.filter(isRecord) as Record<string, unknown>[];
    if (isRecord(candidate))
      return Object.entries(candidate).flatMap(([id, value]) =>
        isRecord(value) ? [{ id, ...value }] : [],
      );
    return [];
  });
}

/**
 * Convert common OpenAI-compatible model responses into isolated descriptors.
 * The parser is deliberately conservative: unknown models remain visible,
 * but are never marked canvas-runnable unless their id/type implies an image
 * or video protocol. Price fields are copied into metadata for the settings
 * panel and model selector.
 */
export function scanProviderModelCatalog(
  payload: unknown,
  options: { defaultModel?: string; checkedAt?: string } = {},
): ProviderCatalogScan {
  const byId = new Map<string, ModelDescriptor>();
  const groupIds = new Map<string, string[]>();
  for (const entry of entriesFromPayload(payload)) {
    const rawId = text(
      entry.id ?? entry.model_name ?? entry.model ?? entry.name,
    );
    const id = rawId;
    if (!id) continue;
    const name = text(entry.display_name ?? entry.name) ?? id;
    const operations = operationsForModel(id, entry);
    const canvasRunnable = operations.length > 0 && !/^midjourney(?:[-_]|$)/iu.test(id);
    const facts = parseProviderModelFacts(entry);
    const prices = pricing(entry);
    const group =
      text(
        entry.group ??
          entry.model_group ??
          entry.modelGroup ??
          entry.category ??
          entry.channel,
      ) ?? "默认群组";
    const descriptor: ModelDescriptor = {
      id,
      name,
      description:
        text(entry.description) ??
        (operations.length > 0
          ? "由当前供应商 API 实时返回的模型。"
          : "由当前供应商 API 实时返回；画布协议尚未验证。"),
      operations,
      inputKinds: facts.inputKinds ?? [
        "text",
        ...(operations.some((op) => op.startsWith("image."))
          ? (["image"] as const)
          : []),
      ],
      outputKinds: facts.outputKinds ?? [
        operations.some((op) => op.startsWith("video."))
          ? "video"
          : operations.some((op) => op.startsWith("image."))
            ? "image"
            : operations.includes("music.generate") ? "audio" : "text",
      ],
      isDefault: id === options.defaultModel,
      ...(facts.limits ? { limits: facts.limits } : {}),
      metadata: {
        ...facts.metadata,
        canvasRunnable,
        ...(canvasRunnable
          ? {}
          : { canvasUnavailableReason: "尚未验证该模型的画布调用协议" }),
        ...(prices.priceLabel ? { priceLabel: prices.priceLabel } : {}),
        ...(prices.billingLabel ? { billingLabel: prices.billingLabel } : {}),
        catalogGroup: group,
      },
    };
    if (!byId.has(id)) byId.set(id, descriptor);
    const memberships = Array.isArray(entry.enable_groups)
      ? entry.enable_groups.flatMap((value) =>
          text(value) ? [text(value)!] : [],
        )
      : [group];
    for (const membership of memberships.length ? memberships : [group]) {
      const ids = groupIds.get(membership) ?? [];
      if (!ids.includes(id)) ids.push(id);
      groupIds.set(membership, ids);
    }
  }
  const models = [...byId.values()];
  const groups = [...groupIds.entries()].map(([id, modelIds]) => ({
    id,
    label: id,
    modelIds,
  }));
  return {
    models,
    groups,
    checkedAt: options.checkedAt ?? new Date().toISOString(),
  };
}
