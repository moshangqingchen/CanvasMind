import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../components/types";
import {
  applyPendingNodeConfigurations,
  clearPersistedNodeConfigurations,
  journalNodeConfiguration,
  readPendingNodeConfigurations,
  synchronizePendingNodeConfigurations,
} from "./node-configuration-journal";
import { LatestTaskQueue } from "./latest-task-queue";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function videoNode(model: string): CanvasNode {
  return {
    id: "video-1",
    type: "workflow",
    position: { x: 0, y: 0 },
    data: {
      label: "视频生成",
      nodeType: "video-generation",
      provider: "rest",
      connectionId: "connection-1",
      model,
      inputs: [{ id: "prompt", kind: "text", label: "Prompt" }],
      parameters: { duration: 15, aspect_ratio: "16:9" },
    },
  };
}

describe("node configuration refresh journal", () => {
  it("restores per-model parameter selections during an immediate refresh before the server save completes", () => {
    const storage = new MemoryStorage();
    const selected = videoNode("gpt-image-2");
    selected.data.nodeType = "image-generation";
    selected.data.modelParameterSelections = [{ connectionId: "jijiu-key", model: "gpt-image-2-2K/4K", provider: "openai",
      qualityMode: "custom", parameters: { size: "4K", quality: "high" } }];
    journalNodeConfiguration("canvas-1", selected, storage);
    const restored = applyPendingNodeConfigurations([videoNode("old")], "canvas-1", readPendingNodeConfigurations(storage));
    expect(restored[0]?.data.modelParameterSelections).toEqual(selected.data.modelParameterSelections);
  });
  it("restores a model and its derived parameters over the stale server graph", () => {
    const storage = new MemoryStorage();
    const selected = videoNode("seedance-2.0-fast");
    selected.data.qualityMode = "highest";
    const entries = journalNodeConfiguration("canvas-1", selected, storage);

    const restored = applyPendingNodeConfigurations(
      [videoNode("minimax-h3-2k")],
      "canvas-1",
      entries,
    );

    expect(restored[0]?.data).toMatchObject({
      provider: "rest",
      connectionId: "connection-1",
      model: "seedance-2.0-fast",
      qualityMode: "highest",
      parameters: { duration: 15, aspect_ratio: "16:9" },
    });
  });

  it("keeps a newer selection when an older save finishes later", () => {
    const storage = new MemoryStorage();
    const older = journalNodeConfiguration(
      "canvas-1",
      videoNode("happyhouse-1.1"),
      storage,
    );
    journalNodeConfiguration(
      "canvas-1",
      videoNode("seedance-2.0-fast"),
      storage,
    );

    clearPersistedNodeConfigurations(older, storage);

    expect(readPendingNodeConfigurations(storage)).toHaveLength(1);
    expect(readPendingNodeConfigurations(storage)[0]?.data.model).toBe(
      "seedance-2.0-fast",
    );
  });

  it("clears only the discarded canvas configurations", () => {
    const storage = new MemoryStorage();
    const discarded = journalNodeConfiguration(
      "canvas-discarded",
      videoNode("seedance-2.0-fast"),
      storage,
    );
    journalNodeConfiguration(
      "canvas-kept",
      { ...videoNode("minimax-h3-2k"), id: "video-2" },
      storage,
    );

    clearPersistedNodeConfigurations(
      readPendingNodeConfigurations(storage).filter(
        (entry) => entry.canvasId === "canvas-discarded",
      ),
      storage,
    );

    expect(discarded).toHaveLength(1);
    expect(readPendingNodeConfigurations(storage)).toEqual([
      expect.objectContaining({ canvasId: "canvas-kept" }),
    ]);
  });

  it("persists an undo after a failed configuration save without restoring the old journal on reload", () => {
    const storage = new MemoryStorage();
    const original = videoNode("model-a");
    const failed = journalNodeConfiguration("canvas-1", videoNode("model-b"), storage);

    const undone = synchronizePendingNodeConfigurations("canvas-1", [original], storage);
    expect(undone[0]?.token).not.toBe(failed[0]?.token);
    expect(applyPendingNodeConfigurations([videoNode("model-b")], "canvas-1", readPendingNodeConfigurations(storage))[0]?.data.model).toBe("model-a");

    // A full manual/autosave request captures the same token even though it
    // was not initiated by a connection/model selector.
    const retry = synchronizePendingNodeConfigurations("canvas-1", [original], storage);
    expect(retry[0]?.token).toBe(undone[0]?.token);
    clearPersistedNodeConfigurations(retry, storage);
    expect(readPendingNodeConfigurations(storage)).toEqual([]);
    expect(applyPendingNodeConfigurations([original], "canvas-1", readPendingNodeConfigurations(storage))[0]?.data.model).toBe("model-a");
  });

  it("retains a redo and a newer model choice while older snapshots finish saving", () => {
    const storage = new MemoryStorage();
    const selected = journalNodeConfiguration("canvas-1", videoNode("model-b"), storage);
    const undone = synchronizePendingNodeConfigurations("canvas-1", [videoNode("model-a")], storage);
    const redone = synchronizePendingNodeConfigurations("canvas-1", [videoNode("model-b")], storage);

    clearPersistedNodeConfigurations(selected, storage);
    clearPersistedNodeConfigurations(undone, storage);
    expect(readPendingNodeConfigurations(storage)[0]?.token).toBe(redone[0]?.token);

    const latest = journalNodeConfiguration("canvas-1", videoNode("model-c"), storage);
    clearPersistedNodeConfigurations(redone, storage);
    expect(readPendingNodeConfigurations(storage)[0]?.token).toBe(latest[0]?.token);
  });

  it("cleans the journal when an ordinary full snapshot replaces a queued configuration save", async () => {
    const storage = new MemoryStorage();
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const processed: string[] = [];
    const queue = new LatestTaskQueue<{ name: string; entries: ReturnType<typeof synchronizePendingNodeConfigurations> }>(async (request) => {
      processed.push(request.name);
      if (request.name === "in-flight") await gate;
      clearPersistedNodeConfigurations(request.entries, storage);
    });
    const first = queue.enqueue({ name: "in-flight", entries: [] });
    const selected = journalNodeConfiguration("canvas-1", videoNode("model-b"), storage);
    const configSave = queue.enqueue({ name: "configuration", entries: selected });
    const fullSave = queue.enqueue({
      name: "ordinary-full-save",
      entries: synchronizePendingNodeConfigurations("canvas-1", [videoNode("model-b")], storage),
    });

    releaseFirst();
    await Promise.all([first, configSave, fullSave]);
    expect(processed).toEqual(["in-flight", "ordinary-full-save"]);
    expect(readPendingNodeConfigurations(storage)).toEqual([]);
  });

  it("restores cleared optional fields after the journal has been serialized", () => {
    const storage = new MemoryStorage();
    const previous = videoNode("model-b");
    previous.data.qualityMode = "highest";
    journalNodeConfiguration("canvas-1", previous, storage);
    const undone = videoNode("model-a");
    delete undone.data.connectionId;
    delete undone.data.parameters;
    synchronizePendingNodeConfigurations("canvas-1", [undone], storage);

    const restored = applyPendingNodeConfigurations([previous], "canvas-1", readPendingNodeConfigurations(storage));
    expect(restored[0]?.data).toMatchObject({ model: "model-a", connectionId: undefined, parameters: undefined, qualityMode: undefined });
  });

  it("discards removed nodes from the captured canvas and preserves another canvas", () => {
    const storage = new MemoryStorage();
    journalNodeConfiguration("canvas-1", videoNode("model-a"), storage);
    const other = journalNodeConfiguration("canvas-2", videoNode("model-b"), storage);

    expect(synchronizePendingNodeConfigurations("canvas-1", [], storage)).toEqual([]);
    expect(readPendingNodeConfigurations(storage)).toEqual(other);
  });
});
