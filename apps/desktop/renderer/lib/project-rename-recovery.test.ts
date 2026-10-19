import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rename, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileRepository, MemoryRepository, type CanvasRecord } from "@super-canvas/db";
import { ProjectFileStore, normalizeProjectName } from "@super-canvas/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectCoordinator } from "./project-coordinator";
import { ProjectRenameJournal, type ProjectRenameIntent } from "./project-rename-journal";

const roots: string[] = [];
const graph = { schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "supercanvas-project-rename-")); roots.push(root);
  const projectRoot = join(root, "projects"); await mkdir(projectRoot);
  const database = join(root, "database.json");
  const repository = new FileRepository(database);
  const files = new ProjectFileStore({ root: projectRoot });
  const coordinator = new ProjectCoordinator(repository, files);
  const canvas = await coordinator.saveCanvas({ id: "canvas", title: "旧名", graph }, true);
  await files.archiveDraft({ projectName: canvas.title, assetId: "asset", name: "original.png", kind: "image", mimeType: "image/png", bytes: Buffer.from("original bytes"), source: "external" });
  return { root, projectRoot, database, repository, files, coordinator, canvas, journal: new ProjectRenameJournal(projectRoot) };
}
async function intent(f: Awaited<ReturnType<typeof fixture>>, title = "新名"): Promise<ProjectRenameIntent> {
  const canvas: CanvasRecord = f.canvas;
  const original = await lstat(f.files.projectDirectory(canvas.title));
  const operationId = randomUUID();
  return { version: 1, operationId, canvasId: canvas.id, expectedRevision: canvas.revision,
    oldTitle: canvas.title, newTitle: title, oldFolder: normalizeProjectName(canvas.title), newFolder: normalizeProjectName(title),
    temporaryFolder: `.project-rename-${operationId}`, createdAt: new Date().toISOString(),
    sourceIdentity: { dev: original.dev, ino: original.ino, birthtimeMs: original.birthtimeMs } };
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("durable project rename recovery", () => {
  it("creates the directory for a direct canvas upsert before its immediate rename", async () => {
    const f = await fixture();
    const direct = await f.coordinator.saveCanvas({ id: "direct", title: "直接创建", graph });
    const renamed = await f.coordinator.saveCanvas({ id: direct.id, title: "随即改名", graph, expectedRevision: direct.revision });
    expect(renamed.title).toBe("随即改名");
    expect(await readdir(f.projectRoot)).toContain("随即改名");
    expect(await readdir(f.projectRoot)).not.toContain("直接创建");
  });

  it("saves an imported graph and its changed title through one revision-checked rename", async () => {
    const f = await fixture();
    const importedGraph = { ...graph, viewport: { x: 30, y: 20, zoom: 0.5 } };
    const saved = await f.coordinator.saveCanvas({ id: f.canvas.id, title: "导入标题", graph: importedGraph, reason: "autosave", expectedRevision: f.canvas.revision });
    expect(await new FileRepository(f.database).getCanvas(f.canvas.id)).toMatchObject({ title: "导入标题", graph: importedGraph, revision: saved.revision });
    expect((await f.files.listFiles("导入标题")).files).toHaveLength(1);
    expect(await f.journal.entries()).toEqual([]);
  });

  it("performs case-only renames without losing the recorded temporary-folder recovery path", async () => {
    const f = await fixture();
    const initial = await f.coordinator.saveCanvas({ id: f.canvas.id, title: "MixedCase", graph, expectedRevision: f.canvas.revision });
    await f.coordinator.saveCanvas({ id: f.canvas.id, title: "mixedcase", graph, expectedRevision: initial.revision });
    expect((await f.files.listFiles("mixedcase")).files).toHaveLength(1);
    expect(await readdir(f.projectRoot)).not.toContain("MixedCase");
    expect(await f.journal.entries()).toEqual([]);
  });

  it("holds a canvas-addressed archive through its title lookup and write, then moves all files", async () => {
    const f = await fixture();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const archive = f.coordinator.withCanvas(f.canvas.id, async () => {
      const canvas = (await f.repository.getCanvas(f.canvas.id))!;
      entered(); await hold;
      await f.files.archiveDraft({ projectName: canvas.title, assetId: "late", name: "late.png", kind: "image", mimeType: "image/png", bytes: Buffer.from("late original"), source: "external" });
    });
    await started;
    const renamed = f.coordinator.saveCanvas({ id: f.canvas.id, title: "新名", graph, expectedRevision: f.canvas.revision });
    release(); await Promise.all([archive, renamed]);
    expect((await f.files.listFiles("新名")).files).toHaveLength(2);
    expect(await readdir(f.projectRoot)).not.toContain("旧名");
  });

  it("lets another project's graph save and file read finish while a stream and rename wait on A", async () => {
    const f = await fixture();
    const b = await f.coordinator.saveCanvas({ id: "independent", title: "独立项目", graph });
    let started!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const archive = f.coordinator.withCanvas(f.canvas.id, () => f.files.archiveDraft({
      projectName: f.canvas.title, assetId: "large", name: "large.png", kind: "image", mimeType: "image/png", source: "external",
      bytes: (async function* () { started(); await hold; yield Buffer.from("original stream"); })(),
    }));
    await entered;
    const renameA = f.coordinator.saveCanvas({ id: f.canvas.id, title: "新名", graph, expectedRevision: f.canvas.revision });
    let savedB = false, readB = false, createdC = false;
    const save = f.coordinator.saveCanvas({ id: b.id, title: b.title, graph: { ...graph, viewport: { x: 20, y: 0, zoom: 1 } }, expectedRevision: b.revision }).then(() => { savedB = true; });
    const read = f.coordinator.withCanvas(b.id, () => f.files.listFiles(b.title)).then(() => { readB = true; });
    const create = f.coordinator.saveCanvas({ id: "new-independent", title: "另一个新项目", graph }).then(() => { createdC = true; });
    try { await vi.waitFor(() => expect({ savedB, readB, createdC }).toEqual({ savedB: true, readB: true, createdC: true })); }
    finally { release(); await Promise.all([archive, renameA, save, read, create]); }
    expect(await readdir(f.projectRoot)).not.toContain("旧名");
  });

  it("keeps different archives in one canvas concurrent under shared file leases", async () => {
    const f = await fixture();
    let started!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const first = f.coordinator.withCanvas(f.canvas.id, () => f.files.archiveDraft({
      projectName: f.canvas.title, assetId: "held", name: "held.png", kind: "image", mimeType: "image/png", source: "external",
      bytes: (async function* () { started(); await hold; yield Buffer.from("held"); })(),
    }));
    await entered;
    let completed = false;
    const second = f.coordinator.withCanvas(f.canvas.id, () => f.files.archiveDraft({
      projectName: f.canvas.title, assetId: "parallel", name: "parallel.png", kind: "image", mimeType: "image/png", source: "external", bytes: Buffer.from("parallel"),
    })).then(() => { completed = true; });
    try { await vi.waitFor(() => expect(completed).toBe(true)); }
    finally { release(); await Promise.all([first, second]); }
    expect((await f.files.listFiles(f.canvas.title)).files).toHaveLength(3);
  });

  it.each(["rename", "delete"])("does not let a legacy graph save undo a concurrent %s", async operation => {
    const f = await fixture();
    const original = f.repository.listCanvases.bind(f.repository);
    let captured!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { captured = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(f.repository, "listCanvases").mockImplementationOnce(async () => { const value = await original(); captured(); await hold; return value; });
    const saving = f.coordinator.saveCanvas({ id: f.canvas.id, title: f.canvas.title, graph, reason: "autosave" });
    // Attach rejection handling before releasing the old snapshot.
    const result = saving.then(value => ({ value }), error => ({ error }));
    await entered;
    if (operation === "rename") await f.coordinator.saveCanvas({ id: f.canvas.id, title: "新名", graph, expectedRevision: f.canvas.revision });
    else await f.coordinator.run(async () => { await f.repository.deleteCanvas(f.canvas.id); await f.files.deleteProject(f.canvas.title); }, f.canvas.id);
    release();
    expect(await result).toMatchObject({ error: { code: "CANVAS_REVISION_CONFLICT" } });
    expect((await f.repository.getCanvas(f.canvas.id))?.title).toBe(operation === "rename" ? "新名" : undefined);
    expect(await readdir(f.projectRoot)).not.toContain("旧名");
  });

  it("reopens a folder-first interruption before any ensure can recreate the old empty folder", async () => {
    const f = await fixture(); const pending = await intent(f); await f.journal.write(pending);
    await f.files.renameProject(f.canvas.title, pending.newTitle);
    const reopened = new FileRepository(f.database);
    const files = new ProjectFileStore({ root: f.projectRoot });
    await new ProjectCoordinator(reopened, files).run(async () => {
      const current = (await reopened.getCanvas(f.canvas.id))!;
      await files.ensureProject(current.title);
    }, f.canvas.id);
    expect(await readFile(join(f.projectRoot, "旧名", "草稿", "外界素材", "图片", "original--asset.png"), "utf8")).toBe("original bytes");
    expect(await readdir(f.projectRoot)).toEqual(expect.arrayContaining(["旧名", ".supercanvas-meta"]));
    expect(await readdir(f.projectRoot)).not.toContain("新名");
    expect(await f.journal.entries()).toEqual([]);
  });

  it("keeps the committed new title and files when interrupted before journal removal", async () => {
    const f = await fixture(); const pending = await intent(f); await f.journal.write(pending);
    await f.files.renameProject(f.canvas.title, pending.newTitle);
    await f.repository.saveCanvas({ id: f.canvas.id, title: pending.newTitle, graph, expectedRevision: f.canvas.revision });
    const reopened = new FileRepository(f.database);
    await new ProjectCoordinator(reopened, new ProjectFileStore({ root: f.projectRoot })).run(async () => undefined, f.canvas.id);
    expect((await reopened.getCanvas(f.canvas.id))?.title).toBe("新名");
    expect((await f.files.listFiles("新名")).files).toHaveLength(1);
    expect(await f.journal.entries()).toEqual([]);
  });

  it("does not mistake a failed in-memory title for a durable commit", async () => {
    const f = await fixture(); let unavailable = true;
    const failing = new FileRepository(f.database, async (from, to) => {
      if (unavailable) throw new Error("disk unavailable");
      await rename(from, to);
    });
    await expect(new ProjectCoordinator(failing, f.files).saveCanvas({ id: f.canvas.id, title: "新名", graph, expectedRevision: f.canvas.revision })).rejects.toMatchObject({ code: "PROJECT_RENAME_PENDING" });
    expect((await failing.getCanvas(f.canvas.id))?.title).toBe("新名");
    expect((await new FileRepository(f.database).getCanvas(f.canvas.id))?.title).toBe("旧名");
    expect(await f.journal.entries()).toHaveLength(1);
    unavailable = false;
    const reopened = new FileRepository(f.database);
    await new ProjectCoordinator(reopened, new ProjectFileStore({ root: f.projectRoot })).run(async () => undefined, f.canvas.id);
    expect((await f.files.listFiles("旧名")).files).toHaveLength(1);
    expect(await readdir(f.projectRoot)).not.toContain("新名");
  });

  it("aligns with a failed save whose subsequent flush commits the new title", async () => {
    const f = await fixture(); let failures = 1;
    const repository = new FileRepository(f.database, async (from, to) => {
      if (failures-- > 0) throw new Error("one failed disk write");
      await rename(from, to);
    });
    await expect(new ProjectCoordinator(repository, f.files).saveCanvas({ id: f.canvas.id, title: "新名", graph, expectedRevision: f.canvas.revision })).rejects.toMatchObject({ code: "PROJECT_RENAME_PENDING" });
    expect((await new FileRepository(f.database).getCanvas(f.canvas.id))?.title).toBe("新名");
    expect((await f.files.listFiles("新名")).files).toHaveLength(1);
    expect(await f.journal.entries()).toEqual([]);
  });

  it("preserves the intent when reverse rename fails and reports pending recovery", async () => {
    const f = await fixture();
    const repository = new MemoryRepository(); await repository.saveCanvas({ id: f.canvas.id, title: f.canvas.title, graph });
    vi.spyOn(repository, "saveCanvas").mockRejectedValue(new Error("save rejected before mutation"));
    const original = f.files.renameProject.bind(f.files);
    vi.spyOn(f.files, "renameProject").mockImplementation((a, b, options) => a === "新名" ? Promise.reject(new Error("folder occupied")) : original(a, b, options));
    await expect(new ProjectCoordinator(repository, f.files).saveCanvas({ id: f.canvas.id, title: "新名", graph })).rejects.toThrow("待恢复");
    expect(await f.journal.entries()).toHaveLength(1);
    expect((await f.files.listFiles("新名")).files).toHaveLength(1);
  });

  it("recovers the recorded Windows two-hop temporary folder after an interruption", async () => {
    const f = await fixture(); const pending = await intent(f, "旧名ABC"); await f.journal.write(pending);
    await rename(f.files.projectDirectory(pending.oldTitle), f.files.projectDirectory(pending.temporaryFolder));
    await new ProjectCoordinator(new FileRepository(f.database), new ProjectFileStore({ root: f.projectRoot })).run(async () => undefined, f.canvas.id);
    expect((await f.files.listFiles("旧名")).files).toHaveLength(1);
    expect(await readdir(f.projectRoot)).not.toContain(pending.temporaryFolder);
  });

  it.each(["both folders", "missing source", "other owner", "third title", "replaced source"])("leaves all evidence untouched on %s", async scenario => {
    const f = await fixture(); const pending = await intent(f); await f.journal.write(pending);
    if (scenario === "both folders") await f.files.ensureProject(pending.newTitle);
    if (scenario === "missing source") await rm(f.files.projectDirectory(pending.oldTitle), { recursive: true });
    if (scenario === "other owner") await f.repository.saveCanvas({ id: "other", title: pending.newTitle, graph });
    if (scenario === "third title") await f.repository.saveCanvas({ id: f.canvas.id, title: "第三个标题", graph });
    if (scenario === "replaced source") {
      await rename(f.files.projectDirectory(pending.oldTitle), join(f.root, "original-evidence"));
      await f.files.ensureProject(pending.oldTitle);
    }
    const before = await readdir(f.projectRoot);
    await expect(new ProjectCoordinator(new FileRepository(f.database), new ProjectFileStore({ root: f.projectRoot })).run(async () => undefined, f.canvas.id)).rejects.toMatchObject({ code: "PROJECT_RENAME_PENDING" });
    expect(await readdir(f.projectRoot)).toEqual(before);
    expect(await f.journal.entries()).toHaveLength(1);
  });

  it("rejects a replaced or invalid intent instead of accepting arbitrary paths", async () => {
    const f = await fixture(); const pending = await intent(f); await f.journal.write(pending);
    const [file] = await readdir(f.journal.directory);
    await writeFile(join(f.journal.directory, file!), JSON.stringify({ ...pending, temporaryFolder: "../outside" }));
    await expect(f.coordinator.run(async () => undefined, f.canvas.id)).rejects.toThrow("待恢复");
    expect((await f.files.listFiles("旧名")).files).toHaveLength(1);
    expect(await readdir(f.journal.directory)).toHaveLength(1);
  });
});
