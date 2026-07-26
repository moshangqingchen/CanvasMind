/**
 * Structural compatibility helpers for the canonical workflow contracts in
 * `@super-canvas/core`.
 *
 * The provider package deliberately keeps a provider-native request shape:
 * adapters need a connection id, an operation, and resolved file bytes/URLs.
 * Core keeps prompt parts and stable asset ids.  Keeping those two shapes
 * separate prevents an adapter from accidentally sending a database id to a
 * remote API, while these helpers make the boundary explicit and convenient
 * for the worker.
 *
 * The interfaces below are structural copies of the public core contracts;
 * this package does not import the core runtime, so it can be used by an
 * isolated worker or a provider test without creating a package cycle.
 */

import type {
  ArtifactKind,
  ModelDescriptor,
  NormalizedRequest,
  NormalizedTaskState,
  ProviderOperation,
  ProviderTask,
  RemoteArtifact,
} from "./contracts.js";

export type CorePromptPart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "asset";
      readonly assetId: string;
      readonly role: "reference" | "firstFrame" | "lastFrame";
    };

export type CoreAssetRole = "reference" | "firstFrame" | "lastFrame";

export interface CoreAssetInput {
  readonly assetId: string;
  readonly kind: ArtifactKind | "audio";
  readonly role?: CoreAssetRole;
  readonly mimeType?: string;
  readonly url?: string;
}

export interface CoreNormalizedRequest {
  readonly provider: string;
  readonly model: string;
  readonly capability: "image.generate" | "image.edit" | "video.generate";
  readonly prompt: readonly CorePromptPart[];
  readonly assets: readonly CoreAssetInput[];
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
}

