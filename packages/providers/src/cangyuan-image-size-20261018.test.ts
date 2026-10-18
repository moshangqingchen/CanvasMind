import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cangyuanCurrentModel, cangyuanCurrentRequestIssues, cangyuanCurrentTransport } from "./cangyuan-current-models.js";
import { applyUserImageSizePresets } from "./image-size-presets.js";
import { CANGYUAN_IMAGE_DOCUMENTS } from "./cangyuan-image-documents.js";
import type { NormalizedRequest } from "./contracts.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/cangyuan-image-size-20261018.json", import.meta.url), "utf8")) as {
  schemas: { id: string; sha256: string; checkedAt: string; schema: { params: { name: string; description: string }[] } }[];
};
const model = (id: string) => cangyuanCurrentModel({ id, name: id, operations: ["image.generate"] });
const issues = (id: string, size: string) => cangyuanCurrentRequestIssues({ connectionId: "offline", model: id,
  operation: "image.generate", prompt: "offline", parameters: { size } }, "https://ai.cangyuansuanli.cn");

describe("Cangyuan18Oct exact size descriptions and independently published numeric bounds", () => {
  it.each(fixture.schemas)("uses $id's current source without a stale fixed-tier prohibition", ({ id, sha256, checkedAt, schema }) => {
    const descriptor = model(id), expected = schema.params.find(p => p.name === "size")!.description;
    expect(CANGYUAN_IMAGE_DOCUMENTS[id]?.fields.size).toBe(expected);
    expect(descriptor.metadata).toMatchObject({ imageContractDocumentSha256: sha256, contractCheckedAt: checkedAt });
    expect(descriptor.metadata?.imageFixedResolution).toBeUndefined();
    expect(descriptor.parameters?.find(p => p.key === "size")?.description).not.toContain("不能请求其他分辨率档位");
  });
  it.each([
    ["nano-banana-pro-1k", "1024x512", true], ["nano-banana-pro-1k", "1025x512", false],
    ["nano-banana-pro-2k", "1024x512", false], ["nano-banana-pro-2k", "1025x512", true],
    ["nano-banana-pro-2k", "2048x1024", true], ["nano-banana-pro-2k", "2049x1024", false],
    ["nano-banana2-4k", "2048x1024", false], ["nano-banana2-4k", "2049x1024", true],
    ["nano-banana2-4k", "8193x4097", true],
  ] as const)("validates only %s's actual longest-edge rule for%s", (id, size, valid) => {
    expect(issues(id, size).some(q => q.path === "parameters.size")).toBe(!valid);
  });
  it("keeps GPT's unchanged alignment, edge, aspect and pixel budgets while allowing lower-budget legal custom dimensions", () => {
    expect(issues("gpt-image-2.5-sunburst-4k", "1280x720")).toEqual([]);
    for (const size of ["3840x2160", "1025x1024", "3840x512"])
      expect(issues("gpt-image-2-1k", size).some(q => q.path === "parameters.size")).toBe(true);
    expect(issues("gpt-image-2-1k", "1024x1024")).toEqual([]);
  });
  it("filters presets by published longest-edge/aspect constraints without inventing Nano4K's upper bound", () => {
    const nano = applyUserImageSizePresets(model("nano-banana-pro-4k"));
    expect(nano.parameters?.find(p => p.key === "size")?.max).toBeUndefined();
    for (const option of nano.parameters?.find(p => p.key === "size")?.options ?? []) {
      if (option.value !== "auto") expect(Math.max(...String(option.value).split("x").map(Number))).toBeGreaterThanOrEqual(2049);
    }
    const gpt = applyUserImageSizePresets(model("gpt-image-2-4k"));
    for (const option of gpt.parameters?.find(p => p.key === "size")?.options ?? []) {
      if (option.value === "auto") continue;
      const [w, h] = String(option.value).split("x").map(Number) as [number, number];
      expect(Math.max(w / h, h / w)).toBeLessThanOrEqual(3);
    }
  });
  it("does not turn new dimension metadata into undocumented request fields or resolve the bareSunburst field conflict by acceptance alone", () => {
    for (const { id } of fixture.schemas) {
      const wire = JSON.stringify(cangyuanCurrentTransport(id));
      expect(wire).not.toMatch(/customDimensions|minLongestEdge|maxPixels|size_tier/);
    }
    const input: NormalizedRequest = { connectionId: "offline", model: "gpt-image-2.5-sunburst", operation: "image.edit", prompt: "offline",
      parameters: { size: "3840x2160", quality: "max", output_format: "png" }, assets: [{ id: "original", kind: "image", url: "https://assets.example/original.png" }] };
    expect(cangyuanCurrentRequestIssues(input, "https://ai.cangyuansuanli.cn").map(i => i.path)).toEqual(expect.arrayContaining(["parameters.quality", "parameters.output_format"]));
  });
  it("does not interpret absent or invalid optional numeric bounds as a new restriction", () => {
    const descriptor = { id: "fixture-image", name: "fixture", operations: ["image.generate"] as const,
      parameters: [{ key: "size", label: "size", control: "dimensions" as const, valueType: "string" as const, allowCustomValue: true }] };
    const expected = applyUserImageSizePresets(descriptor).parameters?.find(p => p.key === "size")?.options;
    for (const maximumAspectRatio of [undefined, null, 0, -1])
      expect(applyUserImageSizePresets({ ...descriptor, metadata: { imageCustomDimensionRules: { maximumAspectRatio } } }).parameters?.find(p => p.key === "size")?.options).toEqual(expected);
  });
});
