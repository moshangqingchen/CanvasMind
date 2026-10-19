import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryRepository } from "@super-canvas/db";
import { ProjectFileStore } from "@super-canvas/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectCoordinator } from "./project-coordinator";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "supercanvas-project-coordinator-"));
  roots.push(root);
  const repository = new MemoryRepository();
  const files = new ProjectFileStore({ root });
  return { root, repository, files, coordinator: new ProjectCoordinator(repository, files) };
}
const graph = { schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("project identity coordination", () => {
  it("reads only the target canvas for graph-only saves and keeps revision CAS", async () => {
    const { coordinator, repository } = await fixture();
    const canvas = await coordinator.saveCanvas({ id: "target", title: "Target", graph });
    const list = vi.spyOn(repository, "listCanvases").mockRejectedValue(new Error("Full canvas listing forbidden"));
    const titles = vi.spyOn(repository, "listCanvasTitles").mockRejectedValue(new Error("Names are not needed for a graph-only save"));
    const get = vi.spyOn(repository, "getCanvas");
    const saved = await coordinator.saveCanvas({ id: canvas.id, title: canvas.title, graph: { ...graph, viewport: { x: 20, y: 0, zoom: 1 } }, expectedRevision: canvas.revision });
    expect(get).toHaveBeenCalledWith(canvas.id);
    expect(list).not.toHaveBeenCalled();
    expect(titles).not.toHaveBeenCalled();
    await expect(coordinator.saveCanvas({ id: canvas.id, graph, expectedRevision: canvas.revision })).rejects.toMatchObject({ code: "CANVAS_REVISION_CONFLICT" });
    expect(saved.revision).toBe(canvas.revision + 1);
  });
  it("rejects a shared-to-exclusive lock upgrade without waiting on itself or poisoning later changes", async () => {
    const { coordinator } = await fixture();
    const canvas = await coordinator.saveCanvas({ id: "a", title: "原名", graph });
    await expect(coordinator.withCanvas(canvas.id, () => coordinator.saveCanvas({ id: canvas.id, title: "新名", graph, expectedRevision: canvas.revision }))).rejects.toThrow("升级");
    await expect(coordinator.saveCanvas({ id: canvas.id, title: "新名", graph, expectedRevision: canvas.revision })).resolves.toMatchObject({ title: "新名" });
  });
  it("reserves recovery metadata names and never puts a journal into a legacy project's directory", async () => {
    const { coordinator, repository, root } = await fixture();
    await expect(coordinator.saveCanvas({ id: "reserved", title: ".SUPERCANVAS-META", graph })).rejects.toMatchObject({ status: 409 });
    await repository.saveCanvas({ id: "legacy", title: ".supercanvas-meta", graph });
    const canvas = await coordinator.saveCanvas({ id: "normal", title: "普通项目", graph });
    await expect(coordinator.saveCanvas({ id: canvas.id, title: "新标题", graph, expectedRevision: canvas.revision })).rejects.toThrow("恢复元数据保留目录");
    expect(await readdir(root)).toEqual(["普通项目"]);
  });
  it("admits exactly one concurrent normalized-name create and one directory", async () => {
    const { coordinator, repository, root } = await fixture();
    const results = await Promise.allSettled([
      coordinator.saveCanvas({ id: "a", title: "  同名项目  ", graph }, true),
      coordinator.saveCanvas({ id: "b", title: "同名项目", graph }, true),
    ]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(results[1]).toMatchObject({ reason: { status: 409 } });
    expect(await repository.listCanvases()).toHaveLength(1);
    expect(await readdir(root)).toEqual(["同名项目"]);
  });

  it("shares name reservations between a canvas upsert and a project rename", async () => {
    const { coordinator, repository } = await fixture();
    const prior = await coordinator.saveCanvas({ id: "a", title: "原名", graph }, true);
    const results = await Promise.allSettled([
      coordinator.saveCanvas({ id: "b", title: "目标", graph }, true),
      coordinator.saveCanvas({ id: prior.id, title: "目标", graph, expectedRevision: prior.revision }),
    ]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect((await repository.listCanvases()).filter(canvas => canvas.title === "目标")).toHaveLength(1);
  });

  it("does not release a deleted name until removal of its old directory completes", async () => {
    const { coordinator, repository, files, root } = await fixture();
    const prior = await coordinator.saveCanvas({ id: "old", title: "复用", graph }, true);
    let release!: () => void;
    let deleted!: () => void;
    const removedRecord = new Promise<void>(resolve => { deleted = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const deletion = coordinator.run(async () => {
      await repository.deleteCanvas(prior.id); deleted(); await hold;
      await files.deleteProject(prior.title);
    }, prior.id);
    await removedRecord;
    let created = false;
    const creation = coordinator.saveCanvas({ id: "new", title: "复用", graph }, true).then(canvas => { created = true; return canvas; });
    await Promise.resolve();
    expect(created).toBe(false);
    release();
    await Promise.all([deletion, creation]);
    expect(await repository.listCanvases()).toMatchObject([{ id: "new" }]);
    expect(await readdir(root)).toEqual(["复用"]);
  });

  it.each([["é", "e\u0301"], ["a/b", "a\\b"], ["A", "a"], ["x".repeat(121), "x".repeat(120)]])(
    "uses the same filesystem normalization for %s and %s", async (a, b) => {
      const { coordinator } = await fixture();
      await coordinator.saveCanvas({ id: "a", title: a, graph });
      await expect(coordinator.saveCanvas({ id: "b", title: b, graph })).rejects.toMatchObject({ status: 409 });
    },
  );

  it("keeps legacy duplicate graph saves and revision conflict semantics", async () => {
    const { coordinator, repository } = await fixture();
    const a = await repository.saveCanvas({ id: "a", title: "历史", graph });
    await repository.saveCanvas({ id: "b", title: "历史", graph });
    await expect(coordinator.saveCanvas({ id: "a", graph, reason: "autosave", expectedRevision: a.revision })).resolves.toMatchObject({ id: "a" });
    await expect(coordinator.saveCanvas({ id: "a", title: "历史", graph, expectedRevision: 0 })).rejects.toMatchObject({ code: "CANVAS_REVISION_CONFLICT" });
  });
});
