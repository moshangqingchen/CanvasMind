import type { AssetRecord, CanvasRecord } from "@super-canvas/db";
import { createHash, randomUUID } from "node:crypto";
import {
  getProjectFileStore,
  normalizeProjectName,
  ProjectFileAccessError,
  type ProjectMediaFile,
  type ProjectArchiveSource,
  type ProjectMediaKind,
} from "@super-canvas/storage";
import { repository, storage } from "./server";
import { collectReferencedAssetIds } from "./project-transfer";
import type { CanvasDocument } from "../components/types";
import { completeMediaPayload, mediaKindForMime, sanitizedAssetExtension, validateMediaMagic } from "../app/api/assets/media-utils";

export type ProjectFileView = Omit<ProjectMediaFile, "relativePath"> & {
  contentUrl: string; previewUrl: string; assetId?: string; canDelete: boolean;
};

async function uniqueProjectDirectory(canvasId: string): Promise<CanvasRecord> {
  const canvas = await repository.getCanvas(canvasId);
  if (!canvas) throw new ProjectFileAccessError("项目不存在", 404);
  const titleKey = normalizeProjectName(canvas.title).normalize("NFC").toLocaleLowerCase();
  if ((await repository.listCanvases()).some(other => other.id !== canvasId && normalizeProjectName(other.title).normalize("NFC").toLocaleLowerCase() === titleKey))
    throw new ProjectFileAccessError("历史同名项目共用文件夹，无法安全区分当前项目文件，请先处理重名项目");
  return canvas;
}

async function projectAssets(canvas: CanvasRecord): Promise<AssetRecord[]> {
  const graph = canvas.graph as unknown as CanvasDocument;
  const ids = new Set(collectReferencedAssetIds({ ...graph, nodes: Array.isArray(graph.nodes) ? graph.nodes : [] }));
  const runs = await repository.listRuns(canvas.id);
  const runIds = new Set(runs.map(run => run.id));
  return (await repository.listAssets()).filter(asset => !asset.deleted &&
    (ids.has(asset.id) || asset.metadata.canvasId === canvas.id || runIds.has(String(asset.metadata.runId))));
}

function associatedAsset(file: ProjectMediaFile, assets: readonly AssetRecord[]): AssetRecord | undefined {
  const extension = file.name.slice(file.name.lastIndexOf("."));
  return assets.find(asset => {
    const source = asset.metadata.projectFile;
    return (source && typeof source === "object" && !Array.isArray(source) && "fileId" in source && source.fileId === file.fileId) ||
      (/^[\w-]{1,96}$/u.test(asset.id) && file.name.endsWith(`--${asset.id}${extension}`));
  });
}

export async function listProjectFiles(canvasId: string): Promise<{ files: ProjectFileView[]; ignoredFiles: number }> {
  const canvas = await uniqueProjectDirectory(canvasId);
  const store = getProjectFileStore();
  const [{ files, ignoredFiles }, assets] = await Promise.all([store.listFiles(canvas.title), projectAssets(canvas)]);
  const endpoint = `/api/projects/${encodeURIComponent(canvasId)}/files/content`;
  return { ignoredFiles, files: files.map(file => {
    const { fileId, name, kind, mimeType, size, modifiedAt, section, subfolder } = file;
    const publicFile = { fileId, name, kind, mimeType, size, modifiedAt, section, subfolder };
    const asset = associatedAsset(file, assets);
    const assetId = asset?.id;
    const contentUrl = `${endpoint}?fileId=${file.fileId}`;
    return { ...publicFile, name: asset?.name ?? file.name, contentUrl, previewUrl: file.kind === "image" ? `${contentUrl}&preview=640` : contentUrl,
      ...(assetId ? { assetId } : {}), canDelete: true };
  }) };
}

export async function readProjectFile(canvasId: string, fileId: string, options?: { start?: number; end?: number; maxBytes?: number }) {
  const canvas = await uniqueProjectDirectory(canvasId);
  return getProjectFileStore().readFile(canvas.title, fileId, options);
}

export async function projectFileMetadata(canvasId: string, fileId: string) {
  const canvas = await uniqueProjectDirectory(canvasId);
  return getProjectFileStore().fileMetadata(canvas.title, fileId);
}

