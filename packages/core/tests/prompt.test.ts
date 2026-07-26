import { describe, expect, it } from "vitest";

import {
  deserializePromptParts,
  extractPromptAssetIds,
  normalizePromptParts,
  renderPromptParts,
  serializePromptParts,
  type PromptPart,
} from "../src/index.js";

const prompt: readonly PromptPart[] = [
  { type: "text", text: "  cinematic\r\nportrait of" },
  { type: "text", text: " " },
  { type: "asset", assetId: " person-1 ", role: "reference" },
  { type: "text", text: " at sunset  " },
  { type: "asset", assetId: "person-1", role: "firstFrame" },
];

describe("structured prompts", () => {
  it("normalizes text without converting asset ids to URLs", () => {
    expect(normalizePromptParts(prompt)).toEqual([
      { type: "text", text: "  cinematic\nportrait of " },
      { type: "asset", assetId: "person-1", role: "reference" },
      { type: "text", text: " at sunset  " },
      { type: "asset", assetId: "person-1", role: "firstFrame" },
    ]);
  });

  it("round-trips a stable JSON representation", () => {
    const serialized = serializePromptParts(prompt);
    expect(deserializePromptParts(serialized)).toEqual(
      normalizePromptParts(prompt),
    );
    expect(() => deserializePromptParts('{"type":"text"}')).toThrow(
      "JSON array",
    );
  });

  it("renders resolved and unresolved mentions with safe spacing", () => {
    expect(
      renderPromptParts(prompt, {
        resolveAsset: (assetId, role) =>
          role === "reference"
            ? { id: assetId, name: "人物参考图" }
            : undefined,
      }),
    ).toBe("  cinematic\nportrait of @人物参考图 at sunset  @person-1");
  });

  it("extracts unique asset ids in first-use order and by role", () => {
    expect(
      extractPromptAssetIds([
        ...prompt,
        { type: "asset", assetId: "scene", role: "reference" },
      ]),
    ).toEqual(["person-1", "scene"]);
    expect(extractPromptAssetIds(prompt, "firstFrame")).toEqual(["person-1"]);
  });
});
