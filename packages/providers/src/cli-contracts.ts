/** Browser-safe contracts. Importing this module never starts a process. */
import type {
  ModelDescriptor, ModelParameterCondition, ModelParameterDescriptor,
  ModelParameterValue, ProviderOperation, ValidationIssue, ValidationResult,
} from "./contracts.js";

export interface CliConnectorConfig {
  version: 1;
  siteId: string;
  siteName: string;
  accountLabel?: string;
  executable: string;
  args: string[];
  cwd?: string;
  enabled: boolean;
  commandTimeoutMs: number;
  submitTimeoutMs: number;
  pollIntervalMs: number;
  taskTimeoutMs: number;
}

export interface CliConnectionStatus {
  state: "ready" | "unconfigured" | "login_required" | "error";
  checkedAt?: string;
  message?: string;
  supportsCancel?: boolean;
  configFingerprint?: string;
}

export const CLI_DEFAULTS = Object.freeze({
  commandTimeoutMs: 30_000,
  submitTimeoutMs: 60_000,
  pollIntervalMs: 10_000,
  taskTimeoutMs: 7_200_000,
});

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseCliConnectorConfig(value: unknown): CliConnectorConfig {
  if (!record(value) || value.version !== 1) throw new Error("CLI 配置版本必须是 1");
  const str = (key: string, fallback?: string): string => {
    const item = value[key] ?? fallback;
    if (typeof item !== "string" || item.includes("\0") || item.length > 32_768)
      throw new Error(`CLI 配置 ${key} 无效`);
    return item.trim();
  };
  const siteId = str("siteId");
  const siteName = str("siteName");
  if (!siteId || !siteName) throw new Error("网站标识和名称不能为空");
  if (value.enabled !== undefined && typeof value.enabled !== "boolean")
    throw new Error("CLI 启用状态无效");
  const rawArgs = value.args ?? [];
  if (!Array.isArray(rawArgs) || rawArgs.length > 128 || rawArgs.some(arg =>
    typeof arg !== "string" || arg.includes("\0") || arg.length > 32_768))
    throw new Error("CLI 固定启动参数必须是字符串数组");
  const positive = (key: keyof typeof CLI_DEFAULTS): number => {
    const candidate = value[key] ?? CLI_DEFAULTS[key];
    if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 100 || candidate > 86_400_000)
      throw new Error(`CLI 配置 ${key} 必须为 100 至 86400000 毫秒的整数`);
    return candidate;
  };
  const cwd = str("cwd", "");
  const accountLabel = str("accountLabel", "");
  return {
    version: 1, siteId, siteName, executable: str("executable", ""),
    args: [...rawArgs] as string[], enabled: value.enabled !== false,
    ...(cwd ? { cwd } : {}), ...(accountLabel ? { accountLabel } : {}),
    commandTimeoutMs: positive("commandTimeoutMs"), submitTimeoutMs: positive("submitTimeoutMs"),
    pollIntervalMs: positive("pollIntervalMs"), taskTimeoutMs: positive("taskTimeoutMs"),
  };
}

/** Stable change detector, not a security credential or authorization token. */
export function configFingerprint(config: CliConnectorConfig): string {
  const serialized = JSON.stringify(parseCliConnectorConfig(config));
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index++) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function matches(conditions: readonly ModelParameterCondition[] | undefined, parameters: Readonly<Record<string, unknown>>): boolean {
  return conditions?.every(condition => condition.values.some(value => value === parameters[condition.parameter])) ?? true;
}

export function getModelParameterDescriptor(
  model: Pick<ModelDescriptor, "parameters">, key: string, parameters: Readonly<Record<string, unknown>> = {}, operation?: ProviderOperation,
): ModelParameterDescriptor | undefined {
  const original = model.parameters?.find(parameter => parameter.key === key);
  if (!original || (operation && original.operations && !original.operations.includes(operation)) || !matches(original.visibleWhen, parameters))
    return undefined;
  let descriptor = { ...original };
  for (const constraint of original.constraints ?? []) {
    if (!matches(constraint.when, parameters)) continue;
    const { when: _when, ...patch } = constraint;
    descriptor = { ...descriptor, ...patch };
  }
  return descriptor;
}

