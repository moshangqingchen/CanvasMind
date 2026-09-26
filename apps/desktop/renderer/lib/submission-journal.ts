import type { CanvasNode, CanvasNodeData } from "../components/types";

const KEY = "super-canvas:submissions:v1:";
export interface SubmissionRecord {
  requestId: string;
  createdAt: string;
  nodes: CanvasNode[];
  runId?: string;
}
export interface HiddenResult {
  requestId?: string;
  runId?: string;
  outputIndex: number;
}

export function readSubmissions(canvasId: string): SubmissionRecord[] {
  const raw = localStorage.getItem(KEY + canvasId);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (r) => !r || typeof r.requestId !== "string" || !Array.isArray(r.nodes),
    )
  )
    throw new Error(
      "本地提交记录无法读取，请保留本地资料并核对任务，暂勿重新生成",
    );
  return parsed;
}
function write(canvasId: string, records: SubmissionRecord[]) {
  // A failed durable write must abort submission, rather than risk an untraceable paid request.
  localStorage.setItem(KEY + canvasId, JSON.stringify(records));
}
export function rememberSubmission(
  canvasId: string,
  requestId: string,
  nodes: CanvasNode[],
) {
  write(canvasId, [
    ...readSubmissions(canvasId).filter((r) => r.requestId !== requestId),
    {
      requestId,
      createdAt: new Date().toISOString(),
      nodes: nodes.filter(
        (n) => n.data.generatedPendingRequestId === requestId,
      ),
    },
  ]);
}
export function linkSubmission(
  canvasId: string,
  requestId: string | undefined,
  runId: string,
) {
  if (!requestId) return;
  const records = readSubmissions(canvasId);
  if (records.some((r) => r.requestId === requestId && r.runId !== runId))
    write(
      canvasId,
      records.map((r) => (r.requestId === requestId ? { ...r, runId } : r)),
    );
}
export function forgetSubmission(canvasId: string, requestId: string) {
  write(
    canvasId,
    readSubmissions(canvasId).filter((r) => r.requestId !== requestId),
  );
}
export function hiddenResult(
  source: CanvasNodeData,
  requestId: string | undefined,
  runId: string | undefined,
  outputIndex: number,
): boolean {
  return (
    Array.isArray(source.hiddenGeneratedResults) &&
    source.hiddenGeneratedResults.some(
      (h) =>
        h &&
        h.outputIndex === outputIndex &&
        ((Boolean(requestId) && h.requestId === requestId) ||
          (Boolean(runId) && h.runId === runId)),
    )
  );
}
export function restoreSubmissions(
  canvasId: string,
  nodes: CanvasNode[],
): CanvasNode[] {
  const restored = [...nodes];
  for (const record of readSubmissions(canvasId))
    for (const pending of record.nodes) {
      const source = nodes.find(
        (n) => n.id === pending.data.generatedFromNodeId,
      );
      if (
        !source ||
        hiddenResult(
          source.data,
          record.requestId,
          record.runId,
          pending.data.generatedOutputIndex ?? 0,
        )
      )
        continue;
      if (
        restored.some(
          (n) =>
            n.id === pending.id ||
            (n.data.generatedOutputIndex ===
              pending.data.generatedOutputIndex &&
              n.data.generatedFromNodeId === source.id &&
              (n.data.generatedPendingRequestId === record.requestId ||
                (Boolean(record.runId) &&
                  n.data.generatedFromRunId === record.runId))),
        )
      )
        continue;
      restored.push({
        ...pending,
        data: {
          ...pending.data,
          generatedStatus: "needs_attention",
          generatedError: {
            code: "SUBMISSION_RESULT_UNKNOWN",
            message: "正在核对上次提交的任务。不会自动重新生成。",
          },
        },
      });
    }
  return restored.length === nodes.length ? nodes : restored;
}
export function acknowledgeSubmissions(canvasId: string, nodes: CanvasNode[]) {
  const records = readSubmissions(canvasId);
  const remaining = records.filter(
    (r) =>
      !r.runId ||
      !r.nodes.every((pending) => {
        const source = nodes.find(
          (n) => n.id === pending.data.generatedFromNodeId,
        );
        return (
          !source ||
          hiddenResult(
            source.data,
            r.requestId,
            r.runId,
            pending.data.generatedOutputIndex ?? 0,
          ) ||
          nodes.some(
            (n) =>
              n.data.generatedFromRunId === r.runId &&
              n.data.generatedFromNodeId === source.id &&
              n.data.generatedOutputIndex === pending.data.generatedOutputIndex,
          )
        );
      }),
  );
  if (remaining.length !== records.length) write(canvasId, remaining);
}
export function needsTaskReconciliation(data: CanvasNodeData) {
  return typeof data.generatedPendingRequestId === "string";
}

export function hideRemovedResults(
  nodes: CanvasNode[],
  removedIds: ReadonlySet<string>,
): CanvasNode[] {
  const results = nodes.filter(
    (node) => removedIds.has(node.id) && node.data.generatedResult === true,
  );
  return nodes.map((node) => {
    const hidden = results
      .filter((result) => result.data.generatedFromNodeId === node.id)
      .map((result) => ({
        requestId: result.data.generatedPendingRequestId,
        runId: result.data.generatedFromRunId,
        outputIndex: result.data.generatedOutputIndex ?? 0,
      }));
    return hidden.length
      ? {
          ...node,
          data: {
            ...node.data,
            hiddenGeneratedResults: [
              ...(node.data.hiddenGeneratedResults ?? []),
              ...hidden,
            ],
          },
        }
      : node;
  });
}
