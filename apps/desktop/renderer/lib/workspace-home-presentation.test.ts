import { describe, expect, it } from "vitest";
import { projectCoverPalette, workspaceProjectStatistics } from "./workspace-home-presentation";

describe("workspace home presentation", () => {
  it("keeps each decorative cover tied to its project through sorting and filtering", () => {
    const ids = ["canvas-1", "canvas-2", "中文画布", "2e08d8b0-c437-4cf1-bd48-5fd1a4312cc9"];
    const palettes = new Map(ids.map(id => [id, projectCoverPalette(id)]));
    for (const id of [...ids].reverse().filter(value => value !== "canvas-2")) {
      expect(projectCoverPalette(id)).toEqual(palettes.get(id));
    }
    expect(new Set(ids.map(id => projectCoverPalette(id).name)).size).toBeGreaterThan(1);
  });

  it("counts only the loaded project summaries without mutating them", () => {
    const summaries = Object.freeze([Object.freeze({ nodeCount: 8 }), Object.freeze({ nodeCount: 12 })]);
    expect(workspaceProjectStatistics(summaries)).toEqual({ projects: 2, nodes: 20 });
    expect(workspaceProjectStatistics([{ nodeCount: 0 }])).toEqual({ projects: 1, nodes: 0 });
  });

  it("omits unknown or invalid node totals rather than inventing workspace statistics", () => {
    for (const nodeCount of [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(workspaceProjectStatistics([{ nodeCount: 8 }, { nodeCount }])).toEqual({ projects: 2, nodes: undefined });
    }
    expect(workspaceProjectStatistics([])).toEqual({ projects: 0, nodes: undefined });
    expect(workspaceProjectStatistics([{ nodeCount: Number.MAX_SAFE_INTEGER }, { nodeCount: 1 }]).nodes).toBeUndefined();
  });
});
