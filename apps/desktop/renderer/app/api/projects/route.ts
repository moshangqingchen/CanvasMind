import { z } from "zod";
import { MAX_SMALL_JSON_BODY_BYTES, parseJsonRequest } from "../../../lib/api-validation";
import { jsonError, repository, safeJsonObject } from "../../../lib/server";
import { projectCoordinator, ProjectMutationError } from "../../../lib/project-coordinator";
import {
  ensureProjectDirectory,
  projectCardSummary,
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
  const canvases = (await repository.listCanvases()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  await Promise.all(canvases.map((canvas) => ensureProjectDirectory(canvas)));
  return Response.json({ projects: await Promise.all(canvases.map(projectCardSummary)) });
}

export async function POST(request: Request) {
  const parsed = await parseJsonRequest(
    request,
    CreateProjectSchema,
    MAX_SMALL_JSON_BODY_BYTES,
  );
  if (!parsed.success) return parsed.response;

  const title = parsed.data.title.trim();
  try {
    const canvas = await projectCoordinator(repository).saveCanvas({
      id: crypto.randomUUID(),
      title,
      graph: safeJsonObject(emptyGraph),
      reason: "manual",
    }, true);
    return Response.json({ project: projectSummary(canvas) }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "项目创建失败", error instanceof ProjectMutationError ? error.status : 500);
  }
}
