import type { DirectorAdapterResult } from "@super-canvas/director";

export interface ModelCallMetric {
  kind: "model_call";
  purpose: "agent" | "vision" | "repair" | "director";
  connectionId: string;
  modelId: string;
  startedAt: string;
  durationMs: number;
  status: "completed" | "failed" | "cancelled";
  inputCharacters: number;
  attachmentCount: number;
  usage?: DirectorAdapterResult["usage"];
}

/** Record only usage reported by the adapter, never an estimated bill. */
export async function measuredModelCall<T extends DirectorAdapterResult>(
  details: Pick<ModelCallMetric, "purpose" | "connectionId" | "modelId" | "inputCharacters" | "attachmentCount">,
  call: () => Promise<T>,
  record: (metric: ModelCallMetric) => Promise<void>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const started = Date.now();
  let result: T | undefined;
  let status: ModelCallMetric["status"] = "failed";
  try {
    result = await call();
    status = signal?.aborted ? "cancelled" : "completed";
    return result;
  } finally {
    await record({
      kind: "model_call", ...details, startedAt: new Date(started).toISOString(),
      durationMs: Math.max(0, Date.now() - started),
      status: signal?.aborted ? "cancelled" : status,
      ...(result?.usage ? { usage: result.usage } : {}),
    });
  }
}
