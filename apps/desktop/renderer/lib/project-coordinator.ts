import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { relative } from "node:path";
import type { CanvasRecord, Repository } from "@super-canvas/db";
import { getProjectFileStore, ProjectFileAccessError, type ProjectFileStore } from "@super-canvas/storage";
import { ProjectRenameJournal, type ProjectRenameIntent } from "./project-rename-journal";
import { normalizeProjectName, projectTitleKey } from "./project-title";
export { projectTitleKey } from "./project-title";

export class ProjectMutationError extends ProjectFileAccessError {
  constructor(message: string, status = 409, readonly code = "PROJECT_NAME_CONFLICT") {
    super(message, status);
  }
}

class ProjectReadNeedsRecovery extends Error {}

/** One API worker owns a repository. Keep directory identity changes in the
 * same queue, including deletion until the old directory is actually removed. */
export class ProjectCoordinator {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly scope = new AsyncLocalStorage<boolean>();
  private readonly leases = new AsyncLocalStorage<Map<string, boolean>>();
  private readonly writers = new Map<string, Promise<unknown>>();
  private readonly readers = new Map<string, Set<Promise<unknown>>>();

  constructor(readonly repository: Repository, readonly files: ProjectFileStore) {}

  private async access<T>(canvasId: string, exclusive: boolean, work: () => Promise<T>): Promise<T> {
    const held = this.leases.getStore();
    if (held?.has(canvasId)) {
      if (exclusive && !held.get(canvasId)) throw new ProjectMutationError("不能在项目文件读取中升级名称变更锁", 409);
      return work();
    }
    const dependencies = new Set<Promise<unknown>>();
    const writer = this.writers.get(canvasId);
    if (writer) dependencies.add(writer);
    if (exclusive) for (const reader of this.readers.get(canvasId) ?? []) dependencies.add(reader);
    const next = new Map(held); next.set(canvasId, exclusive);
    const pending = Promise.all([...dependencies].map(prior => prior.catch(() => undefined))).then(() => this.leases.run(next, work));
    if (exclusive) this.writers.set(canvasId, pending);
    else {
      const readers = this.readers.get(canvasId) ?? new Set<Promise<unknown>>();
      readers.add(pending); this.readers.set(canvasId, readers);
    }
    try { return await pending; }
    finally {
      if (exclusive && this.writers.get(canvasId) === pending) this.writers.delete(canvasId);
      if (!exclusive) { const readers = this.readers.get(canvasId); readers?.delete(pending); if (!readers?.size) this.readers.delete(canvasId); }
    }
  }

  /** File streams share a canvas lease; only its rename/delete needs exclusivity. */
  async withCanvas<T>(canvasId: string, work: () => Promise<T>): Promise<T> {
    if (this.leases.getStore()?.has(canvasId)) return work();
    for (;;) {
      try {
        return await this.access(canvasId, false, async () => {
          let pending: ProjectRenameIntent[];
          try { pending = await new ProjectRenameJournal(this.files.root).entries(canvasId); }
          catch (error) { throw this.pending(error); }
          if (pending.length) throw new ProjectReadNeedsRecovery();
          return work();
        });
      } catch (error) {
        if (!(error instanceof ProjectReadNeedsRecovery)) throw error;
        // Release the shared lease before requesting the exclusive recovery gate.
        await this.run(async () => undefined, canvasId);
      }
    }
  }

  run<T>(work: () => Promise<T>, canvasId?: string): Promise<T> {
    if (this.scope.getStore()) {
      if (canvasId && this.leases.getStore()?.get(canvasId) !== true) return Promise.reject(new ProjectMutationError("名称变更缺少画布排他门", 500));
      return work();
    }
    // Always acquire the canvas gate first. Waiting for a long stream must not
    // reserve the root-wide name queue and block unrelated project mutations.
    if (canvasId) return this.access(canvasId, true, () => this.names(work, canvasId));
    return this.names(work);
  }

  private names<T>(work: () => Promise<T>, canvasId?: string): Promise<T> {
    const pending = this.tail.catch(() => undefined).then(() => this.scope.run(true, async () => {
      if (canvasId) await this.recover(canvasId);
      return work();
    }));
    this.tail = pending;
    return pending;
  }

