import {
  lstat,
  open,
  realpath,
  mkdir,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
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
  bytes: Uint8Array | AsyncIterable<Uint8Array>;
  source: ProjectArchiveSource;
}

export interface ProjectFinishedFileInput extends Omit<
  ProjectAssetFileInput,
  "source"
> {}

export interface ProjectFileResult {
  path: string;
  created: boolean;
}

export interface ProjectCleanupResult {
  deleted: number;
  failed: Array<{ path: string; message: string }>;
}

export interface ProjectMediaFile {
  fileId: string;
  name: string;
  kind: ProjectMediaKind;
  mimeType: string;
  size: number;
  modifiedAt: string;
  section: "draft" | "finished";
  subfolder: string;
  /** Server-only path relative to this project, never accepted from a client. */
  relativePath: string;
}

export class ProjectFileAccessError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

const extensionMedia: Record<string, { kind: ProjectMediaKind; mimeType: string }> = Object.fromEntries(
  Object.entries(mimeExtensionsForBrowser()).map(([extension, mimeType]) => [extension, { kind: mimeType.split("/")[0] as ProjectMediaKind, mimeType }]),
);
function mimeExtensionsForBrowser(): Record<string, string> {
  return { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", bmp: "image/bmp",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", avi: "video/x-msvideo",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg" };
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
  return (
    candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!
  );
}

function cleanSegment(
  value: string,
  fallback: string,
  maxLength: number,
): string {
  let cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, "_")
    .slice(0, maxLength)
    .replace(/[. ]+$/gu, "");
  // Windows treats these names as devices even when followed by an extension.
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(cleaned))
    cleaned = `_${cleaned}`.slice(0, maxLength).replace(/[. ]+$/gu, "");
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
  private readonly pendingProjects = new Map<string, Promise<string>>();
  private readonly projectMutations = new Map<string, Promise<unknown>>();
  private readonly projectReaders = new Map<string, Set<Promise<unknown>>>();
  private readonly pendingArchives = new Map<
    string,
    Promise<ProjectFileResult>
  >();
  private readonly fileIndexes = new Map<string, { at: number; files: Map<string, ProjectMediaFile> }>();
  private readonly pendingFileIndexes = new Map<string, Promise<{ files: ProjectMediaFile[]; ignoredFiles: number }>>();

  constructor(options: ProjectFileStoreOptions = {}) {
    this.root = resolve(
      /* turbopackIgnore: true */ options.root ?? configuredRoot(),
    );
  }

  private operationKey(path: string): string {
    return process.platform === "win32" ? path.toLowerCase() : path;
  }

  /** Archives may run together, but directory mutations wait for their writers. */
  private async withProjectAccess<T>(
    projects: readonly string[],
    exclusive: boolean,
    work: () => Promise<T>,
  ): Promise<T> {
    const keys = [...new Set(projects.map((project) => this.operationKey(project)))];
    const dependencies = new Set<Promise<unknown>>();
    for (const key of keys) {
      const mutation = this.projectMutations.get(key);
      if (mutation) dependencies.add(mutation);
      if (exclusive) for (const reader of this.projectReaders.get(key) ?? []) dependencies.add(reader);
    }
    // Reserve all rename endpoints synchronously before yielding. Later reads
    // wait behind this mutation; a rejected earlier operation cannot poison it.
    const pending = Promise.all([...dependencies].map((dependency) => dependency.catch(() => undefined))).then(work);
    for (const key of keys) {
      if (exclusive) this.projectMutations.set(key, pending);
      else {
        const readers = this.projectReaders.get(key) ?? new Set<Promise<unknown>>();
        readers.add(pending);
        this.projectReaders.set(key, readers);
      }
    }
    try {
      return await pending;
    } finally {
      for (const key of keys) {
        if (exclusive) {
          this.fileIndexes.delete(key);
          if (this.projectMutations.get(key) === pending) this.projectMutations.delete(key);
        } else {
          const readers = this.projectReaders.get(key);
          readers?.delete(pending);
          if (!readers?.size) this.projectReaders.delete(key);
        }
      }
    }
  }

  projectDirectory(projectName: string): string {
    const target = resolve(
      /* turbopackIgnore: true */ this.root,
      normalizeProjectName(projectName),
    );
    assertWithin(this.root, target);
    return target;
  }

  private fileVersion(project: string, relativePath: string, details: Awaited<ReturnType<typeof lstat>>): string {
    return createHash("sha256").update(JSON.stringify([this.operationKey(project), relativePath, details.dev, details.ino,
      details.size, details.mtimeMs, details.ctimeMs, details.birthtimeMs])).digest("hex");
  }

  private async verifyExistingPath(target: string, directory: boolean): Promise<void> {
    const relativePath = relative(this.root, target);
    if (relativePath) assertWithin(this.root, target);
    let current = this.root;
    const segments = relativePath ? relativePath.split(sep) : [];
    for (let index = -1; index < segments.length; index++) {
      if (index >= 0) current = join(current, segments[index]!);
      const details = await lstat(current);
      if (details.isSymbolicLink() || ((index < segments.length - 1 || directory) ? !details.isDirectory() : !details.isFile()))
        throw new ProjectFileAccessError("项目文件路径无效或包含符号链接");
    }
    const [actualRoot, actualTarget] = await Promise.all([realpath(this.root), realpath(target)]);
    if (target !== this.root) assertWithin(actualRoot, actualTarget);
    if (this.operationKey(relative(actualRoot, actualTarget)) !== this.operationKey(relative(this.root, target)))
      throw new ProjectFileAccessError("项目文件路径已改变，请刷新");
  }

  private async listFilesOnce(projectName: string): Promise<{ files: ProjectMediaFile[]; ignoredFiles: number }> {
    const project = this.projectDirectory(projectName);
    try { await this.verifyExistingPath(project, true); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { files: [], ignoredFiles: 0 }; throw error; }
    const files: ProjectMediaFile[] = [];
    let ignoredFiles = 0;
    let visited = 0;
    const visit = async (directory: string, section: ProjectMediaFile["section"], area: string, depth: number) => {
      await this.verifyExistingPath(directory, true);
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (++visited > 20_000) throw new ProjectFileAccessError("项目文件过多，请先在文件夹中整理后再打开", 413);
        if (entry.isSymbolicLink()) { ignoredFiles++; continue; }
        const target = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (depth >= 12) { ignoredFiles++; continue; }
          await visit(target, section, area, depth + 1);
          continue;
        }
        const extension = extname(entry.name).slice(1).toLowerCase();
        const media = Object.hasOwn(extensionMedia, extension) ? extensionMedia[extension] : undefined;
        if (!entry.isFile() || !media || entry.name.endsWith(".tmp")) { ignoredFiles++; continue; }
        await this.verifyExistingPath(target, false);
        const details = await lstat(target);
        const relativePath = relative(project, target);
        files.push({ fileId: this.fileVersion(project, relativePath, details), name: entry.name, ...media,
          size: details.size, modifiedAt: details.mtime.toISOString(), section,
          subfolder: relative(area, directory).split(sep).join("/"), relativePath });
      }
    };
    for (const [folder, section] of [["成品", "finished"], ["草稿", "draft"]] as const) {
      const area = join(/* turbopackIgnore: true */ project, folder);
      try { await visit(area, section, area, 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.relativePath.localeCompare(b.relativePath));
    const key = this.operationKey(project);
    this.fileIndexes.delete(key);
    this.fileIndexes.set(key, { at: Date.now(), files: new Map(files.map(file => [file.fileId, file])) });
    if (this.fileIndexes.size > 32) this.fileIndexes.delete(this.fileIndexes.keys().next().value!);
    return { files, ignoredFiles };
  }

  private async indexedFile(projectName: string, fileId: string): Promise<ProjectMediaFile> {
    const key = this.operationKey(this.projectDirectory(projectName));
    let index = this.fileIndexes.get(key);
    if (!index || Date.now() - index.at > 30_000 || !index.files.has(fileId)) {
      await this.refreshFileIndex(projectName);
      index = this.fileIndexes.get(key);
    }
    const file = index?.files.get(fileId);
    if (!file) throw new ProjectFileAccessError("文件已变化或不属于当前项目，请刷新文件列表");
    const target = join(this.projectDirectory(projectName), file.relativePath);
    try {
      await this.verifyExistingPath(target, false);
      if (this.fileVersion(this.projectDirectory(projectName), file.relativePath, await lstat(target)) !== fileId)
        throw new ProjectFileAccessError("文件已变化，请刷新文件列表");
    } catch (error) {
      this.fileIndexes.delete(key);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ProjectFileAccessError("文件已变化，请刷新文件列表");
      throw error;
    }
    return file;
  }

  async fileMetadata(projectName: string, fileId: string): Promise<ProjectMediaFile> {
    return this.withProjectAccess([this.projectDirectory(projectName)], false, () => this.indexedFile(projectName, fileId));
  }

  async listFiles(projectName: string): Promise<{ files: ProjectMediaFile[]; ignoredFiles: number }> {
    return this.withProjectAccess([this.projectDirectory(projectName)], false, () => this.refreshFileIndex(projectName));
  }

  private async refreshFileIndex(projectName: string): Promise<{ files: ProjectMediaFile[]; ignoredFiles: number }> {
    const key = this.operationKey(this.projectDirectory(projectName));
    const active = this.pendingFileIndexes.get(key);
    if (active) return active;
    const pending = this.listFilesOnce(projectName);
    this.pendingFileIndexes.set(key, pending);
    try { return await pending; } finally { this.pendingFileIndexes.delete(key); }
  }

  async readFile(projectName: string, fileId: string, options: { start?: number; end?: number; maxBytes?: number } = {}): Promise<{ file: ProjectMediaFile; bytes: Uint8Array }> {
    return this.withProjectAccess([this.projectDirectory(projectName)], false, async () => {
      const file = await this.indexedFile(projectName, fileId);
      const target = join(this.projectDirectory(projectName), file.relativePath);
      await this.verifyExistingPath(target, false);
      const handle = await open(target, "r");
      try {
        const details = await handle.stat();
        if (!details.isFile() || this.fileVersion(this.projectDirectory(projectName), file.relativePath, details) !== fileId)
          throw new ProjectFileAccessError("文件已变化，请刷新后重试");
        const start = options.start ?? 0;
        const end = options.end ?? file.size - 1;
        const length = end - start + 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end >= file.size || length < 0)
          throw new ProjectFileAccessError("文件范围无效", 416);
        if (length > (options.maxBytes ?? 512 * 1024 * 1024)) throw new ProjectFileAccessError("文件过大，无法一次读取", 413);
        const bytes = Buffer.alloc(length);
        let offset = 0;
        while (offset < length) {
          const read = await handle.read(bytes, offset, length - offset, start + offset);
          if (!read.bytesRead) throw new ProjectFileAccessError("文件读取期间发生变化，请刷新");
          offset += read.bytesRead;
        }
        await this.verifyExistingPath(target, false);
        const latest = await lstat(target);
        if (this.fileVersion(this.projectDirectory(projectName), file.relativePath, latest) !== fileId)
          throw new ProjectFileAccessError("文件读取期间发生变化，请刷新");
        return { file, bytes };
      } finally { await handle.close(); }
    });
  }

  async deleteFiles(projectName: string, fileIds: readonly string[]): Promise<{ deletedIds: string[]; failed: Array<{ fileId: string; message: string }> }> {
    return this.withProjectAccess([this.projectDirectory(projectName)], true, async () => {
      const files = new Map((await this.listFilesOnce(projectName)).files.map(file => [file.fileId, file]));
      const deletedIds: string[] = [], failed: Array<{ fileId: string; message: string }> = [];
      for (const fileId of new Set(fileIds)) {
        try {
          const file = files.get(fileId);
          if (!file) throw new ProjectFileAccessError("文件已变化或不属于当前项目，请刷新后重试");
          const target = join(this.projectDirectory(projectName), file.relativePath);
          await this.verifyExistingPath(target, false);
          if (this.fileVersion(this.projectDirectory(projectName), file.relativePath, await lstat(target)) !== fileId)
            throw new ProjectFileAccessError("文件已变化，请刷新后重试");
          await unlink(target);
          deletedIds.push(fileId);
        } catch (error) { failed.push({ fileId, message: error instanceof ProjectFileAccessError ? error.message : "文件删除失败，请刷新或检查文件是否被占用" }); }
      }
      return { deletedIds, failed };
    });
  }

  private categoryDirectory(
    projectName: string,
    area: "草稿" | "成品",
    kind: ProjectMediaKind,
    source?: ProjectArchiveSource,
  ): string {
    const project = this.projectDirectory(projectName);
    const target = source
      ? join(
          /* turbopackIgnore: true */ project,
          area,
          sourceFolders[source],
          mediaFolders[kind],
        )
      : join(/* turbopackIgnore: true */ project, area, mediaFolders[kind]);
    assertWithin(this.root, target);
    return target;
  }

  async ensureProject(projectName: string): Promise<string> {
    return this.withProjectAccess([this.projectDirectory(projectName)], false,
      () => this.ensureProjectShared(projectName));
  }

  private async ensureProjectShared(projectName: string): Promise<string> {
    const project = this.projectDirectory(projectName);
    const key = this.operationKey(project);
    const previous = this.pendingProjects.get(key);
    if (previous) return previous;
    // Workspace reads and parallel archives often need the same directories.
    // Share only work in flight; later calls must still recheck the filesystem.
    const pending = this.ensureProjectOnce(projectName, project);
    this.pendingProjects.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.pendingProjects.get(key) === pending) this.pendingProjects.delete(key);
    }
  }

  private async ensureProjectOnce(projectName: string, project: string): Promise<string> {
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
    for (const directory of directories)
      await this.ensureSafeDirectory(directory);
    return project;
  }

  async renameProject(
    currentProjectName: string,
    nextProjectName: string,
  ): Promise<boolean> {
    return this.withProjectAccess([
      this.projectDirectory(currentProjectName), this.projectDirectory(nextProjectName),
    ], true, () => this.renameProjectOnce(currentProjectName, nextProjectName));
  }

  private async renameProjectOnce(
    currentProjectName: string,
    nextProjectName: string,
  ): Promise<boolean> {
    const currentProject = this.projectDirectory(currentProjectName);
    const nextProject = this.projectDirectory(nextProjectName);
    if (currentProject === nextProject) {
      await this.ensureProjectShared(nextProjectName);
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
      await this.ensureProjectShared(nextProjectName);
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
    await this.ensureProjectShared(nextProjectName);
    return true;
  }

  async deleteProject(projectName: string): Promise<boolean> {
    return this.withProjectAccess([this.projectDirectory(projectName)], true,
      () => this.deleteProjectOnce(projectName));
  }

  private async deleteProjectOnce(projectName: string): Promise<boolean> {
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
    if (rootDetails.isSymbolicLink())
      throw new Error("项目目录不能包含符号链接");
    if (!rootDetails.isDirectory()) throw new Error("项目路径不是目录");
    const relativePath = relative(this.root, directory);
    if (
      relativePath === "" ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`)
    )
      throw new Error("项目路径越界");
    let current = this.root;
    for (const segment of relativePath.split(sep)) {
      if (!segment) continue;
      current = join(/* turbopackIgnore: true */ current, segment);
      try {
        const details = await lstat(current);
        if (details.isSymbolicLink())
          throw new Error("项目目录不能包含符号链接");
        if (!details.isDirectory()) throw new Error("项目路径不是目录");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        try {
          await mkdir(current);
        } catch (creationError) {
          if ((creationError as NodeJS.ErrnoException).code !== "EEXIST")
            throw creationError;
          // Concurrent workspace reads can create the same path after lstat.
          // Recheck instead of accepting an existing file or directory link.
          const details = await lstat(current);
          if (details.isSymbolicLink())
            throw new Error("项目目录不能包含符号链接");
          if (!details.isDirectory()) throw new Error("项目路径不是目录");
        }
      }
    }
  }

  private assetPath(
    input: ProjectAssetFileInput | ProjectFinishedFileInput,
    area: "草稿" | "成品",
  ): string {
    const source = "source" in input ? input.source : undefined;
    const directory = this.categoryDirectory(
      input.projectName,
      area,
      input.kind,
      source,
    );
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
    const directory = dirname(this.assetPath(input, area));
    const key = this.operationKey(join(
      /* turbopackIgnore: true */ directory,
      cleanSegment(input.assetId, "asset", 96),
    ));
    const previous = this.pendingArchives.get(key);
    const pending = this.withProjectAccess([this.projectDirectory(input.projectName)], false, async () => {
      await previous?.catch(() => undefined);
      return this.writeAssetOnce(input, area);
    });
    this.pendingArchives.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.pendingArchives.get(key) === pending)
        this.pendingArchives.delete(key);
    }
  }

  private async writeAssetOnce(
    input: ProjectAssetFileInput | ProjectFinishedFileInput,
    area: "草稿" | "成品",
  ): Promise<ProjectFileResult> {
    await this.ensureProjectShared(input.projectName);
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

    const temporary = `${target}.${randomUUID()}.tmp`;
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
    return this.withProjectAccess([this.projectDirectory(projectName)], true,
      () => this.clearDraftOnce(projectName));
  }

  private async clearDraftOnce(projectName: string): Promise<ProjectCleanupResult> {
    const project = await this.ensureProjectShared(projectName);
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
    await this.ensureProjectShared(projectName);
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