export async function deleteProjectFiles(canvasId: string, fileIds: readonly string[]) {
  const canvas = await uniqueProjectDirectory(canvasId);
  return getProjectFileStore().deleteFiles(canvas.title, fileIds);
}

export async function importProjectFiles(canvasId: string, fileIds: readonly string[]): Promise<{ assets: AssetRecord[]; failed: Array<{ fileId: string; error: string }> }> {
  const canvas = await uniqueProjectDirectory(canvasId);
  const known = await projectAssets(canvas);
  const assets: AssetRecord[] = [], failed: Array<{ fileId: string; error: string }> = [];
  for (const fileId of new Set(fileIds)) {
    try {
      const { file, bytes } = await getProjectFileStore().readFile(canvas.title, fileId, { maxBytes: 500 * 1024 * 1024 });
      const prior = associatedAsset(file, known);
      if (prior) {
        const original = await storage.get(prior.storageKey);
        if (original && createHash("sha256").update(original.bytes).digest("hex") === createHash("sha256").update(bytes).digest("hex")) {
          assets.push(prior); continue;
        }
      }
      const kind = mediaKindForMime(file.mimeType);
      if (!kind || !validateMediaMagic(bytes, file.mimeType).valid || !completeMediaPayload(bytes, file.mimeType))
        throw new Error("文件不是完整的受支持图片、视频或音频，无法放入画布");
      const id = randomUUID();
      const storageKey = `assets/${id}/original.${sanitizedAssetExtension(file.name, file.mimeType)}`;
      await storage.put(storageKey, bytes, file.mimeType);
      try {
        const asset = await repository.saveAsset({ id, name: file.name, kind, mimeType: file.mimeType, size: bytes.byteLength, storageKey,
          metadata: { canvasId, projectFile: { canvasId, fileId, section: file.section } } });
        assets.push(asset);
        known.push(asset);
      } catch (error) { await storage.delete?.(storageKey).catch(() => undefined); throw error; }
    } catch (error) { failed.push({ fileId, error: error instanceof Error && !("code" in error) ? error.message : "文件导入失败，请刷新后重试" }); }
  }
  return { assets, failed };
}

export interface ProjectSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  previewAssetId?: string;
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
    nodeCount: Array.isArray(canvas.graph.nodes) ? canvas.graph.nodes.length : 0,
  };
}

/** Only expose a durable image asset ID, never graph contents or remote URLs. */
export async function projectCardSummary(canvas: CanvasRecord): Promise<ProjectSummary> {
  const summary = projectSummary(canvas);
  const nodes = Array.isArray(canvas.graph.nodes) ? canvas.graph.nodes : [];
  const candidates = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim()) candidates.add(value);
  };
  for (const node of [...nodes].reverse()) {
    if (!node || typeof node !== "object" || !node.data || typeof node.data !== "object") continue;
    const data = node.data as Record<string, unknown>;
    add(data.assetId);
    for (const field of [data.lastOutputAssetIds, data.materializedOutputAssetIds]) {
      if (Array.isArray(field)) [...field].reverse().forEach(add);
    }
    for (const field of [data.parts, data.generatedPromptParts]) {
      if (!Array.isArray(field)) continue;
      for (const part of field) {
        if (part && typeof part === "object" && part.type === "asset") add(part.assetId);
      }
    }
  }
  for (const id of candidates) {
    const asset = await repository.getAsset(id);
    if (asset && !asset.deleted && asset.kind === "image") {
      summary.previewAssetId = asset.id;
      break;
    }
  }
  return summary;
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

export async function archiveExternalAssetsForProject(
  canvasId: string,
  assetIds: readonly string[],
): Promise<void> {
  const canvas = await repository.getCanvas(canvasId);
  if (!canvas) throw new Error("项目不存在");
  await Promise.all(
    [...new Set(assetIds)].map(async (assetId) => {
      const asset = await repository.getAsset(assetId);
      const importedFile = asset?.metadata.projectFile;
      const alreadyInProject = importedFile && typeof importedFile === "object" && !Array.isArray(importedFile) && "canvasId" in importedFile && importedFile.canvasId === canvasId;
      if (asset && typeof asset.metadata.runId !== "string" && !alreadyInProject)
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
