import { existsSync } from "node:fs";
import { join } from "node:path";
import { WorkflowGraphSchema, selectRunNodeIds } from "@super-canvas/core";
import {
  CreateRunRequestSchema,
  RunsQuerySchema,
  parseJsonRequest,
  searchParamsToObject,
  validationError,
} from "../../../lib/api-validation";
import { scanCyberAfeiConnection } from "../../../lib/cyberafei-server";
import { CHENTU_PRESET_ID } from "../../../lib/chentu-presets";
import { scanChentuConnection } from "../../../lib/chentu-server";
import { FRIMODEL_PRESET_ID } from "../../../lib/frimodel-presets";
import { scanFriModelConnection } from "../../../lib/frimodel-server";
import { scanMikotoConnection } from "../../../lib/mikoto-server";
import { MIAOWU_PRESET_ID } from "../../../lib/miaowu-presets";
import { scanMiaowuConnection } from "../../../lib/miaowu-server";
import {
  jsonError,
  publicRunSnapshot,
  repository,
  runService,
} from "../../../lib/server";

function deploymentDrainActive(): boolean {
  const localAppData = process.env.LOCALAPPDATA;
  return Boolean(
    localAppData &&
    existsSync(join(localAppData, "SuperCanvas", "logs", "web-3210-draining")),
  );
}

async function cyberAfeiRunPreflight(input: {
  canvasId: string;
  clientRequestId: string;
  scope: "node" | "downstream" | "selection" | "all";
  nodeId?: string;
  nodeIds?: readonly string[];
}): Promise<{ message: string; status: number } | null> {
  const repositoryMethods = repository as unknown as Record<string, unknown>;
  if (
    typeof repositoryMethods.getRunByClientRequest !== "function" ||
    typeof repositoryMethods.getCanvas !== "function" ||
    typeof repositoryMethods.getConnection !== "function"
  )
    return null;
  // A retry for an already-created idempotent run must return that run even if
  // the provider catalog changes while it is executing.
  if (
    await repository.getRunByClientRequest(
      input.canvasId,
      input.clientRequestId,
    )
  )
    return null;
  const canvas = await repository.getCanvas(input.canvasId);
  if (!canvas) return null;
  const parsed = WorkflowGraphSchema.safeParse(canvas.graph);
  if (!parsed.success) return null;
  let selectedIds: readonly string[];
  try {
    selectedIds = selectRunNodeIds(
      parsed.data,
      input.scope,
      input.nodeId,
      input.nodeIds,
    );
  } catch {
    return null;
  }
  const selected = new Set(selectedIds);
  const cyberScans = new Map<
    string,
    ReturnType<typeof scanCyberAfeiConnection>
  >();
  const chentuScans = new Map<string, ReturnType<typeof scanChentuConnection>>();
  const keyScans = new Map<
    string,
    Promise<{
      status: string;
      error?: string;
      modelIds: string[];
      supplierLabel: string;
    }>
  >();
  for (const node of parsed.data.nodes) {
    if (!selected.has(node.id)) continue;
    const data = node.data ?? {};
    const connectionId =
      typeof data.connectionId === "string" ? data.connectionId : "";
    if (!connectionId || connectionId === "fake-default") continue;
    const connection = await repository.getConnection(connectionId);
    if (!connection) continue;
    const model = typeof data.model === "string" ? data.model.trim() : "";
    const preset = connection.config.preset;

    if (preset === "cyberafei-api") {
      let pending = cyberScans.get(connectionId);
      if (!pending) {
        pending = scanCyberAfeiConnection(connectionId);
        cyberScans.set(connectionId, pending);
      }
      const scan = await pending;
      if (scan.status !== "live" && scan.status !== "empty")
        return {
          message: `${scan.error ?? "赛博阿飞模型扫描失败"}；本次付费提交已停止`,
          status: scan.status === "unauthorized" ? 401 : 503,
        };
      const scannedModel = model
        ? scan.marketplaceGroup?.models.find(
            (candidate) => candidate.id === model,
          )
        : undefined;
      if (model && scannedModel?.canvasRunnable === false)
        return {
          message: `${scannedModel.canvasUnavailableReason ?? `模型 ${model} 当前不可用于画布`}；本次付费提交已停止`,
          status: 422,
        };
      const firstUnavailableReason = scan.marketplaceGroup?.models.find(
        (candidate) => candidate.canvasUnavailableReason,
      )?.canvasUnavailableReason;
      if (scan.canvasModels.length === 0)
        return {
          message: firstUnavailableReason
            ? `${firstUnavailableReason}；本次付费提交已停止`
            : "当前赛博阿飞分组 Key 未扫描到可运行模型；本次付费提交已停止",
          status: 422,
        };
      if (
        model &&
        !scan.canvasModels.some((candidate) => candidate.id === model)
      )
        return {
          message: `模型 ${model} 不在当前赛博阿飞分组 Key 的最新扫描结果中；本次付费提交已停止`,
          status: 422,
        };
      continue;
    }

    if (preset === CHENTU_PRESET_ID) {
      let pending = chentuScans.get(connectionId);
      if (!pending) {
        pending = scanChentuConnection(connectionId);
        chentuScans.set(connectionId, pending);
      }
      const scan = await pending;
      if (scan.status !== "live" && scan.status !== "empty")
        return {
          message: `${scan.error ?? "辰途模型扫描失败"}；本次付费提交已停止`,
          status: scan.status === "unauthorized" ? 401 : 503,
        };
      if (scan.canvasModels.length === 0)
        return {
          message:
            "当前辰途分组 Key 未扫描到可运行模型；本次付费提交已停止",
          status: 422,
        };
      if (
        model &&
        !scan.canvasModels.some((candidate) => candidate.id === model)
      )
        return {
          message: `模型 ${model} 不在当前辰途分组 Key 的最新扫描结果中；本次付费提交已停止`,
          status: 422,
        };
      continue;
    }

    // MikotoPro / 喵呜 / FriModel：Key 的免费 /v1/models 扫描是可调用性的
    // 唯一真相；被移出分组、分组停用或下架的模型在请求发出前停止，避免错误扣费。
    const keyScanFor =
      preset === MIAOWU_PRESET_ID
        ? () =>
            scanMiaowuConnection(connectionId).then((scan) => ({
              ...scan,
              supplierLabel: "喵呜",
            }))
        : preset === "mikoto-pro"
          ? () =>
              scanMikotoConnection(connectionId).then((scan) => ({
                ...scan,
                supplierLabel: "MikotoPro",
              }))
          : preset === FRIMODEL_PRESET_ID
            ? () =>
                scanFriModelConnection(connectionId).then((scan) => ({
                  ...scan,
                  supplierLabel: "FriModel",
                }))
            : null;
    if (!keyScanFor) continue;
    let pending = keyScans.get(connectionId);
    if (!pending) {
      pending = keyScanFor();
      keyScans.set(connectionId, pending);
    }
    const scan = await pending;
    if (scan.status === "unauthorized")
      return {
        message: `${scan.error ?? `${scan.supplierLabel} 拒绝了当前 API Key`}；本次付费提交已停止`,
        status: 401,
      };
    if (scan.status !== "live" && scan.status !== "empty")
      return {
        message: `${scan.error ?? `${scan.supplierLabel} 模型扫描失败`}；本次付费提交已停止`,
        status: 503,
      };
    if (model && !scan.modelIds.includes(model))
      return {
        message: `模型 ${model} 不在当前 ${scan.supplierLabel} Key 的最新扫描结果中（可能已下架或无权限）；本次付费提交已停止`,
        status: 422,
      };
  }
  return null;
}

