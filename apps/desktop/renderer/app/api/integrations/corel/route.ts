import {
  COREL_OPERATIONS,
  corelBridgeAccess,
  parseCorelBridgeRequest,
  withCorelBridgeHeaders,
} from "../../../../lib/corel-bridge";
import { createCorelDirectJob } from "../../../../lib/corel-direct";

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

export async function GET(request: Request) {
  const access = corelBridgeAccess(request);
  if (access) return withCorelBridgeHeaders(request, access);
  return responseWith(request, {
    name: "SuperCanvas Corel Direct Provider Bridge",
    version: 2,
    mode: "direct-provider",
    operations: COREL_OPERATIONS,
    implemented: ["image.generate", "image.edit"],
    localOperations: ["image.vectorize"],
    planned: ["image.remove-background", "image.upscale", "image.ocr"],
    limits: { maxPromptLength: 16_000, maxReferenceAssets: 12 },
  });
}

export async function POST(request: Request) {
  const access = corelBridgeAccess(request);
  if (access) return withCorelBridgeHeaders(request, access);
  const parsed = await parseCorelBridgeRequest(request);
  if (!parsed.success) return withCorelBridgeHeaders(request, parsed.response);
  try {
    const job = await createCorelDirectJob(parsed.data);
    const baseUrl = new URL(request.url).origin;
    return responseWith(
      request,
      {
        ...job,
        links: {
          status: `${baseUrl}/api/integrations/corel/jobs/${encodeURIComponent(String(job.jobId))}`,
        },
      },
      201,
    );
  } catch (error) {
    return responseWith(
      request,
      {
        error:
          error instanceof Error ? error.message : "Corel 直连任务创建失败",
      },
      422,
    );
  }
}
