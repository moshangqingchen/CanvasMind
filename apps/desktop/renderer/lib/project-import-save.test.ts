import { describe, expect, it, vi } from "vitest";
import { CanvasSaveConflictError, CanvasSaveRejectedError } from "./client-api";
import { confirmImportedCanvasSave, ImportSaveUncertainError } from "./project-import-save";

const graph = { schemaVersion: 1 as const, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
const saved = { id: "canvas", title: "导入", graph, revision: 2 };
describe("durable import acknowledgement", () => {
  it("requires the actual full graph and title returned by the queue", async () => {
    const save = vi.fn().mockResolvedValue({ ...saved, title: "merged other save" });
    await expect(confirmImportedCanvasSave({ expected: saved, save, read: async () => ({ ...saved, graph: { ...graph, drawings: [] } }) }))
      .rejects.toBeInstanceOf(ImportSaveUncertainError);
    expect(save).toHaveBeenCalledOnce();
  });
  it("reconfirms a committed PUT with a lost body using the durable same-graph save", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("invalid body")).mockResolvedValueOnce(saved);
    const read = vi.fn(async () => saved);
    await expect(confirmImportedCanvasSave({ expected: saved, save, read })).resolves.toEqual(saved);
    expect(save).toHaveBeenCalledTimes(2);
  });
  it.each(["negative", "failed", "dirty"])("keeps originals after a %s read, including a later explicit conflict", async kind => {
    const conflict = new CanvasSaveConflictError(3); conflict.definitelyRejected = true;
    const save = vi.fn().mockRejectedValueOnce(new Error("lost response")).mockRejectedValueOnce(conflict);
    const read = async () => {
      if (kind === "failed") throw new Error("offline");
      return kind === "negative" ? { ...saved, title: "old" } : saved;
    };
    await expect(confirmImportedCanvasSave({ expected: saved, save, read })).rejects.toBeInstanceOf(ImportSaveUncertainError);
    expect(save).toHaveBeenCalledTimes(kind === "dirty" ? 2 : 1);
  });
  it("allows rollback only for an initial certain rejection", async () => {
    const error = new CanvasSaveRejectedError("invalid input");
    const read = vi.fn();
    await expect(confirmImportedCanvasSave({ expected: saved, save: async () => { throw error; }, read })).rejects.toBe(error);
    expect(read).not.toHaveBeenCalled();
  });
  it("never accepts a suspended save with no receipt", async () => {
    await expect(confirmImportedCanvasSave({ expected: saved, save: async () => undefined, read: async () => saved }))
      .rejects.toBeInstanceOf(ImportSaveUncertainError);
  });
});
