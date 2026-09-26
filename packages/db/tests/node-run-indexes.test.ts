import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/memory.js";
import type { NodeRunRecord } from "../src/types.js";

async function fixture() {
  const repository = new MemoryRepository();
  for (const id of ["old", "new", "other"]) {
    await repository.createRun({
      id,
      canvasId: id === "other" ? "other-canvas" : "canvas",
      clientRequestId: id,
      scope: "all",
      status: "succeeded",
      revisionGraph: {},
    });
  }
  for (const id of ["old", "new", "other"]) {
    await repository.createNodeRun({
      id,
      workflowRunId: id,
      nodeId: "image",
      status: "succeeded",
      attempt: 1,
      providerTaskId: null,
      inputJson: {},
      outputAssetIds: [id],
      errorJson: null,
    });
  }
  const snapshot = repository.exportSnapshot();
  snapshot.nodeRuns.forEach((record, i) => {
    record.updatedAt = new Date(i * 1000).toISOString();
  });
  return new MemoryRepository(snapshot);
}

describe("node run query indexes", () => {
  it("restores indexes and keeps query results isolated from caller mutation", async () => {
    const repository = await fixture();
    const rows = await repository.listNodeRuns("new");
    rows[0]!.outputAssetIds.push("mutated");
    expect(await repository.listNodeRuns("new")).toHaveLength(1);
    expect(
      await repository.findLatestSucceededNodeRun("canvas", "image"),
    ).toMatchObject({ id: "new", outputAssetIds: ["new"] });
    expect(
      await repository.findLatestSucceededNodeRun("other-canvas", "image"),
    ).toMatchObject({ id: "other" });
  });

  it("invalidates a cached winner and negative lookup when outputs change", async () => {
    const repository = await fixture();
    expect(
      (await repository.findLatestSucceededNodeRun("canvas", "image"))?.id,
    ).toBe("new");
    await repository.updateNodeRun("new", { outputAssetIds: [] });
    expect(
      (await repository.findLatestSucceededNodeRun("canvas", "image"))?.id,
    ).toBe("old");
    await repository.updateNodeRun("old", { status: "failed" });
    expect(
      await repository.findLatestSucceededNodeRun("canvas", "image"),
    ).toBeNull();
    await repository.updateNodeRun("new", { outputAssetIds: ["restored"] });
    expect(
      (await repository.findLatestSucceededNodeRun("canvas", "image"))?.id,
    ).toBe("new");
  });

  it("moves membership on identity updates and clears deleted canvas indexes", async () => {
    const repository = await fixture();
    await repository.findLatestSucceededNodeRun("canvas", "image");
    await repository.updateNodeRun("new", {
      workflowRunId: "other",
      nodeId: "moved",
    });
    expect(await repository.listNodeRuns("new")).toEqual([]);
    expect(
      (await repository.listNodeRuns("other")).map((row) => row.id),
    ).toEqual(["other", "new"]);
    expect(
      (await repository.findLatestSucceededNodeRun("canvas", "image"))?.id,
    ).toBe("old");
    expect(
      (await repository.findLatestSucceededNodeRun("other-canvas", "moved"))
        ?.id,
    ).toBe("new");
    await repository.deleteCanvas("other-canvas");
    expect(await repository.listNodeRuns("other")).toEqual([]);
    expect(
      await repository.findLatestSucceededNodeRun("other-canvas", "moved"),
    ).toBeNull();
    expect(
      (await repository.findLatestSucceededNodeRun("canvas", "image"))?.id,
    ).toBe("old");
  });

  it("keeps idempotent creation and restores orphan membership when its run arrives", async () => {
    const repository = new MemoryRepository();
    const input: Omit<NodeRunRecord, "createdAt" | "updatedAt"> = {
      id: "first",
      workflowRunId: "later",
      nodeId: "image",
      status: "succeeded",
      attempt: 1,
      providerTaskId: null,
      inputJson: {},
      outputAssetIds: ["asset"],
      errorJson: null,
    };
    await repository.createNodeRun(input);
    expect(
      (await repository.createNodeRun({ ...input, id: "duplicate" })).id,
    ).toBe("first");
    await repository.createRun({
      id: "later",
      canvasId: "canvas",
      clientRequestId: "later",
      scope: "all",
      status: "succeeded",
      revisionGraph: {},
    });
    expect(
      (await repository.findLatestSucceededNodeRun("canvas", "image"))?.id,
    ).toBe("first");
  });
});
