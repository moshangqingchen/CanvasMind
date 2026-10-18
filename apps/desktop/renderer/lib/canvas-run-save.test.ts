import { describe, expect, it, vi } from "vitest";
import { canvasChangedBeforeRunMessage, saveCanvasForRun } from "./canvas-run-save";
import { LatestTaskQueue } from "./latest-task-queue";

interface SaveRequest {
  graph: string;
  onSavedRevision?: (revision: number) => void;
}

describe("the saved canvas revision used for a run", () => {
  it("does not submit when the click's queued save is replaced by a later edit", async () => {
    let releasePrevious!: () => void;
    const previousGate = new Promise<void>((resolve) => { releasePrevious = resolve; });
    let revision = 1;
    const savedGraphs: string[] = [];
    const queue = new LatestTaskQueue<SaveRequest>(async (request) => {
      if (request.graph === "previous") await previousGate;
      savedGraphs.push(request.graph);
      request.onSavedRevision?.(++revision);
    });
    const submit = vi.fn();

    const previousSave = queue.enqueue({ graph: "previous" });
    const run = saveCanvasForRun((onSavedRevision) =>
      queue.enqueue({ graph: "P1", onSavedRevision }),
    ).then(submit);
    const laterSave = queue.enqueue({ graph: "P2" });
    const rejection = expect(run).rejects.toThrow(canvasChangedBeforeRunMessage);
    releasePrevious();
    await Promise.all([previousSave, laterSave, rejection]);

    expect(savedGraphs).toEqual(["previous", "P2"]);
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps P1's receipt even if P2 has already advanced the shared revision", async () => {
    let releaseClick!: () => void;
    const clickGate = new Promise<void>((resolve) => { releaseClick = resolve; });
    let sharedRevision = 7;
    const queue = new LatestTaskQueue<SaveRequest>(async (request) => {
      if (request.graph === "P1") await clickGate;
      sharedRevision += 1;
      request.onSavedRevision?.(sharedRevision);
    });

    const clickedRevision = saveCanvasForRun((onSavedRevision) =>
      queue.enqueue({ graph: "P1", onSavedRevision }),
    );
    const laterSave = queue.enqueue({ graph: "P2" });
    releaseClick();
    const [expectedRevision] = await Promise.all([clickedRevision, laterSave]);

    expect(sharedRevision).toBe(9);
    expect(expectedRevision).toBe(8);
  });

  it("uses the successful save receipt on the unchanged normal path", async () => {
    const queue = new LatestTaskQueue<SaveRequest>(async (request) => {
      request.onSavedRevision?.(12);
    });

    await expect(saveCanvasForRun((onSavedRevision) =>
      queue.enqueue({ graph: "P1", onSavedRevision }),
    )).resolves.toBe(12);
  });
});
