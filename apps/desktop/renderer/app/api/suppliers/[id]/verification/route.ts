import { z } from "zod";
import { parseJsonRequest, parseRouteIdentifier } from "../../../../../lib/api-validation";
import { repository, jsonError } from "../../../../../lib/server";
import { getSupplierVerificationService } from "../../../../../lib/supplier-verification";
import { publicVerification } from "../../../../../lib/supplier-verification-service";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = parseRouteIdentifier((await context.params).id, "供应商 ID");
  if (!id.success) return id.response;
  const record = await repository.getSupplierVerification(id.data);
  const body = new URL(request.url).searchParams.get("summary") === "1"
    ? { revision: record?.revision ?? 0 }
    : publicVerification(record);
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = parseRouteIdentifier((await context.params).id, "供应商 ID");
  if (!id.success) return id.response;
  const input = await parseJsonRequest(request, z.object({ action: z.enum(["plan", "preview", "pause", "resume", "reconcile", "cancel", "new-round", "retest", "run-case"]).default("plan"), caseId: z.string().max(128).optional() }));
  if (!input.success) return input.response;
  if (!await repository.getSupplier(id.data)) return jsonError("供应商不存在", 404);
  try {
    const service = getSupplierVerificationService();
    if (input.data.action === "run-case") {
      const record = await service.runQueuedCase(id.data, input.data.caseId ?? "", false);
      return Response.json(publicVerification(record), { status: 202 });
    }
    const result = input.data.action === "retest" ? await service.retest(id.data, input.data.caseId ?? "") : ["plan", "preview"].includes(input.data.action) ? await service.plan(id.data, input.data.action === "preview") : await service.action(id.data, input.data.action as "pause" | "resume" | "reconcile" | "cancel" | "new-round");
    if (input.data.action === "plan") void service.kick().catch(() => console.error("[supplier-verification] 核验队列已暂停"));
    return Response.json(publicVerification(result));
  } catch (error) { return jsonError(error instanceof Error ? error.message : "核验操作失败，请刷新后重试", 409); }
}
