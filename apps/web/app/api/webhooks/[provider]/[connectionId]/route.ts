import { randomUUID } from "node:crypto";
import {
  ProviderKindSchema,
  parseRouteIdentifier,
  requestBodyExceedsLimit,
  validationError,
} from "../../../../../lib/api-validation";
import { jsonError, repository, runService } from "../../../../../lib/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string; connectionId: string }> },
) {
  if (!process.env.PUBLIC_BASE_URL)
    return jsonError("Webhook 未启用；请配置 PUBLIC_BASE_URL", 404);
  if (await requestBodyExceedsLimit(request.clone(), 2 * 1024 * 1024))
    return jsonError("Webhook 请求体不能超过 2 MB", 413);
  const params = await context.params;
  const parsedProvider = ProviderKindSchema.safeParse(params.provider);
  if (!parsedProvider.success)
    return validationError(parsedProvider.error, "供应商类型无效");
  const parsedConnectionId = parseRouteIdentifier(
    params.connectionId,
    "连接 ID",
  );
  if (!parsedConnectionId.success) return parsedConnectionId.response;
  const provider = parsedProvider.data;
  const connectionId = parsedConnectionId.data;
  const connection = await repository.getConnection(connectionId);
  if (!connection || connection.provider !== provider)
    return jsonError("供应商连接不存在", 404);
  const adapter = runService.adapters().get(provider);
  if (!adapter?.verifyWebhook)
    return jsonError("当前供应商 Adapter 不支持 Webhook 验签", 501);
  try {
    const state = await adapter.verifyWebhook(request.clone(), connectionId);
    const payload = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const externalId =
      request.headers.get("x-webhook-id") ??
      request.headers.get("x-request-id") ??
      (typeof payload.id === "string"
        ? payload.id
        : `${state.providerTaskId}:${state.status}`);
    const accepted = await repository.saveWebhookEvent({
      id: randomUUID(),
      provider,
      connectionId,
      externalId,
      payload,
      createdAt: new Date().toISOString(),
    });
    if (!accepted) return Response.json({ ok: true, duplicate: true });
    const nodeRun = await repository.findNodeRunByProviderTaskId(
      state.providerTaskId,
      connectionId,
    );
    if (nodeRun && !["succeeded", "cancelled"].includes(nodeRun.status)) {
      const workflowRun = await repository.getRun(nodeRun.workflowRunId);
      if (!workflowRun) return Response.json({ ok: true, ignored: true });
      if (
        workflowRun.status === "cancelled" ||
        nodeRun.status === "cancel_requested"
      ) {
        void runService.reconcileCancellation(nodeRun.workflowRunId);
        return Response.json({ ok: true, ignored: true });
      }
      if (
        !["queued", "running", "needs_attention"].includes(
          workflowRun.status,
        ) ||
        (nodeRun.status === "archiving" && state.status !== "succeeded")
      ) {
        return Response.json({ ok: true, ignored: true });
      }

      const providerTask = JSON.parse(JSON.stringify(state)) as Record<
        string,
        unknown
      >;
      if (state.status === "cancelled") {
        const updated = await repository.updateNodeRun(
          nodeRun.id,
          {
            status: "cancelled",
            inputJson: { ...nodeRun.inputJson, providerTask },
            errorJson: { message: state.error ?? "供应商 Webhook 报告取消" },
          },
          { expectedUpdatedAt: nodeRun.updatedAt },
        );
        if (updated) {
          await repository.transitionRunStatus(
            nodeRun.workflowRunId,
            ["queued", "running", "needs_attention"],
            "cancelled",
          );
        }
      } else {
        const nextStatus =
          state.status === "succeeded" ? "archiving" : "running";
        const updated = await repository.updateNodeRun(
          nodeRun.id,
          {
            status: nextStatus,
            providerTaskId: state.providerTaskId,
            inputJson: { ...nodeRun.inputJson, providerTask },
            errorJson:
              state.status === "failed"
                ? { message: state.error ?? "供应商 Webhook 报告失败" }
                : null,
          },
          { expectedUpdatedAt: nodeRun.updatedAt },
        );
        if (updated) {
          const resumed = await repository.transitionRunStatus(
            nodeRun.workflowRunId,
            ["queued", "running", "needs_attention"],
            "running",
          );
          if (resumed) void runService.resumeRun(nodeRun.workflowRunId);
        }
      }
    }
    return Response.json({ ok: true });
  } catch {
    return jsonError("Webhook 验签或载荷处理失败", 401);
  }
}
