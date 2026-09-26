import type { ModelDescriptor, ModelParameterDescriptor, ProviderTaskStatus } from "./contracts.js";
import type { RestAuthConfig, RestConnectorConfig, RestOutputMapping, RestRequestMapping } from "./rest.js";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const strings = (value: unknown): string[] => (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string").slice(0, 32);
const fieldName = /^[a-zA-Z_][a-zA-Z0-9_]*$/u;

/** Retain descriptive, bounded evidence, never provider-supplied executable config. */
export function modelInterfaceEvidence(entry: ObjectValue): ObjectValue {
  const metadata = object(entry.metadata);
  const endpointTypes = [...new Set([entry.supported_endpoint_types, entry.endpoints, entry.endpointTypes, metadata.endpointTypes]
    .flatMap(strings).filter(value => value.length <= 256))];
  const documentationUrl = entry.openapi_url ?? entry.documentationUrl ?? entry.docsUrl ?? entry.documentation_url
    ?? metadata.documentationUrl ?? metadata.docsUrl;
  return {
    ...(endpointTypes.length ? { endpointTypes } : {}),
    ...(typeof documentationUrl === "string" && documentationUrl.length <= 2048 ? { documentationUrl } : {}),
  };
}

export interface DocumentedModelInterface {
  connector: RestConnectorConfig;
  model: ModelDescriptor;
  sourceUrl: string;
}
export type InterfaceCompilation = { binding: DocumentedModelInterface; reason?: never } | { reason: string; binding?: never };

/** Only local references and unambiguous object schemas are compiled. */
function schema(document: ObjectValue, value: unknown, depth = 0): ObjectValue {
  if (depth > 12) throw new Error("接口文档的字段引用过深");
  const raw = object(value);
  if (typeof raw.$ref === "string") {
    if (!raw.$ref.startsWith("#/")) throw new Error("接口文档使用了外部字段引用");
    let resolved: unknown = document;
    for (const part of raw.$ref.slice(2).split("/")) {
      const name = part.replace(/~1/gu, "/").replace(/~0/gu, "~");
      if (["__proto__", "constructor", "prototype"].includes(name)) throw new Error("接口字段无效");
      resolved = object(resolved)[name];
    }
    if (!resolved) throw new Error("接口文档缺少引用字段");
    return schema(document, resolved, depth + 1);
  }
  if (raw.oneOf || raw.anyOf) throw new Error("接口文档包含多种未明确选择的字段格式");
  if (Array.isArray(raw.allOf)) {
    const parts = raw.allOf.map(part => schema(document, part, depth + 1));
    return { ...raw, properties: Object.assign({}, ...parts.map(part => object(part.properties)), object(raw.properties)),
      required: [...new Set([...parts.flatMap(part => strings(part.required)), ...strings(raw.required)])] };
  }
  return raw;
}

function responseSchema(document: ObjectValue, operation: ObjectValue) {
  const responses = object(operation.responses);
  const response = schema(document, responses["200"] ?? responses["201"] ?? responses["202"]);
  return { response, value: schema(document, object(object(response.content)["application/json"]).schema ?? response.schema) };
}

function leaves(document: ObjectValue, raw: unknown, prefix = "$", depth = 0): Array<{ path: string; name: string; schema: ObjectValue }> {
  if (depth > 7) return [];
  const current = schema(document, raw);
  if (current.type === "array") return leaves(document, current.items, `${prefix}[*]`, depth + 1);
  return Object.entries(object(current.properties)).slice(0, 100).flatMap(([name, value]) => {
    if (!fieldName.test(name)) return [];
    const child = schema(document, value);
    const path = `${prefix}.${name}`;
    return child.properties || child.type === "array" ? leaves(document, child, path, depth + 1) : [{ path, name, schema: child }];
  });
}

function uniqueField(document: ObjectValue, value: unknown, names: string[]) {
  const found = leaves(document, value).filter(field => names.includes(field.name));
  if (found.length > 1) throw new Error(`接口文档有多个 ${names[0]} 字段，无法确定对应关系`);
  return found[0];
}

function outputMapping(document: ObjectValue, value: unknown, kind: "image" | "video"): RestOutputMapping | undefined {
  const fields = leaves(document, value);
  const urls = fields.filter(field => ["url", "image_url", "video_url", "result_url"].includes(field.name) && field.schema.type === "string");
  const base64 = fields.filter(field => ["b64_json", "base64"].includes(field.name) && field.schema.type === "string");
  const selected = urls[0] ?? base64[0];
  if (!selected || urls.length > 1 || base64.length > 1) return undefined;
  const parent = selected.path.slice(0, selected.path.lastIndexOf("."));
  if ([...urls, ...base64].some(field => !field.path.startsWith(`${parent}.`) || field.path.slice(parent.length + 1).includes("."))) return undefined;
  return { path: parent, kind, ...(urls[0] ? { urlPath: `$.${urls[0].name}` } : {}),
    ...(base64[0] ? { base64Path: `$.${base64[0].name}`, defaultMimeType: kind === "image" ? "image/png" : "video/mp4" } : {}) };
}

function authFor(document: ObjectValue, operation: ObjectValue): RestAuthConfig {
  const security = operation.security ?? document.security;
  if (security === undefined) throw new Error("接口文档未声明鉴权方式");
  if (Array.isArray(security) && security.length === 0) return { type: "none" };
  const schemes = object(object(document.components).securitySchemes ?? document.securityDefinitions);
  for (const requirement of Array.isArray(security) ? security : []) {
    const names = Object.keys(object(requirement));
    if (names.length !== 1) continue;
    const auth = schema(document, schemes[names[0]!]);
    if (auth.type === "http" && String(auth.scheme).toLowerCase() === "bearer") return { type: "bearer" };
    if (auth.type === "apiKey" && auth.in === "header" && typeof auth.name === "string" && /^[a-zA-Z0-9-]+$/u.test(auth.name)
      && !/^(host|cookie|content-type|content-length|proxy-authorization)$/iu.test(auth.name))
      return { type: "header", headerName: auth.name };
  }
  throw new Error("接口所需鉴权方式尚不能自动配置");
}

function requestPath(document: ObjectValue, operation: ObjectValue, pathItem: ObjectValue, path: string, apiUrl: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || /[?#\\]/u.test(path)) throw new Error("接口路径无效");
  const api = new URL(apiUrl);
  const servers = operation.servers ?? pathItem.servers ?? document.servers;
  const server = Array.isArray(servers) ? object(servers[0]).url : undefined;
  let base = typeof server === "string" ? new URL(server, api.origin) : new URL(api.origin);
  if (document.swagger === "2.0") {
    base = new URL(`${api.protocol}//${typeof document.host === "string" ? document.host : api.host}${typeof document.basePath === "string" ? document.basePath : ""}`);
  }
  if (base.origin !== api.origin || base.username || base.password || base.search || base.hash || /[{}]/u.test(base.href))
    throw new Error("接口地址与当前供应商不一致，或仍有未填写变量");
  const result = `${base.pathname.replace(/\/$/u, "")}${path}`;
  if (result.split("/").some(part => part === ".." || /%2e|%2f|%5c/iu.test(part))) throw new Error("接口路径无效");
  return result;
}

const statuses: Record<string, ProviderTaskStatus> = {
  pending: "queued", queued: "queued", accepted: "queued", processing: "running", running: "running", in_progress: "running",
  success: "succeeded", succeeded: "succeeded", completed: "succeeded", complete: "succeeded", done: "succeeded",
  failed: "failed", failure: "failed", error: "failed", cancelled: "cancelled", canceled: "cancelled",
};

function bodySchema(document: ObjectValue, operation: ObjectValue) {
  const body = schema(document, operation.requestBody);
  const json = object(object(body.content)["application/json"]);
  const swaggerBody = (Array.isArray(operation.parameters) ? operation.parameters : []).map(parameter => schema(document, parameter)).find(parameter => parameter.in === "body");
  return schema(document, json.schema ?? swaggerBody?.schema);
}

function compileOperation(document: ObjectValue, model: ModelDescriptor, apiUrl: string, sourceUrl: string,
  path: string, item: ObjectValue, operation: ObjectValue): DocumentedModelInterface {
  const body = bodySchema(document, operation);
  const properties = object(body.properties);
  const required = strings(body.required);
  if (!properties.model || !properties.prompt) throw new Error("接口缺少 model 或 prompt 字段定义");
  for (const parameter of [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])]) {
    const value = schema(document, parameter);
    if (value.required && value.in !== "body") throw new Error(`接口需要额外的 ${String(value.name).slice(0, 64)} 参数`);
  }
  const mappings: RestRequestMapping[] = [];
  const parameters: ModelParameterDescriptor[] = [];
  const template: ObjectValue = {};
  for (const [name, raw] of Object.entries(properties)) {
    if (!fieldName.test(name) || ["__proto__", "constructor", "prototype"].includes(name)) throw new Error("接口字段名称无效");
    const field = schema(document, raw);
    if (["model", "prompt"].includes(name)) {
      if (field.type !== "string") throw new Error(`${name} 字段不是文本`);
      mappings.push({ target: `/${name}`, source: { kind: "request", path: `$.${name}` } });
      continue;
    }
    // Nested/asset/custom control fields need a dedicated adapter. Never send guessed values.
    if (!["size", "quality", "n", "resolution", "aspect_ratio", "duration", "seconds", "seed", "response_format", "output_format", "background"].includes(name)) {
      if (required.includes(name)) throw new Error(`接口缺少必填字段 ${name} 的画布映射`);
      continue;
    }
    const type = field.type;
    if (!["string", "integer", "number", "boolean"].includes(String(type))) {
      if (required.includes(name)) throw new Error(`接口字段 ${name} 的格式尚不支持`);
      continue;
    }
    const options = Array.isArray(field.enum) ? field.enum.filter((value): value is string | number | boolean => ["string", "number", "boolean"].includes(typeof value)).slice(0, 128) : undefined;
    const defaultValue = ["string", "number", "boolean"].includes(typeof field.default) ? field.default as string | number | boolean : name === "n" ? 1 : undefined;
    if (defaultValue !== undefined) template[name] = defaultValue;
    parameters.push({ key: name, label: name, control: options?.length ? "select" : type === "string" ? name === "size" ? "dimensions" : "text" : type === "boolean" ? "toggle" : "number",
      valueType: type as NonNullable<ModelParameterDescriptor["valueType"]>, ...(defaultValue !== undefined ? { default: defaultValue } : {}),
      ...(options?.length ? { options: options.map(value => ({ label: String(value), value })) } : {}),
      ...(typeof field.minimum === "number" ? { min: field.minimum } : {}), ...(typeof field.maximum === "number" ? { max: field.maximum } : {}),
      required: required.includes(name) });
    mappings.push({ target: `/${name}`, source: { kind: "request", path: `$.parameters.${name}` }, omitIfUndefined: true });
  }
  const kind = model.operations.some(value => value.startsWith("video.")) ? "video" : "image";
  const submitResponse = responseSchema(document, operation);
  const task = uniqueField(document, submitResponse.value, ["task_id", "taskId", "job_id", "id"]);
  let output = outputMapping(document, submitResponse.value, kind);
  const auth = authFor(document, operation);
  const submitPath = requestPath(document, operation, item, path, apiUrl);
  if (/[{}]/u.test(submitPath)) throw new Error("提交接口含未配置的路径变量");
  const connector: RestConnectorConfig = {
    auth, restrictModels: true, submit: { path: submitPath, method: "POST", bodyMode: "json", template, mappings, idempotent: false },
    output: output ?? { path: "$.data", kind },
  };
  if (task) {
    if (task.path.includes("[*]") || !["string", "number", "integer"].includes(String(task.schema.type)))
      throw new Error("任务编号不是单个文本或数字字段");
    const links = Object.values(object(submitResponse.response.links)).map(value => schema(document, value));
    const polls = Object.entries(object(document.paths)).flatMap(([pollPath, raw]) => {
      const pollItem = object(raw), poll = object(pollItem.get);
      if (!Object.keys(poll).length || !/\{[^{}]+\}/u.test(pollPath)) return [];
      const variable = /\{([^{}]+)\}/u.exec(pollPath)?.[1];
      const linked = links.some(link => link.operationId === poll.operationId && typeof poll.operationId === "string"
        && object(link.parameters)[variable!] === `$response.body#/${task.path.slice(2).replace(/\./gu, "/")}`);
      const sibling = pollPath.replace(/\/\{[^{}]+\}$/u, "") === path.replace(/\/(?:generations|generate|submit)$/u, "") && variable === task.name;
      return linked || sibling ? [{ pollPath, pollItem, poll }] : [];
    });
    if (polls.length !== 1) throw new Error("异步接口缺少唯一的任务查询地址及任务编号对应关系");
    const { pollPath, pollItem, poll } = polls[0]!;
    const pollResponse = responseSchema(document, poll).value;
    const status = uniqueField(document, pollResponse, ["status", "state"]);
    output = outputMapping(document, pollResponse, kind);
    if (!status || !output) throw new Error("任务查询接口缺少状态或结果图片/视频字段");
    const enumStatuses = strings(status.schema.enum);
    if (!enumStatuses.length || !enumStatuses.some(value => statuses[value.toLowerCase()] === "succeeded")
      || enumStatuses.some(value => !statuses[value.toLowerCase()])) throw new Error("任务状态枚举不完整，无法自动判断是否完成");
    if (JSON.stringify(authFor(document, poll)) !== JSON.stringify(auth)) throw new Error("提交与查询接口使用不同鉴权方式");
    const resolvedPoll = requestPath(document, poll, pollItem, pollPath, apiUrl).replace(/\{[^{}]+\}/u, "{taskId}");
    if ((resolvedPoll.match(/\{/gu) ?? []).length !== 1) throw new Error("查询接口含额外的路径变量");
    const variable = /\{([^{}]+)\}/u.exec(pollPath)?.[1];
    for (const raw of [...(Array.isArray(pollItem.parameters) ? pollItem.parameters : []), ...(Array.isArray(poll.parameters) ? poll.parameters : [])]) {
      const parameter = schema(document, raw);
      if (parameter.required && !(parameter.in === "path" && parameter.name === variable)) throw new Error("任务查询接口含额外必填参数");
    }
    connector.submit.response = { taskIdPath: task.path };
    connector.poll = { path: resolvedPoll, method: "GET", bodyMode: "none", response: { statusPath: status.path,
      ...(uniqueField(document, pollResponse, ["error", "error_message"]) ? { errorPath: uniqueField(document, pollResponse, ["error", "error_message"])!.path } : {}) } };
    connector.output = output;
    connector.statusMap = Object.fromEntries(enumStatuses.map(value => [value, statuses[value.toLowerCase()]!]));
    connector.pollIntervalMs = 3000;
  } else if (!output) throw new Error("接口缺少可识别的图片/视频结果字段");
  const metadata = { ...model.metadata, canvasRunnable: true, autoInterfaceStatus: "connected", protocol: "documented-rest", documentationUrl: sourceUrl,
    autoInterfacePath: submitPath, autoInterfaceLabel: connector.poll ? "已自动接入异步接口" : "已自动接入接口" };
  delete (metadata as ObjectValue).canvasUnavailableReason;
  const bound: ModelDescriptor = { ...model, operations: [kind === "image" ? "image.generate" : "video.generate"], inputKinds: ["text"], outputKinds: [kind],
    parameters, limits: { ...model.limits, maxInputImages: 0, maxInputVideos: 0, maxInputAudios: 0 }, metadata };
  connector.models = [bound];
  return { connector, model: bound, sourceUrl };
}

/** Compile only an explicitly linked path or a schema naming this exact model. */
export function compileDocumentedInterface(documentValue: unknown, model: ModelDescriptor, apiUrl: string, sourceUrl: string): InterfaceCompilation | undefined {
  const document = object(documentValue);
  if (!String(document.openapi ?? document.swagger ?? "").match(/^[23]\./u)) return undefined;
  const candidates: Array<{ path: string; item: ObjectValue; operation: ObjectValue }> = [];
  const endpoints = strings(model.metadata?.endpointTypes);
  for (const [path, raw] of Object.entries(object(document.paths)).slice(0, 1000)) {
    const item = object(raw), operation = object(item.post);
    if (!Object.keys(operation).length) continue;
    try {
      const body = bodySchema(document, operation);
      if (/\/(?:edits?|image-to-video)\/?$/iu.test(path) || strings(body.required).some(name => ["image", "images", "input_image", "video", "mask"].includes(name))) continue;
      const properties = object(body.properties);
      const namedModels = [...strings(schema(document, properties.model).enum), ...strings(operation["x-models"])];
      const declaredPath = !namedModels.length && endpoints.some(endpoint => endpoint === path || endpoint === requestPath(document, operation, item, path, apiUrl));
      if (namedModels.length ? !namedModels.includes(model.id) : !declaredPath) continue;
      candidates.push({ path, item, operation });
    } catch { /* An unrelated or unresolved schema does not authorize a call. */ }
  }
  if (!candidates.length) return undefined;
  if (candidates.length > 1) return { reason: "文档为此模型提供了多个提交接口，尚无法唯一匹配" };
  const candidate = candidates[0]!;
  try { return { binding: compileOperation(document, model, apiUrl, sourceUrl, candidate.path, candidate.item, candidate.operation) }; }
  catch (error) { return { reason: error instanceof Error ? error.message : "接口文档不完整" }; }
}
