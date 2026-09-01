import { CanvasRevisionConflictError } from "@super-canvas/db";
import {
  UpdateCanvasRequestSchema,
  graphValidationError,
  parseJsonRequest,
  parseRouteIdentifier,
  validateCanvasGraphSemantics,
} from "../../../../lib/api-validation";
import { repository, jsonError, safeJsonObject } from "../../../../lib/server";

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const parsedId = parseRouteIdentifier(params.id, "画布 ID");
  if (!parsedId.success) return parsedId.response;
  const id = parsedId.data;
  const canvas = await repository.getCanvas(id);
  return canvas ? Response.json(canvas) : jsonError("画布不存在", 404);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const parsedId = parseRouteIdentifier(params.id, "画布 ID");
  if (!parsedId.success) return parsedId.response;
  const parsed = await parseJsonRequest(request, UpdateCanvasRequestSchema);
  if (!parsed.success) return parsed.response;

  const graphIssues = validateCanvasGraphSemantics(parsed.data.graph);
  if (graphIssues.length > 0) return graphValidationError(graphIssues);

  try {
    const canvas = await repository.saveCanvas({
      id: parsedId.data,
      title: parsed.data.title,
      graph: safeJsonObject(parsed.data.graph),
      reason: "autosave",
      expectedRevision: parsed.data.expectedRevision,
    });
    return Response.json(canvas);
  } catch (error) {
    if (error instanceof CanvasRevisionConflictError) {
      return Response.json(
        {
          error: "画布已在其他位置更新，请先处理版本冲突",
          code: error.code,
          currentRevision: error.currentRevision,
        },
        { status: 409 },
      );
    }
    return jsonError("画布保存失败", 500);
  }
}
