import { describe, expect, it } from "vitest";
import {
  projectResultContext,
  projectResultFamilies,
  type ProjectResult,
} from "./project-results";

describe("project results", () => {
  it("reads only explicit requirements and edit ancestry from the frozen graph", () => {
    const graph = {
      nodes: [
        {
          id: "image",
          data: {
            label: "第二稿",
            designSourceAssetId: "first",
            apiKey: "secret",
            graphicDesignBrief: {
              headline: "活动",
              eventDate: "10月1日",
              apiKey: "secret",
            },
            parts: [
              { type: "text", text: "日期改为10月1日" },
              { type: "asset", assetId: "first" },
            ],
          },
        },
      ],
    };
    const context = projectResultContext(graph, "image");
    expect(context).toEqual({
      label: "第二稿",
      sourceAssetId: "first",
      instruction: "日期改为10月1日",
      requirements: "活动\n10月1日",
    });
    expect(JSON.stringify(context)).not.toContain("secret");
  });
  it("groups repeated outputs and branching edits without mixing projects", () => {
    const result = (
      assetId: string,
      nodeId: string,
      sourceAssetId?: string,
      canvasId = "project",
    ): ProjectResult => ({
      assetId,
      nodeId,
      sourceAssetId,
      canvasId,
      runId: "run",
      label: "设计",
      instruction: "",
      requirements: "",
    });
    const families = projectResultFamilies([
      result("a", "original"),
      result("b", "original"),
      result("c", "edit", "a"),
      result("d", "another-edit", "c"),
      result("other", "original", undefined, "other-project"),
    ]);
    expect(families.get("a")).toBe(families.get("b"));
    expect(families.get("a")).toBe(families.get("d"));
    expect(families.get("a")).not.toBe(families.get("other"));
  });
  it("bounds cyclic ancestry and retains a missing original as the root", () => {
    const base = {
      canvasId: "p",
      runId: "r",
      nodeId: "n",
      label: "",
      instruction: "",
      requirements: "",
    };
    const families = projectResultFamilies([
      { ...base, assetId: "a", sourceAssetId: "b" },
      { ...base, assetId: "b", sourceAssetId: "a" },
      { ...base, assetId: "c", sourceAssetId: "missing" },
    ]);
    expect(families.get("a")).toBe(families.get("b"));
    expect(families.get("c")).toBe("asset:missing");
  });
});
