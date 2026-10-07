import type { ProviderConnectionResolver, ProviderOperation, ProviderTask } from "./contracts.js";
import { ProviderHttpError } from "./http.js";
import { GenericRestAdapter, type GenericRestAdapterOptions, type RestConnectorConfig } from "./rest.js";

const MODELS = new Set(["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);

/** This supplier's GPT Images API accepts JSON URL references, never multipart edits. */
export function isSecureSkillImageConnection(config: Readonly<Record<string, unknown>> | undefined, model?: string): boolean {
  const selected = model || config?.defaultModel;
  if (typeof selected !== "string" || !MODELS.has(selected)) return false;
  try {
    const url = new URL(String(config?.baseUrl ?? ""));
    return url.protocol === "https:" && url.hostname === "token.secure-skill.com" &&
      !url.port && !url.username && !url.password && !url.search && !url.hash &&
      ["", "/", "/v1", "/v1/"].includes(url.pathname);
  } catch { return false; }
}

export function secureSkillRequiresPublicAssets(provider: string, config: Readonly<Record<string, unknown>> | undefined,
  model?: string, operation?: ProviderOperation): boolean {
  return provider === "openai" && operation === "image.edit" && isSecureSkillImageConnection(config, model);
}

// https://token.secure-skill.com/docs — GPT Image 2 / 2.5, async reference image example.
const CONNECTOR: RestConnectorConfig = {
  auth: { type: "bearer" },
  assetsRequirePublicUrls: true,
  submit: {
    path: "/v1/images/async/generations", method: "POST", bodyMode: "json", idempotent: false,
    template: { response_format: "url" },
    mappings: [
      { target: "/model", source: { kind: "request", path: "$.model" } },
      { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
      ...["size", "quality", "background", "n"].map(key => ({
        target: `/${key}`, source: { kind: "request" as const, path: `$.parameters.${key}` },
        omitIfUndefined: true, omitValues: ["auto"],
      })),
      // Case 059's native transparent generation was measured with PNG output.
      // Preserve that parameter without extending ordinary or reference requests.
      { target: "/output_format", source: { kind: "request", path: "$.parameters.output_format" },
        when: [
          { path: "$.operation", values: ["image.generate"] },
          { path: "$.model", values: ["gpt-image-2"] },
          { path: "$.parameters.background", values: ["transparent"] },
        ], omitIfUndefined: true },
      { target: "/image", source: { kind: "assets", assetKind: "image", select: "all" }, omitIfEmpty: true },
    ],
    response: { taskIdPath: "$.data.task_id", statusPath: "$.data.status", errorPath: "$.data.error.message", errorFallbackPaths: ["$.message"] },
  },
  poll: {
    path: "/v1/images/async/{taskId}", method: "GET", bodyMode: "none",
    response: { statusPath: "$.data.status", errorPath: "$.data.error.message", errorFallbackPaths: ["$.message"] },
  },
  statusMap: { PENDING: "queued", RUNNING: "running", SUCCESS: "succeeded", FAILED: "failed" },
  pollIntervalMs: 3000,
  output: { path: "$.data.result_url", fallbackPaths: ["$.data.data.data[*]"], kind: "image", urlPath: "$.url", base64Path: "$.b64_json" },
};

export function isSecureSkillImageResult(result: unknown): boolean {
  return !!result && typeof result === "object" && "secureSkillImage" in result && result.secureSkillImage === true;
}

export class SecureSkillImageAdapter extends GenericRestAdapter {
  constructor(connections: ProviderConnectionResolver, options: GenericRestAdapterOptions = {}) {
    super(connections, { ...options, config: CONNECTOR });
  }

  override async submit(request: Parameters<GenericRestAdapter["submit"]>[0]): Promise<ProviderTask> {
    const task = await super.submit(request);
    if (!task.providerTaskId.trim() || task.providerTaskId.startsWith("rest:sync:")) {
      throw new ProviderHttpError("Secure Skill did not return an image task id", {
        kind: "invalid_response", phase: "submit", retryable: false, submissionMayHaveOccurred: true,
      });
    }
    return { ...task, result: { ...(task.result as Record<string, unknown>), secureSkillImage: true } };
  }
}