function valueIssues(descriptor: ModelParameterDescriptor, value: unknown): ValidationIssue[] {
  const issue = (code: string, message: string): ValidationIssue[] => [{ path: `parameters.${descriptor.key}`, code, message }];
  if (value === undefined || value === null || value === "")
    return descriptor.required ? issue("required", `请填写${descriptor.label}`) : [];
  const valueType = descriptor.valueType ?? (descriptor.control === "toggle" ? "boolean" : descriptor.control === "number" ? "number" : undefined);
  if (valueType && (valueType === "integer" ? !Number.isInteger(value) : typeof value !== valueType))
    return issue("type", `${descriptor.label}类型无效`);
  if (!["string", "number", "boolean"].includes(typeof value)) return issue("type", `${descriptor.label}必须是文本、数字或开关值`);
  if (descriptor.options && !descriptor.options.some(option => option.value === value))
    return issue("option", `${descriptor.label}不支持当前值，请重新选择`);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return issue("number", `${descriptor.label}必须是有效数字`);
    if (descriptor.min !== undefined && value < descriptor.min) return issue("min", `${descriptor.label}不能小于 ${descriptor.min}`);
    if (descriptor.max !== undefined && value > descriptor.max) return issue("max", `${descriptor.label}不能大于 ${descriptor.max}`);
    if (descriptor.step !== undefined && descriptor.step > 0) {
      const offset = (value - (descriptor.min ?? 0)) / descriptor.step;
      if (Math.abs(offset - Math.round(offset)) > 1e-8) return issue("step", `${descriptor.label}必须符合步长 ${descriptor.step}`);
    }
  }
  return [];
}

/** Validation does not coerce, fill defaults or modify saved node values. */
export function validateModelParameters(
  model: Pick<ModelDescriptor, "parameters">, parameters: Readonly<Record<string, unknown>> = {}, operation?: ProviderOperation,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  for (const key of Object.keys(parameters)) {
    if (!getModelParameterDescriptor(model, key, parameters, operation))
      issues.push({ path: `parameters.${key}`, code: "unsupported", message: `参数 ${key} 不适用于当前模型或参数组合` });
  }
  for (const parameter of model.parameters ?? []) {
    const descriptor = getModelParameterDescriptor(model, parameter.key, parameters, operation);
    if (descriptor) issues.push(...valueIssues(descriptor, parameters[descriptor.key]));
  }
  return { valid: issues.length === 0, issues };
}

/** Explicit model changes only: retain legal values, drop incompatible values, apply declared defaults. */
export function resolveModelParameters(
  model: Pick<ModelDescriptor, "parameters">, values: Readonly<Record<string, unknown>> = {}, operation?: ProviderOperation,
): { parameters: Record<string, unknown>; removedKeys: string[]; issues: ValidationIssue[] } {
  const parameters = { ...values };
  const removed = new Set<string>();
  // Re-evaluate dependent fields until the small declarative graph stabilizes.
  for (let pass = 0; pass < (model.parameters?.length ?? 0) + 2; pass++) {
    const before = JSON.stringify(parameters);
    for (const key of Object.keys(parameters)) {
      const descriptor = getModelParameterDescriptor(model, key, parameters, operation);
      if (!descriptor || valueIssues(descriptor, parameters[key]).length) {
        delete parameters[key];
        if (Object.prototype.hasOwnProperty.call(values, key)) removed.add(key);
      }
    }
    for (const original of model.parameters ?? []) {
      const descriptor = getModelParameterDescriptor(model, original.key, parameters, operation);
      if (descriptor && parameters[descriptor.key] === undefined && descriptor.default !== undefined && !valueIssues(descriptor, descriptor.default).length)
        parameters[descriptor.key] = descriptor.default;
    }
    if (before === JSON.stringify(parameters)) break;
  }
  return { parameters, removedKeys: [...removed], issues: [...validateModelParameters(model, parameters, operation).issues] };
}

