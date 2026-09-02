import {
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export type ProjectMediaKind = "image" | "video" | "audio";
export type ProjectArchiveSource = "external" | "generated";

export interface ProjectFileStoreOptions {
  root?: string;
}

export interface ProjectAssetFileInput {
  projectName: string;
  assetId: string;
  name: string;
  mimeType: string;
  kind: ProjectMediaKind;
  bytes: Uint8Array;
  source: ProjectArchiveSource;
}

export interface ProjectFinishedFileInput
  extends Omit<ProjectAssetFileInput, "source"> {}

export interface ProjectFileResult {
  path: string;
  created: boolean;
}

export interface ProjectCleanupResult {
  deleted: number;
  failed: Array<{ path: string; message: string }>;
}

const mediaFolders: Record<ProjectMediaKind, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
};

const sourceFolders: Record<ProjectArchiveSource, string> = {
  external: "外界素材",
  generated: "画布生成",
};

const mimeExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-msvideo": "avi",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
};

function configuredRoot(): string {
  const configured = process.env.SUPERCANVAS_PROJECT_ROOT?.trim();
  if (configured)
    return isAbsolute(configured)
      ? configured
      : resolve(/* turbopackIgnore: true */ configured);
  const workingDirectory = process.cwd();
  const candidates = [
    join(/* turbopackIgnore: true */ workingDirectory, "项目"),
    join(/* turbopackIgnore: true */ workingDirectory, "..", "项目"),
    join(/* turbopackIgnore: true */ workingDirectory, "..", "..", "项目"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

function cleanSegment(value: string, fallback: string, maxLength: number): string {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, "_")
    .replace(/[. ]+$/gu, "")
    .slice(0, maxLength);
  return cleaned || fallback;
}

export function normalizeProjectName(value: string): string {
  return cleanSegment(value, "未命名项目", 120);
}

function normalizedMimeType(value: string): string {
  return value.trim().toLowerCase().split(";", 1)[0] ?? "";
}

function extensionFor(name: string, mimeType: string): string {
  const existing = extname(name).slice(1).toLowerCase();
  if (/^[a-z0-9]{1,10}$/u.test(existing)) return existing;
  return mimeExtensions[normalizedMimeType(mimeType)] ?? "bin";
}

function fileBase(name: string, kind: ProjectMediaKind): string {
  const cleaned = cleanSegment(name.replace(/\.[^.]+$/u, ""), kind, 100);
  return cleaned.replace(/[. ]+$/gu, "") || kind;
}

function assertWithin(root: string, target: string): void {
  const relativePath = relative(root, target);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("项目路径越界");
  }
}

async function removeDraftEntry(path: string): Promise<void> {
  const details = await lstat(path);
  if (details.isSymbolicLink()) {
    await unlink(path);
    return;
  }
  await rm(path, { recursive: true, force: true });
}

export class ProjectFileStore {
  readonly root: string;

  constructor(options: ProjectFileStoreOptions = {}) {
    this.root = resolve(/* turbopackIgnore: true */ options.root ?? configuredRoot());
  }

  projectDirectory(projectName: string): string {
    const target = resolve(
      /* turbopackIgnore: true */ this.root,
      normalizeProjectName(projectName),
    );
    assertWithin(this.root, target);
    return target;
  }

  private categoryDirectory(
    projectName: string,
    area: "草稿" | "成品",
    kind: ProjectMediaKind,
    source?: ProjectArchiveSource,
  ): string {
    const project = this.projectDirectory(projectName);
    const target = source
      ? join(/* turbopackIgnore: true */ project, area, sourceFolders[source], mediaFolders[kind])
      : join(/* turbopackIgnore: true */ project, area, mediaFolders[kind]);
    assertWithin(this.root, target);
    return target;
  }

  async ensureProject(projectName: string): Promise<string> {
    const project = this.projectDirectory(projectName);
    const directories = [
      ...Object.keys(sourceFolders).flatMap((source) =>
        Object.keys(mediaFolders).map((kind) =>
          this.categoryDirectory(
            projectName,
            "草稿",
            kind as ProjectMediaKind,
            source as ProjectArchiveSource,
          ),
        ),
      ),
      ...Object.keys(mediaFolders).map((kind) =>
        this.categoryDirectory(projectName, "成品", kind as ProjectMediaKind),
      ),
    ];
    for (const directory of directories) await this.ensureSafeDirectory(directory);
    return project;
  }

  async renameProject(
    currentProjectName: string,
    nextProjectName: string,
  ): Promise<boolean> {
    const currentProject = this.projectDirectory(currentProjectName);
    const nextProject = this.projectDirectory(nextProjectName);
    if (currentProject === nextProject) {
      await this.ensureProject(nextProjectName);
      return false;
    }

    await mkdir(this.root, { recursive: true });
    const rootDetails = await lstat(this.root);
    if (rootDetails.isSymbolicLink() || !rootDetails.isDirectory())
      throw new Error("项目根目录无效");

    let currentExists = true;
    try {
      const currentDetails = await lstat(currentProject);
      if (currentDetails.isSymbolicLink() || !currentDetails.isDirectory())
        throw new Error("原项目目录无效");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      currentExists = false;
    }

    const caseOnlyRename =
      process.platform === "win32" &&
      currentProject.toLocaleLowerCase() === nextProject.toLocaleLowerCase();
    if (!caseOnlyRename) {
      try {
        await lstat(nextProject);
        throw new Error("目标项目文件夹已存在，请换一个项目名称");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    if (!currentExists) {
      await this.ensureProject(nextProjectName);
      return false;
    }

    if (caseOnlyRename) {
      const temporary = join(
        /* turbopackIgnore: true */ this.root,
        `.project-rename-${randomUUID()}`,
      );
      assertWithin(this.root, temporary);
      await rename(currentProject, temporary);
      try {
        await rename(temporary, nextProject);
      } catch (error) {
        await rename(temporary, currentProject).catch(() => undefined);
        throw error;
      }
    } else {
      await rename(currentProject, nextProject);
    }
    await this.ensureProject(nextProjectName);
    return true;
  }

  async deleteProject(projectName: string): Promise<boolean> {
    const project = this.projectDirectory(projectName);
    try {
      const rootDetails = await lstat(this.root);
      if (rootDetails.isSymbolicLink() || !rootDetails.isDirectory())
        throw new Error("项目根目录无效");
      const projectDetails = await lstat(project);
      if (projectDetails.isSymbolicLink() || !projectDetails.isDirectory())
        throw new Error("项目目录无效");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    await rm(project, { recursive: true, force: false });
    return true;
  }

  private async ensureSafeDirectory(directory: string): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const rootDetails = await lstat(this.root);
    if (rootDetails.isSymbolicLink()) throw new Error("项目目录不能包含符号链接");
    if (!rootDetails.isDirectory()) throw new Error("项目路径不是目录");
    const relativePath = relative(this.root, directory);
    if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`))
      throw new Error("项目路径越界");
    let current = this.root;
    for (const segment of relativePath.split(sep)) {
      if (!segment) continue;
      current = join(/* turbopackIgnore: true */ current, segment);
      try {
        const details = await lstat(current);
        if (details.isSymbolicLink()) throw new Error("项目目录不能包含符号链接");
        if (!details.isDirectory()) throw new Error("项目路径不是目录");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await mkdir(current);
      }
    }
  }

  private assetPath(
    input: ProjectAssetFileInput | ProjectFinishedFileInput,
    area: "草稿" | "成品",
  ): string {
    const source = "source" in input ? input.source : undefined;
    const directory = this.categoryDirectory(input.projectName, area, input.kind, source);
    const extension = extensionFor(input.name, input.mimeType);
    const filename = `${fileBase(input.name, input.kind)}--${cleanSegment(input.assetId, "asset", 96)}.${extension}`;
    const target = resolve(/* turbopackIgnore: true */ directory, filename);
    assertWithin(this.root, target);
    return target;
  }

  private async writeAsset(
    input: ProjectAssetFileInput | ProjectFinishedFileInput,
    area: "草稿" | "成品",
  ): Promise<ProjectFileResult> {
    await this.ensureProject(input.projectName);
    const target = this.assetPath(input, area);
    const assetMarker = `--${cleanSegment(input.assetId, "asset", 96)}.`;
    const existingByAssetId = (await readdir(dirname(target))).find(
      (entry) => entry.includes(assetMarker) && !entry.endsWith(".tmp"),
    );
    if (existingByAssetId) {
      const existingPath = join(dirname(target), existingByAssetId);
      const details = await lstat(existingPath);
      if (details.isSymbolicLink() || !details.isFile())
        throw new Error("项目目标文件无效");
      return { path: existingPath, created: false };
    }
    try {
      const details = await lstat(target);
      if (details.isSymbolicLink() || !details.isFile())
        throw new Error("项目目标文件无效");
      return { path: target, created: false };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, input.bytes);
      try {
        await rename(temporary, target);
        return { path: target, created: true };
      } catch (error) {
        // Concurrent archives of the same asset converge on the first file.
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const details = await lstat(target);
        if (details.isSymbolicLink() || !details.isFile())
          throw new Error("项目目标文件无效");
        return { path: target, created: false };
      }
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async archiveDraft(input: ProjectAssetFileInput): Promise<ProjectFileResult> {
    return this.writeAsset(input, "草稿");
  }

  async archiveFinished(
    input: ProjectFinishedFileInput,
  ): Promise<ProjectFileResult> {
    return this.writeAsset(input, "成品");
  }

  async clearDraft(projectName: string): Promise<ProjectCleanupResult> {
    const project = await this.ensureProject(projectName);
    const draft = join(/* turbopackIgnore: true */ project, "草稿");
    const entries = await readdir(draft, { withFileTypes: true });
    let deleted = 0;
    const failed: ProjectCleanupResult["failed"] = [];
    for (const entry of entries) {
      const entryPath = join(/* turbopackIgnore: true */ draft, entry.name);
      try {
        await removeDraftEntry(entryPath);
        deleted += 1;
      } catch (error) {
        failed.push({
          path: entryPath,
          message: error instanceof Error ? error.message : "删除失败",
        });
      }
    }
    await this.ensureProject(projectName);
    return { deleted, failed };
  }
}

const globalKey = "__superCanvasProjectFileStore";

export function getProjectFileStore(): ProjectFileStore {
  const scope = globalThis as typeof globalThis & {
    [globalKey]?: ProjectFileStore;
  };
  scope[globalKey] ??= new ProjectFileStore();
  return scope[globalKey];
}
