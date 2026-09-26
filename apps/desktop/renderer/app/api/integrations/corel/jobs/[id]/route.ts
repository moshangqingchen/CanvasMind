import {
  corelBridgeAccess,
  withCorelBridgeHeaders,
} from "../../../../../../lib/corel-bridge";
import {
  cancelCorelDirectJob,
  getCorelDirectJob,
} from "../../../../../../lib/corel-direct";

function responseWith(request: Request, body: unknown, status = 200): Response {
  return withCorelBridgeHeaders(
    request,
    Response.json(body, { status, headers: { "cache-control": "no-store" } }),
  );
}

export function OPTIONS(request: Request) {
  const access = corelBridgeAccess(request);
  if (access) return withCorelBridgeHeaders(request, access);
  return withCorelBridgeHeaders(request, new Response(null, { status: 204 }));
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = corelBridgeAccess(request);
  if (access) return withCorelBridgeHeaders(request, access);
  const { id } = await context.params;
  const job = await getCorelDirectJob(id);
  return job
    ? responseWith(request, job)
    : responseWith(request, { error: "Corel 直连任务不存在" }, 404);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = corelBridgeAccess(request);
  if (access) return withCorelBridgeHeaders(request, access);
  const { id } = await context.params;
  const job = await cancelCorelDirectJob(id);
  return job
    ? responseWith(request, job)
    : responseWith(request, { error: "Corel 直连任务不存在" }, 404);
}
