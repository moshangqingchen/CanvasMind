import type { AssetRecord, CanvasRecord } from "@super-canvas/db";
import { randomUUID } from "node:crypto";
import {
  getProjectFileStore,
  normalizeProjectName,
  type ProjectArchiveSource,
  type ProjectMediaKind,
} from "@super-canvas/storage";
import { repository, storage } from "./server";

export interface ProjectSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export function projectSummary(canvas: CanvasRecord): ProjectSummary {
  return {
    id: canvas.id,
    title: canvas.title,
    createdAt: canvas.createdAt,
    updatedAt: canvas.updatedAt,
  };
}

export async function canvasForProject(id: string): Promise<CanvasRecord | null> {
  return repository.getCanvas(id);
}

export async function ensureProjectDirectory(
  canvas: Pick<CanvasRecord, "title">,
): Promise<void> {
  await getProjectFileStore().ensureProject(canvas.title);
}

function mediaKind(asset: AssetRecord): ProjectMediaKind | null {
  return asset.kind === "image" || asset.kind === "video" || asset.kind === "audio"
    ? asset.kind
    : null;
}

async function archiveAsset(
  canvas: Pick<CanvasRecord, "title">,
  asset: AssetRecord,
  source: ProjectArchiveSource,
): Promise<void> {
  const kind = mediaKind(asset);
  if (!kind) return;
  const object = await storage.get(asset.storageKey);
  if (!object) throw new Error("素材文件不存在");
  await getProjectFileStore().archiveDraft({
    projectName: canvas.title,
    assetId: asset.id,
    name: asset.name,
    mimeType: asset.mimeType,
    kind,
    bytes: object.bytes,
    source,
  });
}

export async function archiveAssetForProject(
  canvasId: string,
  assetId: string,
  source: ProjectArchiveSource,
): Promise<void> {
  const [canvas, asset] = await Promise.all([
    repository.getCanvas(canvasId),
    repository.getAsset(assetId),
  ]);
  if (!canvas) throw new Error("项目不存在");
  if (!asset) throw new Error("素材不存在");
  await archiveAsset(canvas, asset, source);
}

export async function archiveExternalAssetsForProject(
  canvasId: string,
  assetIds: readonly string[],
): Promise<void> {
  const canvas = await repository.getCanvas(canvasId);
  if (!canvas) throw new Error("项目不存在");
  await Promise.all(
    [...new Set(assetIds)].map(async (assetId) => {
      const asset = await repository.getAsset(assetId);
      if (asset && typeof asset.metadata.runId !== "string")
        await archiveAsset(canvas, asset, "external");
    }),
  );
}

export async function archiveGeneratedAssetForFinished(
  asset: AssetRecord,
): Promise<boolean> {
  const kind = mediaKind(asset);
  const runId = typeof asset.metadata.runId === "string" ? asset.metadata.runId : null;
  if (!kind || !runId) return false;
  const run = await repository.getRun(runId);
  const canvas = run ? await repository.getCanvas(run.canvasId) : null;
  if (!canvas) return false;
  const object = await storage.get(asset.storageKey);
  if (!object) throw new Error("素材文件不存在");
  await getProjectFileStore().archiveFinished({
    projectName: canvas.title,
    assetId: asset.id,
    name: asset.name,
    mimeType: asset.mimeType,
    kind,
    bytes: object.bytes,
  });
  return true;
}

export function normalizedProjectTitle(title: string): string {
  return normalizeProjectName(title);
}

const PROJECT_CHAT_KIND = "project-chat";

function isProjectChatSession(session: { metadata: Record<string, unknown> }): boolean {
  // Sessions created before project chat metadata was introduced still belong
  // to their canvas, so include them in the first project-scoped view.
  return (
    session.metadata.conversationType === PROJECT_CHAT_KIND ||
    session.metadata.conversationType === undefined
  );
}

async function projectChatSession(canvasId: string, title: string) {
  const sessions = await repository.listDirectorSessions(canvasId);
  const existing = sessions.find(isProjectChatSession);
  if (existing) {
    if (existing.metadata.conversationType !== PROJECT_CHAT_KIND)
      return (
        (await repository.updateDirectorSession(existing.id, {
          metadata: {
            ...existing.metadata,
            conversationType: PROJECT_CHAT_KIND,
          },
        })) ?? existing
      );
    return existing;
  }
  const id = `project-chat-${canvasId}`;
  const byId = await repository.getDirectorSession(id);
  if (byId) return byId;
  try {
    return await repository.createDirectorSession({
      id,
      canvasId,
      profileId: null,
      title,
      metadata: { conversationType: PROJECT_CHAT_KIND },
    });
  } catch {
    const raced = await repository.getDirectorSession(id);
    if (!raced) throw new Error("项目对话初始化失败");
    return raced;
  }
}

export async function listProjectChatMessages(
  canvasId: string,
): Promise<ProjectChatMessage[]> {
  const canvas = await repository.getCanvas(canvasId);
  if (!canvas) throw new Error("项目不存在");
  const sessions = await repository.listDirectorSessions(canvasId);
  const projectSessions = sessions.filter(isProjectChatSession);
  if (projectSessions.length === 0) return [];
  const messages = (
    await Promise.all(
      projectSessions.map((session) => repository.listDirectorMessages(session.id)),
    )
  ).flat();
  return messages
    .filter(
      (message): message is typeof message & { role: "user" | "assistant" } =>
        (message.role === "user" || message.role === "assistant") &&
        message.metadata.kind !== "status" &&
        message.metadata.kind !== "proposal",
    )
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    )
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    }));
}

export async function appendProjectChatTurn(
  canvasId: string,
  userContent: string,
  assistantContent: string,
): Promise<void> {
  const canvas = await repository.getCanvas(canvasId);
  if (!canvas) throw new Error("项目不存在");
  const session = await projectChatSession(canvasId, canvas.title);
  const turnId = randomUUID();
  await repository.createDirectorMessage({
    id: `${turnId}-user`,
    sessionId: session.id,
    role: "user",
    content: userContent.slice(0, 16_000),
    metadata: {},
  });
  await repository.createDirectorMessage({
    id: `${turnId}-assistant`,
    sessionId: session.id,
    role: "assistant",
    content: assistantContent.slice(0, 16_000),
    metadata: {},
  });
}

export async function clearProjectChat(canvasId: string): Promise<void> {
  const canvas = await repository.getCanvas(canvasId);
  if (!canvas) throw new Error("项目不存在");
  const sessions = await repository.listDirectorSessions(canvasId);
  await Promise.all(
    sessions
      .filter(isProjectChatSession)
      .map((session) => repository.deleteDirectorSession(session.id)),
  );
}
