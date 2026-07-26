export type ProviderOperation =
  "image.generate" | "image.edit" | "video.generate" | "video.image-to-video";

export type ModelParameterValue = string | number | boolean;

export interface ModelParameterOption {
  label: string;
  value: ModelParameterValue;
}

/**
 * Declarative parameter metadata shared by built-in adapters and REST
 * connectors. The web app renders these fields without executing provider
 * supplied code, while adapters still own final request validation.
 */
export interface ModelParameterDescriptor {
  key: string;
  label: string;
  control: "select" | "number" | "text" | "toggle" | "dimensions";
  valueType?: "string" | "number" | "integer" | "boolean";
  default?: ModelParameterValue;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly ModelParameterOption[];
  operations?: readonly ProviderOperation[];
  placeholder?: string;
  description?: string;
}

export type ArtifactKind = "image" | "video";

export type ProviderTaskStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface ModelDescriptor {
  id: string;
  name: string;
  operations: readonly ProviderOperation[];
  /** Canonical-core aliases; adapters populate these when listing models. */
  provider?: string;
  capabilities?: readonly ProviderOperation[];
  inputKinds?: readonly (
    "text" | "image" | "image[]" | "video" | "video[]" | "audio" | "audio[]"
  )[];
  outputKinds?: readonly ("text" | "image" | "image[]" | "video" | "video[]")[];
  metadata?: Readonly<Record<string, unknown>>;
  parameters?: readonly ModelParameterDescriptor[];
  description?: string;
  isDefault?: boolean;
  limits?: {
    maxPromptCharacters?: number;
    maxInputImages?: number;
    maxInputVideos?: number;
    maxInputAudios?: number;
    maxInputAssets?: number;
    maxInputVideoDurationSeconds?: number;
    maxTotalInputVideoDurationSeconds?: number;
    maxInputAudioDurationSeconds?: number;
    requiresInputImage?: boolean;
    requiresInputVideo?: boolean;
    supportedMimeTypes?: readonly string[];
  };
}

/**
 * A resolved asset handed to an adapter by the worker. Adapters never receive a
 * database asset id without one of `url` or `data` also being available.
 */
export interface ProviderAssetInput {
  id: string;
  kind: ArtifactKind | "audio";
  mimeType: string;
  role?: "reference" | "firstFrame" | "lastFrame";
  filename?: string;
  url?: string;
  data?: Uint8Array;
}

export interface NormalizedRequest {
  connectionId: string;
  operation: ProviderOperation;
  prompt: string;
  idempotencyKey: string;
  model?: string;
  assets?: readonly ProviderAssetInput[];
  parameters?: Readonly<Record<string, unknown>>;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: readonly ValidationIssue[];
}

export interface ProviderTask {
  providerTaskId: string;
  /** Stable-core alias. Adapters always populate both fields on new tasks. */
  id?: string;
  status: ProviderTaskStatus;
  /** Provider-recommended delay before the next status query. */
  pollAfterMs?: number;
  /** Provider response retained for polling and/or output extraction. */
  result?: unknown;
  error?: string;
}

export interface NormalizedTaskState extends ProviderTask {
  progress?: number;
}

/** Read a task id from either the provider-native or canonical field. */
export function getProviderTaskId(task: {
  readonly providerTaskId?: string;
  readonly id?: string;
}): string {
  const id = task.providerTaskId || task.id;
  if (!id) throw new Error("Provider task is missing an id");
  return id;
}

/**
 * A provider-owned output. The worker must archive it before publishing it as
 * a canvas asset. Exactly one of `url` or `data` should be present.
 */
export interface RemoteArtifact {
  kind: ArtifactKind;
  url?: string;
  data?: Uint8Array;
  mimeType?: string;
  filename?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ProviderAdapter {
  testConnection(connectionId: string): Promise<void>;
  listModels(connectionId: string): Promise<ModelDescriptor[]>;
  validate(request: NormalizedRequest): Promise<ValidationResult>;
  submit(request: NormalizedRequest): Promise<ProviderTask>;
  poll?(task: ProviderTask): Promise<NormalizedTaskState>;
  cancel?(task: ProviderTask): Promise<void>;
  verifyWebhook?(
    request: Request,
    connectionId?: string,
  ): Promise<NormalizedTaskState>;
  extractOutputs(result: unknown): Promise<RemoteArtifact[]>;
}

export type ProviderName = "openai" | "runway" | "rest" | "fake";

export interface ResolvedProviderConnection {
  id: string;
  provider: ProviderName | (string & {});
  apiKey?: string;
  baseUrl?: string;
  headers?: Readonly<Record<string, string>>;
  settings?: Readonly<Record<string, unknown>>;
}

export interface ProviderConnectionResolver {
  resolve(connectionId: string): Promise<ResolvedProviderConnection>;
}

export function withCanonicalModelFields(
  model: ModelDescriptor,
  provider: string,
): ModelDescriptor {
  return {
    ...model,
    provider: model.provider ?? provider,
    capabilities: model.capabilities ?? model.operations,
  };
}

export type FetchImplementation = typeof fetch;

export const validResult = (): ValidationResult => ({
  valid: true,
  issues: [],
});

export const invalidResult = (
  ...issues: readonly ValidationIssue[]
): ValidationResult => ({ valid: false, issues });

export function assertValidResult(result: ValidationResult): void {
  if (!result.valid) {
    const detail = result.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Provider request is invalid: ${detail}`);
  }
}
