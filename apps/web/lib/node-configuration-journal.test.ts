import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../components/types";
import {
  applyPendingNodeConfigurations,
  clearPersistedNodeConfigurations,
  journalNodeConfiguration,
  readPendingNodeConfigurations,
} from "./node-configuration-journal";

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
  it("restores a model and its derived parameters over the stale server graph", () => {
    const storage = new MemoryStorage();
    const selected = videoNode("seedance-2.0-fast");
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
});