export async function GET(request: Request) {
  const query = RunsQuerySchema.safeParse(
    searchParamsToObject(new URL(request.url).searchParams),
  );
  if (!query.success) return validationError(query.error, "查询参数无效");

  const splitIdentifiers = (value: string | undefined): string[] =>
    value
      ? [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))]
          .filter((item) => item.length <= 128)
          .slice(0, 50)
      : [];
  const runIds = splitIdentifiers(query.data.runIds);
  const clientRequestIds = splitIdentifiers(query.data.clientRequestIds);
  const targeted = runIds.length > 0 || clientRequestIds.length > 0;
  const runs = targeted
    ? (
        await Promise.all([
          ...runIds.map((id) => runService.repository.getRun(id)),
          ...(query.data.canvasId
            ? clientRequestIds.map((id) =>
                runService.repository.getRunByClientRequest(
                  query.data.canvasId!,
                  id,
                ),
              )
            : []),
        ])
      ).filter(
        (run): run is NonNullable<typeof run> =>
          run !== null &&
          (!query.data.canvasId || run.canvasId === query.data.canvasId),
      )
    : await runService.repository.listRuns(query.data.canvasId);
  const uniqueRuns = [...new Map(runs.map((run) => [run.id, run])).values()];
  const snapshots = await Promise.all(
    uniqueRuns.map(async (run) =>
      publicRunSnapshot({
        run,
        nodes: await runService.repository.listNodeRuns(run.id),
      }),
    ),
  );
  return Response.json(snapshots.filter((snapshot) => snapshot !== null));
}

export async function POST(request: Request) {
  if (deploymentDrainActive()) {
    return Response.json(
      { error: "服务正在切换稳定版本，请稍后再提交生成任务" },
      { status: 503, headers: { "retry-after": "5" } },
    );
  }
  const parsed = await parseJsonRequest(request, CreateRunRequestSchema);
  if (!parsed.success) return parsed.response;

  const preflight = await cyberAfeiRunPreflight(parsed.data);
  if (preflight) return jsonError(preflight.message, preflight.status);

  try {
    // The runtime freezes the selected connection and model for this run.
    // Unrelated suppliers must never add network latency to paid submission.
    const run = await runService.createRun(parsed.data);
    return Response.json(publicRunSnapshot(await runService.getRun(run.id)), {
      status: 201,
    });
  } catch {
    // createRun persists the idempotency record before queueing. If queueing or
    // response assembly fails afterwards, returning a generic 4xx would make
    // the browser create a second paid run with a new request id.
    try {
      const persisted = await runService.repository.getRunByClientRequest(
        parsed.data.canvasId,
        parsed.data.clientRequestId,
      );
      if (persisted) {
        const snapshot = publicRunSnapshot(
          await runService.getRun(persisted.id),
        );
        if (snapshot) {
          return Response.json(snapshot, {
            status: 202,
            headers: {
              "retry-after": "2",
              "x-super-canvas-run-recovered": "true",
            },
          });
        }
      }
    } catch {
      // Fall through to the non-persisted validation response below.
    }
    return jsonError("无法创建运行，请检查画布、节点和输入配置", 422);
  }
}
