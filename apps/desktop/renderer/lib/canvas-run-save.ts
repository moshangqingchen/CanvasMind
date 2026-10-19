import { runFingerprint, type RunFingerprintScope, type WorkflowGraph } from "@super-canvas/core";

export const canvasChangedBeforeRunMessage =
  "提交前画布已修改（模型或参数有变化），本次未提交、未产生费用，请确认后重新运行";

/** Provisional UI results belong to the submission journal until the server accepts them. */
export function isUnacceptedRunResult(node: { data?: Record<string, unknown> }): boolean {
  const data = node.data;
  return data?.generatedResult === true && typeof data.generatedPendingRequestId === "string" &&
    typeof data.generatedFromRunId !== "string" && typeof data.assetId !== "string" &&
    (data.generatedStatus === "queued" || data.generatedStatus === "submitting");
}

/** Compare the actual save result, including when a later queued save replaced it. */
export async function saveCanvasForRun(
  save: () => Promise<{ revision: number; graph: unknown } | undefined>,
  selection: RunFingerprintScope,
  fingerprint: string,
): Promise<number> {
  const saved = await save();
  let matches = false;
  try { matches = saved !== undefined && runFingerprint(saved.graph as WorkflowGraph, selection) === fingerprint; }
  catch { /* A malformed or changed saved graph cannot authorize a paid run. */ }
  if (!saved || !matches) throw new Error(canvasChangedBeforeRunMessage);
  return saved.revision;
}
