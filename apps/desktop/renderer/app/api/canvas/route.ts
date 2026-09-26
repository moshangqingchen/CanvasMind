import {
  CreateCanvasRequestSchema,
  graphValidationError,
  parseJsonRequest,
  validateCanvasGraphSemantics,
} from "../../../lib/api-validation";
import { jsonError, repository, safeJsonObject } from "../../../lib/server";

export async function GET() {
  const canvas = await repository.ensureDefaultCanvas();
  return Response.json(canvas);
}

export async function POST(request: Request) {
  const parsed = await parseJsonRequest(request, CreateCanvasRequestSchema);
  if (!parsed.success) return parsed.response;

  const graphIssues = validateCanvasGraphSemantics(parsed.data.graph);
  if (graphIssues.length > 0) return graphValidationError(graphIssues);

  try {
    const canvas = await repository.saveCanvas({
      id: parsed.data.id ?? crypto.randomUUID(),
      title: parsed.data.title,
      graph: safeJsonObject(parsed.data.graph),
      reason: "manual",
    });
    return Response.json(canvas, { status: 201 });
  } catch {
    return jsonError("画布创建失败", 500);
  }
}
