import { z } from "zod";
import { MAX_SMALL_JSON_BODY_BYTES, parseJsonRequest } from "../../../lib/api-validation";
import { jsonError, repository, safeJsonObject } from "../../../lib/server";
import {
  ensureProjectDirectory,
  normalizedProjectTitle,
  projectSummary,
} from "../../../lib/project-service";

const ProjectTitleSchema = z.string().trim().min(1).max(160);
const CreateProjectSchema = z.object({ title: ProjectTitleSchema }).strict();

const emptyGraph = {
  schemaVersion: 1 as const,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 0.85 },
};

export async function GET() {
  let canvases = await repository.listCanvases();
  if (canvases.length === 0) {
    const defaultCanvas = await repository.ensureDefaultCanvas();
    canvases = [defaultCanvas];
  }
  canvases = canvases.sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  await Promise.all(canvases.map((canvas) => ensureProjectDirectory(canvas)));
  return Response.json({ projects: canvases.map(projectSummary) });
}

export async function POST(request: Request) {
  const parsed = await parseJsonRequest(
    request,
    CreateProjectSchema,
    MAX_SMALL_JSON_BODY_BYTES,
  );
  if (!parsed.success) return parsed.response;

  const title = parsed.data.title.trim();
  const normalized = normalizedProjectTitle(title).normalize("NFC").toLocaleLowerCase();
  const existing = await repository.listCanvases();
  if (
    existing.some(
      (canvas) =>
        normalizedProjectTitle(canvas.title).normalize("NFC").toLocaleLowerCase() ===
        normalized,
    )
  )
    return jsonError("项目名称已存在，请换一个名称", 409);

  try {
    const canvas = await repository.saveCanvas({
      id: crypto.randomUUID(),
      title,
      graph: safeJsonObject(emptyGraph),
      reason: "manual",
    });
    await ensureProjectDirectory(canvas);
    return Response.json({ project: projectSummary(canvas) }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "项目创建失败", 500);
  }
}