export interface CoreModelDescriptor {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly capabilities: readonly (
    "image.generate" | "image.edit" | "video.generate"
  )[];
  readonly inputKinds?: readonly (
    "text" | "image" | "image[]" | "video" | "video[]" | "audio" | "audio[]"
  )[];
  readonly outputKinds?: readonly (
    "text" | "image" | "image[]" | "video" | "video[]"
  )[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CoreTask {
  readonly id: string;
  readonly status: ProviderTask["status"];
  readonly raw?: unknown;
}

export interface CoreTaskState {
  readonly status: CoreTask["status"];
  readonly progress?: number;
  readonly outputs?: readonly CoreRemoteArtifact[];
  readonly error?: { readonly message: string; readonly code?: string };
  readonly raw?: unknown;
}

export interface CoreRemoteArtifact {
  readonly kind: ArtifactKind;
  readonly url: string;
  readonly mimeType?: string;
  readonly filename?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CoreRequestConversionOptions {
  /** The provider connection selected for this run. */
  readonly connectionId: string;
  /** Override capability-to-operation inference for provider-specific modes. */
  readonly operation?: ProviderOperation;
  /** Resolve an asset id to a short-lived URL/bytes before submission. */
  readonly resolveAsset?: (
    assetId: string,
    role: CoreAssetRole,
  ) =>
    | {
        readonly url?: string;
        readonly data?: Uint8Array;
        readonly mimeType?: string;
      }
    | undefined;
  /** Render a prompt asset token; defaults to `@assetId`. */
  readonly renderAsset?: (assetId: string, role: string) => string;
}

function inferOperation(
  request: CoreNormalizedRequest,
  override: ProviderOperation | undefined,
): ProviderOperation {
  if (override) return override;
  if (
    request.capability === "image.generate" &&
    request.assets.some((asset) => asset.kind === "image")
  ) {
    return "image.edit";
  }
  if (
    request.capability === "video.generate" &&
    request.assets.some((asset) => asset.kind === "image")
  ) {
    return "video.image-to-video";
  }
  return request.capability;
}

function renderPrompt(
  parts: readonly CorePromptPart[],
  renderAsset: ((assetId: string, role: string) => string) | undefined,
): string {
  let output = "";
  for (const part of parts) {
    const chunk =
      part.type === "text"
        ? part.text
        : (renderAsset?.(part.assetId, part.role) ?? `@${part.assetId}`);
    if (chunk.length === 0) continue;
    if (output.length > 0 && !/\s$/u.test(output) && !/^\s/u.test(chunk)) {
      output += " ";
    }
    output += chunk;
  }
  return output;
}

/** Convert a core snapshot request into the resolved provider request shape. */
export function coreRequestToProviderRequest(
  request: CoreNormalizedRequest,
  options: CoreRequestConversionOptions,
): NormalizedRequest {
  const assets = request.assets.map((asset) => {
    const resolved = options.resolveAsset?.(
      asset.assetId,
      asset.role ?? "reference",
    );
    return {
      id: asset.assetId,
      kind: asset.kind,
      ...(asset.role === undefined ? {} : { role: asset.role }),
      mimeType:
        resolved?.mimeType ?? asset.mimeType ?? "application/octet-stream",
      ...(resolved?.url === undefined && asset.url === undefined
        ? {}
        : { url: resolved?.url ?? asset.url }),
      ...(resolved?.data === undefined ? {} : { data: resolved.data }),
    };
  });

  return {
    connectionId: options.connectionId,
    operation: inferOperation(request, options.operation),
    prompt: renderPrompt(request.prompt, options.renderAsset),
    idempotencyKey: request.idempotencyKey,
    model: request.model,
    assets,
    parameters: request.parameters,
    metadata: {
      provider: request.provider,
      capability: request.capability,
    },
  };
}

/** Alias with a shorter name for worker call sites. */
export const toProviderRequest = coreRequestToProviderRequest;
export const normalizeCoreRequest = coreRequestToProviderRequest;

/** Convert a provider task to the stable core task envelope. */
export function providerTaskToCoreTask(task: ProviderTask): CoreTask {
  return {
    id: task.providerTaskId,
    status: task.status,
    ...(task.result === undefined ? {} : { raw: task.result }),
  };
}

/** Convert provider outputs to core outputs, omitting byte-only artifacts. */
export function providerArtifactToCoreArtifact(
  artifact: RemoteArtifact,
): CoreRemoteArtifact | undefined {
  if (!artifact.url) return undefined;
  return {
    kind: artifact.kind,
    url: artifact.url,
    ...(artifact.mimeType === undefined ? {} : { mimeType: artifact.mimeType }),
    ...(artifact.filename === undefined ? {} : { filename: artifact.filename }),
    ...(artifact.metadata === undefined ? {} : { metadata: artifact.metadata }),
  };
}

export function providerStateToCoreState(
  state: NormalizedTaskState,
  artifacts: readonly RemoteArtifact[] = [],
): CoreTaskState {
  const outputs = artifacts
    .map(providerArtifactToCoreArtifact)
    .filter(
      (artifact): artifact is CoreRemoteArtifact => artifact !== undefined,
    );
  return {
    status: state.status,
    ...(state.progress === undefined ? {} : { progress: state.progress }),
    ...(outputs.length === 0 ? {} : { outputs }),
    ...(state.error === undefined ? {} : { error: { message: state.error } }),
    ...(state.result === undefined ? {} : { raw: state.result }),
  };
}

/** Map provider model metadata to the canonical core model descriptor. */
export function providerModelToCoreModel(
  model: ModelDescriptor,
  provider: string,
): CoreModelDescriptor {
  const capabilities = [
    ...new Set(
      model.operations.flatMap(
        (operation): CoreModelDescriptor["capabilities"][number][] => {
          if (operation === "video.image-to-video") return ["video.generate"];
          if (
            operation === "image.generate" ||
            operation === "image.edit" ||
            operation === "video.generate"
          ) {
            return [operation];
          }
          return [];
        },
      ),
    ),
  ];
  return {
    id: model.id,
    name: model.name,
    provider,
    capabilities,
    ...(model.limits === undefined
      ? {}
      : { metadata: { limits: model.limits } }),
  };
}

export type { NormalizedRequest as ProviderNormalizedRequest };
