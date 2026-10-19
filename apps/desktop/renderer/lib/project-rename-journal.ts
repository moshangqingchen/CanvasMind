import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from "node:fs/promises";
import { join, relative, isAbsolute, sep } from "node:path";
import { normalizeProjectName } from "@super-canvas/storage";

export interface ProjectRenameIntent {
  version: 1;
  operationId: string;
  canvasId: string;
  expectedRevision: number;
  oldTitle: string;
  newTitle: string;
  oldFolder: string;
  newFolder: string;
  temporaryFolder: string;
  sourceIdentity: { dev: number; ino: number; birthtimeMs: number };
  createdAt: string;
}

/** This metadata stays in the project root, outside every movable project. */
export class ProjectRenameJournal {
  readonly directory: string;
  constructor(readonly root: string) { this.directory = join(root, ".supercanvas-meta", "renames"); }

  private file(canvasId: string): string {
    return join(this.directory, `${createHash("sha256").update(canvasId).digest("hex")}.json`);
  }

  private async safeDirectory(create: boolean): Promise<boolean> {
    for (const path of [this.root, join(this.root, ".supercanvas-meta"), this.directory]) {
      if (create) await mkdir(path, { recursive: false }).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      });
      let details;
      try { details = await lstat(path); }
      catch (error) { if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
      if (details.isSymbolicLink() || !details.isDirectory()) throw new Error("项目重命名元数据目录不安全");
    }
    const offset = relative(await realpath(this.root), await realpath(this.directory));
    if (!offset || offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) throw new Error("项目重命名元数据路径越界");
    return true;
  }

  async write(intent: ProjectRenameIntent): Promise<void> {
    await this.safeDirectory(true);
    const target = this.file(intent.canvasId);
    try { await lstat(target); throw new Error("该项目已有待恢复的重命名"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(intent), "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(() => undefined); }
  }

  async entries(canvasId?: string): Promise<ProjectRenameIntent[]> {
    if (!await this.safeDirectory(false)) return [];
    const entries = await readdir(this.directory, { withFileTypes: true });
    const result: ProjectRenameIntent[] = [];
    for (const entry of entries) {
      if (!entry.name.endsWith(".json")) continue;
      const path = join(this.directory, entry.name);
      if (canvasId !== undefined && path !== this.file(canvasId)) continue;
      const details = await lstat(path);
      if (entry.isSymbolicLink() || !details.isFile() || details.size > 64 * 1024) throw new Error("项目重命名意图文件无效");
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!value || typeof value !== "object") throw new Error("项目重命名意图内容无效");
      const i = value as ProjectRenameIntent;
      if (i.version !== 1 || typeof i.canvasId !== "string" || !i.canvasId || i.canvasId.length > 160 ||
        typeof i.operationId !== "string" || !/^[a-f0-9-]{36}$/u.test(i.operationId) ||
        !Number.isSafeInteger(i.expectedRevision) || i.expectedRevision < 0 ||
        typeof i.oldTitle !== "string" || typeof i.newTitle !== "string" || i.oldTitle.length > 200 || i.newTitle.length > 200 ||
        i.oldFolder !== normalizeProjectName(i.oldTitle) || i.newFolder !== normalizeProjectName(i.newTitle) ||
        i.temporaryFolder !== `.project-rename-${i.operationId}` || typeof i.createdAt !== "string" ||
        !i.sourceIdentity || !Number.isFinite(i.sourceIdentity.dev) || !Number.isFinite(i.sourceIdentity.ino) || !Number.isFinite(i.sourceIdentity.birthtimeMs) ||
        this.file(i.canvasId) !== path) throw new Error("项目重命名意图校验失败");
      result.push(i);
    }
    return result;
  }

  async clear(canvasId: string): Promise<void> {
    await this.safeDirectory(false);
    const target = this.file(canvasId);
    const details = await lstat(target);
    if (details.isSymbolicLink() || !details.isFile()) throw new Error("项目重命名意图文件无效");
    await unlink(target);
  }
}
