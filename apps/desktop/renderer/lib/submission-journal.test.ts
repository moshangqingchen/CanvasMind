import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasNode } from "../components/types";
import {
  acknowledgeSubmissions,
  forgetSubmission,
  hiddenResult,
  hideRemovedResults,
  linkSubmission,
  needsTaskReconciliation,
  readSubmissions,
  rememberSubmission,
  restoreSubmissions,
} from "./submission-journal";
import { removeDeletedAssetsFromGraph } from "./generation-history";

const source: CanvasNode = {
  id: "source",
  position: { x: 0, y: 0 },
  data: { label: "生成", nodeType: "image-generation" },
};
const pending: CanvasNode = {
  id: "result",
  position: { x: 300, y: 0 },
  data: {
    label: "结果",
    generatedResult: true,
    generatedFromNodeId: "source",
    generatedPendingRequestId: "request",
    generatedOutputIndex: 0,
    generatedStatus: "submitting",
  },
};
beforeEach(() => {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
  });
});
describe("durable generation submission journal", () => {
  it("recovers a lost POST response without creating a new request identity", () => {
    rememberSubmission("canvas", "request", [source, pending]);
    const restored = restoreSubmissions("canvas", [source]);
    expect(restored).toHaveLength(2);
    expect(restored[1]?.data.generatedPendingRequestId).toBe("request");
    expect(restored[1]?.data.generatedStatus).toBe("needs_attention");
    expect(needsTaskReconciliation(restored[1]!.data)).toBe(true);
  });
  it("does not clear a record until its server-linked cards are durably saved", () => {
    rememberSubmission("canvas", "request", [source, pending]);
    linkSubmission("canvas", "request", "run");
    acknowledgeSubmissions("canvas", [source, pending]);
    expect(readSubmissions("canvas")).toHaveLength(1);
    acknowledgeSubmissions("canvas", [
      source,
      {
        ...pending,
        data: {
          ...pending.data,
          generatedPendingRequestId: undefined,
          generatedFromRunId: "run",
        },
      },
    ]);
    expect(readSubmissions("canvas")).toEqual([]);
  });
  it("does not restore duplicate cards after refresh", () => {
    rememberSubmission("canvas", "request", [source, pending]);
    expect(restoreSubmissions("canvas", [source, pending])).toHaveLength(2);
    linkSubmission("canvas", "request", "run");
    expect(
      restoreSubmissions("canvas", [
        source,
        {
          ...pending,
          id: "another-id",
          data: {
            ...pending.data,
            generatedPendingRequestId: undefined,
            generatedFromRunId: "run",
          },
        },
      ]),
    ).toHaveLength(2);
  });
  it("persists hidden result slots and permits a different run on the same source", () => {
    rememberSubmission("canvas", "request", [source, pending]);
    const hidden = hideRemovedResults(
      [source, pending],
      new Set(["result"]),
    ).filter((n) => n.id !== "result");
    expect(
      restoreSubmissions("canvas", JSON.parse(JSON.stringify(hidden))),
    ).toHaveLength(1);
    expect(hiddenResult(hidden[0]!.data, "request", undefined, 0)).toBe(true);
    expect(hiddenResult(hidden[0]!.data, "other", undefined, 0)).toBe(false);
    expect(hiddenResult(hidden[0]!.data, "request", undefined, 1)).toBe(false);
    // Restoring an ordinary removal's prior snapshot still restores the card.
    expect(restoreSubmissions("canvas", [source, pending])).toHaveLength(2);
  });
  it("retires linked hidden submissions only after their marker is saved", () => {
    rememberSubmission("canvas", "request", [source, pending]);
    linkSubmission("canvas", "request", "run");
    acknowledgeSubmissions(
      "canvas",
      hideRemovedResults([source, pending], new Set(["result"])).filter(
        (n) => n.id !== "result",
      ),
    );
    expect(readSubmissions("canvas")).toEqual([]);
  });
  it("keeps records isolated between projects and submissions", () => {
    rememberSubmission("a", "request", [pending]);
    rememberSubmission("b", "request", [pending]);
    forgetSubmission("a", "request");
    expect(readSubmissions("a")).toEqual([]);
    expect(readSubmissions("b")).toHaveLength(1);
  });
  it("storage failure prevents the caller from proceeding to paid POST", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const paidPost = vi.fn();
    expect(() => {
      rememberSubmission("a", "request", [pending]);
      paidPost();
    }).toThrow("quota");
    expect(paidPost).not.toHaveBeenCalled();
  });
  it("cleans stale asset references from both undo and redo snapshots", () => {
    const result = {
      ...pending,
      data: { ...pending.data, assetId: "deleted", generatedFromRunId: "run" },
    };
    const sanitize = (nodes: CanvasNode[]) =>
      removeDeletedAssetsFromGraph(
        hideRemovedResults(nodes, new Set(["result"])),
        [],
        new Set(["deleted"]),
      ).nodes;
    for (const stack of [
      [source, result],
      [
        {
          ...source,
          data: {
            ...source.data,
            lastOutputAssetIds: ["deleted"],
            parts: [
              {
                type: "asset" as const,
                assetId: "deleted",
                role: "reference" as const,
              },
            ],
          },
        },
        result,
      ],
    ]) {
      const clean = sanitize(stack);
      expect(clean.some((n) => n.data.assetId === "deleted")).toBe(false);
      expect(hiddenResult(clean[0]!.data, undefined, "run", 0)).toBe(true);
      expect(clean[0]?.data.lastOutputAssetIds ?? []).not.toContain("deleted");
    }
  });
});
