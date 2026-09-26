import { describe, expect, it } from "vitest";
import { generationDetailsFromRun, resultElapsed, resultPrompt, resultReferenceInputs } from "./result-provenance";
import type { AssetView } from "../components/types";

describe("result provenance", () => {
  it("distinguishes no references from missing history and keeps deleted references", () => {
    expect(resultReferenceInputs({})).toBeUndefined();
    expect(resultReferenceInputs({ inputAssetIds: [] })).toEqual([]);
    expect(resultReferenceInputs({
      inputAssetIds: ["ref", "ref", "clip", "missing"],
      inputAssets: [{ id: "ref", name: "Original.png", kind: "image", role: "firstFrame" }],
    }, [{ id: "ref", name: "Renamed.png", kind: "image" }, { id: "clip", kind: "video" }] as AssetView[])).toEqual([
      { id: "ref", name: "Original.png", kind: "image", role: "firstFrame" },
      { id: "clip", kind: "video" },
      { id: "missing" },
    ]);
  });

  it("uses the actual historical prompt and never falls back to the current source text", () => {
    const data = { label: "Result", generatedPromptText: "New prompt from current graph" };
    expect(resultPrompt(data, {})).toBeUndefined();
    expect(resultPrompt(data, { prompt: "Original prompt" })).toBe("Original prompt");
    expect(resultPrompt(data, { prompt: "" })).toBe("");
    expect(resultPrompt({ ...data, generatedPromptParts: [{ type: "text", text: "Saved prompt" }] }, {})).toBe("Saved prompt");
  });

  it("records actual output count and only uses terminal update times as completion", () => {
    const node = { id: "nr", nodeId: "n", status: "succeeded", outputAssetIds: ["out"], updatedAt: "2026-09-24T00:01:31Z", request: { parameters: { n: 3 }, inputAssetIds: [] } };
    expect(generationDetailsFromRun(node)).toEqual({ inputAssetIds: [], outputCount: 1, finishedAt: node.updatedAt });
    expect(generationDetailsFromRun({ ...node, status: "running" }).finishedAt).toBeUndefined();
    expect(resultElapsed("2026-09-24T00:00:00Z", node.updatedAt)).toBe("1 分 31 秒");
    expect(resultElapsed(node.updatedAt, "2026-09-24T00:00:00Z")).toBe("未记录");
    expect(resultElapsed()).toBe("未记录");
  });
});