  private pending(error: unknown): ProjectMutationError {
    return new ProjectMutationError(`项目重命名待恢复：${error instanceof Error ? error.message : "状态无法确认"}。请保留原文件与恢复记录，勿重复创建同名项目`, 409, "PROJECT_RENAME_PENDING");
  }

  private async recover(canvasId: string): Promise<void> {
    try {
      for (const intent of await new ProjectRenameJournal(this.files.root).entries(canvasId)) await this.reconcile(intent);
    } catch (error) { throw this.pending(error); }
  }

  private async reconcile(intent: ProjectRenameIntent): Promise<void> {
    // getCanvas can reflect a failed disk write. Establish durability before
    // treating its title as authority or removing the recovery record.
    await this.repository.flush?.();
    const canvas = await this.repository.getCanvas(intent.canvasId);
    if (!canvas || (canvas.title !== intent.oldTitle && canvas.title !== intent.newTitle)) throw new Error("数据库标题与重命名意图不一致");
    const canvases = await this.repository.listCanvasTitles();
    const reserved = new Set([projectTitleKey(intent.oldTitle), projectTitleKey(intent.newTitle)]);
    if (canvases.some(other => other.id !== canvas.id && reserved.has(projectTitleKey(other.title)))) throw new Error("重命名目录已被其他项目占用");
    const rootStat = await lstat(this.files.root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("项目根目录不安全");
    const candidates = new Set([intent.oldFolder, intent.newFolder, intent.temporaryFolder]);
    const entries = (await readdir(this.files.root, { withFileTypes: true })).filter(entry => candidates.has(entry.name));
    if (entries.length !== 1) throw new Error(entries.length ? "旧目录、新目录或临时目录同时存在" : "原项目目录缺失");
    const source = entries[0]!;
    const path = this.files.projectDirectory(source.name);
    const details = await lstat(path);
    if (source.isSymbolicLink() || details.isSymbolicLink() || !details.isDirectory() ||
      relative(await realpath(this.files.root), await realpath(path)) !== source.name) throw new Error("项目目录路径安全检查失败");
    if (details.dev !== intent.sourceIdentity.dev || details.ino !== intent.sourceIdentity.ino || details.birthtimeMs !== intent.sourceIdentity.birthtimeMs) {
      throw new Error("原项目目录已被替换，不能自动移动现有目录");
    }
    const desired = normalizeProjectName(canvas.title);
    if (source.name !== desired) await this.files.renameProject(source.name, canvas.title, {
      requireSource: true, temporaryProjectName: intent.temporaryFolder,
    });
    await new ProjectRenameJournal(this.files.root).clear(intent.canvasId);
  }

  ensureDefaultCanvas(): Promise<CanvasRecord> {
    return this.run(async () => {
      const existing = await this.repository.listCanvasTitles();
      if (!existing.length && (await new ProjectRenameJournal(this.files.root).entries()).length) throw this.pending(new Error("存在待处理的项目重命名，不能创建默认项目"));
      const canvas = await this.repository.ensureDefaultCanvas();
      if (!existing.some(previous => previous.id === canvas.id)) await this.files.ensureProject(canvas.title);
      return canvas;
    });
  }

  async saveCanvas(input: Parameters<Repository["saveCanvas"]>[0], ensureDirectory = false): Promise<CanvasRecord> {
    const current = await this.repository.getCanvas(input.id);
    if (current && (input.title === undefined || input.title === current.title)) {
      // Do not put graph saves behind directory streams or the name queue. An
      // internal CAS and omitted title prevent concurrent delete resurrection
      // and stale autosaves from silently undoing a completed rename.
      const saved = await this.repository.saveCanvas({ ...input, title: undefined, expectedRevision: input.expectedRevision ?? current.revision });
      if (ensureDirectory) await this.withCanvas(saved.id, async () => {
        const latest = await this.repository.getCanvas(saved.id);
        if (!latest) throw new ProjectMutationError("项目不存在", 404);
        await this.files.ensureProject(latest.title);
      });
      return saved;
    }
    return this.run(async () => {
      const [canvases, previous] = await Promise.all([this.repository.listCanvasTitles(), this.repository.getCanvas(input.id)]);
      const title = input.title ?? previous?.title ?? "未命名画布";
      // Let the repository preserve its revision conflict / lost-response path.
      const revisionMatches = input.expectedRevision === undefined || input.expectedRevision === (previous?.revision ?? 0);
      const pendingNames = await new ProjectRenameJournal(this.files.root).entries();
      if (pendingNames.some(intent => intent.canvasId !== input.id &&
        [projectTitleKey(intent.oldTitle), projectTitleKey(intent.newTitle)].includes(projectTitleKey(title)))) {
        throw this.pending(new Error("该名称仍由未完成的重命名保留"));
      }
      if (revisionMatches && (!previous || title !== previous.title) &&
        (projectTitleKey(title) === ".supercanvas-meta" || previous && projectTitleKey(previous.title) === ".supercanvas-meta")) {
        throw new ProjectMutationError("该名称保留给项目恢复元数据，请换一个项目名称");
      }
      if (revisionMatches && (!previous || title !== previous.title) && canvases.some(canvas =>
        canvas.id !== input.id && projectTitleKey(canvas.title) === projectTitleKey(title))) {
        throw new ProjectMutationError("项目名称已存在，请换一个名称");
      }
      if (revisionMatches && previous && title !== previous.title && normalizeProjectName(title) !== normalizeProjectName(previous.title)) {
        if (canvases.some(canvas => projectTitleKey(canvas.title) === ".supercanvas-meta")) {
          throw new ProjectMutationError("历史项目占用了恢复元数据保留目录，不能自动重命名");
        }
        if (canvases.some(canvas => canvas.id !== previous.id && projectTitleKey(canvas.title) === projectTitleKey(previous.title))) {
          throw new ProjectMutationError("历史同名项目共用文件夹，无法安全重命名");
        }
        if ((await this.repository.listRuns(previous.id)).some(run => run.status === "queued" || run.status === "running")) {
          throw new ProjectMutationError("当前项目仍有生成任务运行，请等待任务结束后再重命名");
        }
        const operationId = randomUUID();
        const originalDirectory = await lstat(this.files.projectDirectory(previous.title)).catch(() => null);
        if (!originalDirectory || originalDirectory.isSymbolicLink() || !originalDirectory.isDirectory()) throw this.pending(new Error("原项目目录缺失或不安全"));
        const intent: ProjectRenameIntent = {
          version: 1, operationId, canvasId: previous.id, expectedRevision: previous.revision,
          oldTitle: previous.title, newTitle: title, oldFolder: normalizeProjectName(previous.title),
          newFolder: normalizeProjectName(title), temporaryFolder: `.project-rename-${operationId}`, createdAt: new Date().toISOString(),
          sourceIdentity: { dev: originalDirectory.dev, ino: originalDirectory.ino, birthtimeMs: originalDirectory.birthtimeMs },
        };
        let prepared = false;
        try {
          await new ProjectRenameJournal(this.files.root).write(intent);
          prepared = true;
          await this.files.renameProject(previous.title, title, { requireSource: true, temporaryProjectName: intent.temporaryFolder });
          const saved = await this.repository.saveCanvas(input);
          await this.reconcile(intent);
          return saved;
        } catch (error) {
          // A failed save may have changed memory. Never assume rollback, and
          // never discard the durable intent merely because memory says new.
          if (prepared) try { await this.reconcile(intent); } catch { /* Keep evidence for the next access/start. */ }
          throw this.pending(error);
        }
      }
      const saved = await this.repository.saveCanvas(input);
      if (ensureDirectory || !previous) await this.files.ensureProject(saved.title);
      return saved;
    }, input.id);
  }
}

const globalKey = "__superCanvasProjectCoordinators";

export function projectCoordinator(repository: Repository): ProjectCoordinator {
  const files = getProjectFileStore();
  const scope = globalThis as typeof globalThis & { [globalKey]?: Map<unknown, ProjectCoordinator> };
  const coordinators = scope[globalKey] ??= new Map();
  // The root is stable across route-module reloads; test stores may omit it.
  const key = files.root ?? repository;
  let coordinator = coordinators.get(key);
  if (!coordinator) {
    coordinator = new ProjectCoordinator(repository, files);
    coordinators.set(key, coordinator);
  }
  return coordinator;
}
