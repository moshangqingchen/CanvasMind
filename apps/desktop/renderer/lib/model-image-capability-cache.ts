import type { ModelDescriptor, ProviderOperation } from "@super-canvas/providers";
import type { ImageEditingCapabilities, ImageEditingConnection } from "@super-canvas/providers/image-editing-capabilities";
import { modelImageCapabilities } from "./model-image-capabilities";

function primitiveParameterKey(parameters?: Readonly<Record<string, unknown>>): string | undefined {
  if (!parameters) return "[]";
  const prototype = Object.getPrototypeOf(parameters);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Reflect.ownKeys(parameters);
  if (keys.some(key => typeof key !== "string")) return undefined;
  const values: Array<readonly [string, string, string?]> = [];
  for (const key of (keys as string[]).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(parameters, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) return undefined;
    const value: unknown = descriptor.value;
    if (value === null) { values.push([key, "null"]); continue; }
    switch (typeof value) {
      case "undefined": values.push([key, "undefined"]); break;
      case "string": values.push([key, "string", value]); break;
      case "boolean": values.push([key, "boolean", String(value)]); break;
      case "number": values.push([key, "number", Object.is(value, -0) ? "-0" : String(value)]); break;
      default: return undefined;
    }
  }
  return JSON.stringify(values);
}

/** One canvas presentation pass only: never retain results across evidence refreshes. */
export function createModelImageCapabilityCache(compute = modelImageCapabilities) {
  const connections = new Map<ImageEditingConnection | null | undefined, WeakMap<ModelDescriptor, {
    primitives: Map<string, Map<ProviderOperation, ImageEditingCapabilities>>;
    parameters: WeakMap<Readonly<Record<string, unknown>>, Map<ProviderOperation, ImageEditingCapabilities>>;
  }>>();
  return (connection: ImageEditingConnection | null | undefined, model: ModelDescriptor,
    parameters?: Readonly<Record<string, unknown>>, operation: ProviderOperation = "image.generate") => {
    let models = connections.get(connection);
    if (!models) { models = new WeakMap(); connections.set(connection, models); }
    let entry = models.get(model);
    if (!entry) { entry = { primitives: new Map(), parameters: new WeakMap() }; models.set(model, entry); }
    const primitiveKey = primitiveParameterKey(parameters);
    let results: Map<ProviderOperation, ImageEditingCapabilities>;
    if (primitiveKey !== undefined) {
      const existing = entry.primitives.get(primitiveKey);
      results = existing ?? new Map();
      if (!existing) entry.primitives.set(primitiveKey, results);
    } else {
      // An omitted object always has a primitive key; only actual objects
      // reach this identity fallback, without traversing nested/accessor data.
      const existing = entry.parameters.get(parameters!);
      results = existing ?? new Map();
      if (!existing) entry.parameters.set(parameters!, results);
    }
    const cached = results.get(operation);
    if (cached) return cached;
    const result = compute(connection, model, parameters, operation);
    results.set(operation, result);
    return result;
  };
}