export type CliAction = "test" | "describe" | "submit" | "poll" | "cancel";
export interface CliBridgeRequest {
  version: 1;
  action: CliAction;
  requestId: string;
  context: { connectionId: string; jobDirectory?: string; outputDirectory?: string };
  taskId?: string;
  request?: {
    operation: ProviderOperation;
    model: string;
    prompt: string;
    parameters: Readonly<Record<string, unknown>>;
    idempotencyKey: string;
    assets: readonly { id: string; kind: "image" | "video" | "audio"; mimeType: string; path: string; role?: "reference" | "firstFrame" | "lastFrame" }[];
  };
}

export type CliBridgeResponse =
  | { version: 1; ok: true; data: Record<string, unknown> }
  | { version: 1; ok: false; error: { code: string; message: string } };

export const CLI_SUPPORTED_OPERATIONS: readonly ProviderOperation[] = ["image.generate", "image.edit", "video.generate", "video.image-to-video"];

const isValue = (value: unknown): value is ModelParameterValue =>
  typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));

/** Reject executable or malformed parameter metadata before sharing a catalog with the UI. */
export function parseCliModelCatalog(value: unknown): ModelDescriptor[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error("CLI 模型目录必须是最多 500 项的数组");
  const ids = new Set<string>();
  const parseConditions = (conditions: unknown): void => {
    if (!Array.isArray(conditions) || conditions.some(condition => !record(condition) || typeof condition.parameter !== "string" || !Array.isArray(condition.values) || !condition.values.length || !condition.values.every(isValue)))
      throw new Error("CLI 参数联动条件无效");
  };
  const parseOptions = (options: unknown): void => {
    if (!Array.isArray(options) || options.some(option => !record(option) || typeof option.label !== "string" || !isValue(option.value)))
      throw new Error("CLI 参数选项无效");
  };
  return value.map(entry => {
    if (!record(entry) || typeof entry.id !== "string" || !entry.id.trim() || ids.has(entry.id) || typeof entry.name !== "string" || !entry.name.trim() || !Array.isArray(entry.operations) || !entry.operations.length || entry.operations.some(operation => !CLI_SUPPORTED_OPERATIONS.includes(operation)))
      throw new Error("CLI 模型标识、名称或生成能力无效");
    ids.add(entry.id);
    if (entry.description !== undefined && typeof entry.description !== "string") throw new Error("CLI 模型说明必须是文本");
    if (entry.isDefault !== undefined && typeof entry.isDefault !== "boolean") throw new Error("CLI 默认模型标记无效");
    const inputKinds = ["text", "image", "image[]", "video", "video[]", "audio", "audio[]"];
    const outputKinds = ["text", "image", "image[]", "video", "video[]"];
    for (const [field, allowed] of [["inputKinds", inputKinds], ["outputKinds", outputKinds]] as const) {
      if (entry[field] !== undefined && (!Array.isArray(entry[field]) || entry[field].some((kind: unknown) => typeof kind !== "string" || !allowed.includes(kind)))) throw new Error(`CLI 模型 ${field} 无效`);
    }
    if (entry.metadata !== undefined) {
      if (!record(entry.metadata)) throw new Error("CLI 模型 metadata 必须是对象");
      const roles = entry.metadata.inputRoles;
      if (roles !== undefined && (!Array.isArray(roles) || roles.some(role => !["reference", "firstFrame", "lastFrame"].includes(role)))) throw new Error("CLI 模型输入角色无效");
    }
    if (entry.limits !== undefined) {
      if (!record(entry.limits)) throw new Error("CLI 模型 limits 必须是对象");
      for (const [key, limit] of Object.entries(entry.limits)) {
        if (key === "supportedMimeTypes") {
          if (!Array.isArray(limit) || limit.some(type => typeof type !== "string" || !/^[\w.+-]+\/[\w.+-]+$/.test(type))) throw new Error("CLI 素材格式列表无效");
        } else if (["requiresInputImage", "requiresInputVideo"].includes(key)) {
          if (typeof limit !== "boolean") throw new Error("CLI 素材必填限制无效");
        } else if (["maxPromptCharacters", "maxInputImages", "maxInputVideos", "maxInputAudios", "maxInputAssets", "maxOutputImages", "maxInputVideoDurationSeconds", "maxTotalInputVideoDurationSeconds", "maxInputAudioDurationSeconds"].includes(key)) {
          if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0 || (key.endsWith("Seconds") ? false : !Number.isSafeInteger(limit))) throw new Error("CLI 模型数值限制必须是非负数字");
        } else throw new Error("CLI 模型 limits 包含未知字段");
      }
    }
    if (entry.parameters !== undefined) {
      if (!Array.isArray(entry.parameters) || entry.parameters.length > 100) throw new Error("CLI 模型参数过多或格式无效");
      const keys = new Set<string>();
      for (const parameter of entry.parameters) {
        if (!record(parameter) || typeof parameter.key !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(parameter.key) || keys.has(parameter.key) || typeof parameter.label !== "string" || !["select", "number", "text", "toggle", "dimensions"].includes(String(parameter.control)))
          throw new Error("CLI 模型参数描述无效");
        keys.add(parameter.key);
        for (const field of ["description", "placeholder"]) if (parameter[field] !== undefined && typeof parameter[field] !== "string") throw new Error("CLI 参数说明必须是文本");
        if (parameter.valueType !== undefined && !["string", "number", "integer", "boolean"].includes(String(parameter.valueType))) throw new Error("CLI 参数类型无效");
        if (parameter.default !== undefined && !isValue(parameter.default)) throw new Error("CLI 参数默认值无效");
        if (parameter.required !== undefined && typeof parameter.required !== "boolean") throw new Error("CLI 参数必填标记无效");
        for (const field of ["min", "max", "step"]) if (parameter[field] !== undefined && (typeof parameter[field] !== "number" || !Number.isFinite(parameter[field]))) throw new Error("CLI 参数范围无效");
        if ((typeof parameter.step === "number" && parameter.step <= 0) || (typeof parameter.min === "number" && typeof parameter.max === "number" && parameter.min > parameter.max)) throw new Error("CLI 参数范围或步长无效");
        if (parameter.options !== undefined) parseOptions(parameter.options);
        if (parameter.visibleWhen !== undefined) parseConditions(parameter.visibleWhen);
        if (parameter.operations !== undefined && (!Array.isArray(parameter.operations) || parameter.operations.some(operation => !CLI_SUPPORTED_OPERATIONS.includes(operation)))) throw new Error("CLI 参数能力无效");
        if (parameter.constraints !== undefined) {
          if (!Array.isArray(parameter.constraints)) throw new Error("CLI 参数联动约束无效");
          for (const constraint of parameter.constraints) {
            if (!record(constraint)) throw new Error("CLI 参数联动约束无效");
            parseConditions(constraint.when);
            if (constraint.options !== undefined) parseOptions(constraint.options);
            for (const field of ["min", "max"]) if (constraint[field] !== undefined && (typeof constraint[field] !== "number" || !Number.isFinite(constraint[field]))) throw new Error("CLI 联动范围无效");
            if (constraint.required !== undefined && typeof constraint.required !== "boolean") throw new Error("CLI 联动必填标记无效");
            if (Object.keys(constraint).some(key => !["when", "options", "min", "max", "required"].includes(key))) throw new Error("CLI 联动包含未知字段");
          }
        }
      }
      for (const parameter of entry.parameters) {
        const conditions = [...(parameter.visibleWhen ?? []), ...(parameter.constraints ?? []).flatMap((constraint: { when: unknown[] }) => constraint.when)];
        if (conditions.some(condition => !keys.has(condition.parameter) || condition.parameter === parameter.key)) throw new Error("CLI 参数联动引用无效");
      }
    }
    return { ...(entry as unknown as ModelDescriptor), provider: "cli", capabilities: [...entry.operations] };
  });
}
