import { AsyncLocalStorage } from "node:async_hooks";
import type { CanvasRecord, Repository } from "@super-canvas/db";
import { getProjectFileStore, normalizeProjectName, type ProjectFileStore } from "@super-canvas/storage";

export class ProjectMutationError extends Error {
  constructor(message: string, readonly status = 409, readonly code = "PROJECT_NAME_CONFLICT") {
    super(message);
  }
}

export function projectTitleKey(title: string): string {
  return normalizeProjectName(title).normalize("NFC").toLocaleLowerCase();
}

/** One API worker owns a repository. Keep directory identity changes in the
 * same queue, including deletion until the old directory is actually removed. */
export class ProjectCoordinator {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly scope = new AsyncLocalStorage<boolean>();

  constructor(readonly repository: Repository, readonly files: ProjectFileStore) {}

  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.scope.getStore()) return work();
    const pending = this.tail.catch(() => undefined).then(() => this.scope.run(true, work));
    this.tail = pending;
    return pending;
  }

  async saveCanvas(input: Parameters<Repository["saveCanvas"]>[0], ensureDirectory = false): Promise<CanvasRecord> {
    return this.run(async () => {
      const canvases = await this.repository.listCanvases();
      const previous = canvases.find(canvas => canvas.id === input.id);
      const title = input.title ?? previous?.title ?? "未命名画布";
      // Let the repository preserve its revision conflict / lost-response path.
      const revisionMatches = input.expectedRevision === undefined || input.expectedRevision === (previous?.revision ?? 0);
      if (revisionMatches && (!previous || title !== previous.title) && canvases.some(canvas =>
        canvas.id !== input.id && projectTitleKey(canvas.title) === projectTitleKey(title))) {
        throw new ProjectMutationError("项目名称已存在，请换一个名称");
      }
      const saved = await this.repository.saveCanvas(input);
      if (ensureDirectory) await this.files.ensureProject(saved.title);
      return saved;
    });
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
