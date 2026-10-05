import { describe, expect, it } from "vitest";
import { generationDetailsFromRun, resultElapsed, resultGenerationConfiguration, resultPrompt, resultReferenceInputs } from "./result-provenance";
import type { AssetView } from "../components/types";

describe("result provenance", () => {
  it("retains a mask separately from reference inputs when reusing execution settings", () => {
    const imageMask = { maskAssetId: "mask", maskSourceAssetId: "original" };
    const request = { provider: "openai", connectionId: "key", model: "gpt-image-2", parameters: { size: "auto" }, imageMask,
      inputAssetIds: ["original", "mask"], inputAssets: [{ id: "original", kind: "image" as const }, { id: "mask", kind: "image" as const, role: "mask" as const }] };
    const details = generationDetailsFromRun({ id: "nr", nodeId: "n", status: "succeeded", outputAssetIds: [], request });
    expect(details.imageMask).toEqual(imageMask);
    expect(resultReferenceInputs(details)?.find(asset => asset.id === "mask")?.role).toBe("mask");
    expect(resultGenerationConfiguration({ label: "Result" }, request)?.parameters).toEqual({ size: "auto", ...imageMask });
    expect(resultGenerationConfiguration({ label: "Result", generatedProvider: "openai", generatedConnectionId: "key",
      generatedModel: "gpt-image-2", generatedParameters: { size: "auto" }, generatedDetails: details })?.parameters).toEqual({ size: "auto", ...imageMask });
    expect(request.parameters).toEqual({ size: "auto" });
  });
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

  it("copies the historical connection and all parameters independently of current defaults", () => {
    const parameters = { quality: "low", size: "1024x1536", n: 3, seed: 0, generate_audio: false };
    const data = { label: "Result", generatedProvider: "rest", generatedConnectionId: "original-key",
      generatedModel: "original-model", generatedParameters: parameters };
    const reused = resultGenerationConfiguration(data);
    expect(reused).toEqual({ provider: "rest", connectionId: "original-key", model: "original-model", parameters, qualityMode: "custom" });
    reused!.parameters!.quality = "high";
    expect(parameters.quality).toBe("low");
  });

  it("prefers the actual run over a legacy partial result snapshot", () => {
    const request = { provider: "rest", connectionId: "original-key", model: "original-model", parameters: { size: "auto", seed: 0, background: "opaque" } };
    expect(resultGenerationConfiguration({ label: "Result", generatedParameters: { size: "auto" } }, request))
      .toEqual({ ...request, qualityMode: "custom" });
  });

  it("fills missing execution settings from the matching run and accepts empty parameters", () => {
    expect(resultGenerationConfiguration({ label: "Result", generatedProvider: "cli" }, {
      connectionId: "original-cli", model: "video-model", parameters: {},
    })).toEqual({ provider: "cli", connectionId: "original-cli", model: "video-model", parameters: {}, qualityMode: "custom" });
  });

  it("rejects incomplete history instead of using current node configuration", () => {
    const data = { label: "Result", provider: "rest", connectionId: "current-key", model: "current-model", parameters: {} };
    expect(resultGenerationConfiguration(data)).toBeUndefined();
    const request = { provider: "rest", connectionId: "original-key", model: "original-model", parameters: {} };
    for (const key of ["provider", "connectionId", "model", "parameters"] as const) {
      expect(resultGenerationConfiguration(data, { ...request, [key]: undefined })).toBeUndefined();
    }
  });
});
