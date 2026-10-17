import { describe, expect, it } from "vitest";
import type { DirectorCatalogCandidate, GenerationRequirements } from "@super-canvas/director";
import { agentCallParameters, agentParameterIssues, agentRequirementsForParameters, switchAgentChannel } from "./agent-plan-parameters";

const requirements: GenerationRequirements = { operation: "image.generate", count: 1, aspectRatio: "9:16", quality: "high" };
const candidate: DirectorCatalogCandidate = { connectionId: "c", connectionName: "Test", supplier: "test", provider: "rest", authoritative: true,
  model: { id: "full-image-id", name: "Image", operations: ["image.generate"], outputKinds: ["image"], parameters: [
    { key: "aspect_ratio", label: "比例", control: "select", valueType: "string", default: "1:1", options: [{ label: "方形", value: "1:1" }, { label: "竖版", value: "9:16" }] },
    { key: "quality", label: "质量", control: "select", valueType: "string", default: "high", options: [{ label: "高", value: "high" }] },
    { key: "seed", label: "种子", control: "number", valueType: "integer", min: 0, max: 99 },
  ] } };

describe("agent channel parameter snapshots", () => {
  it("preserves legal values and resets incompatible values only on an explicit switch", () => {
    const current = { aspect_ratio: "9:16", quality: "ultra", seed: 42, old_route_only: "x" };
    const result = switchAgentChannel(requirements, current, candidate);
    expect(result.parameters).toEqual({ aspect_ratio: "9:16", quality: "high", seed: 42 });
    expect(result.changedKeys).toEqual(["quality", "old_route_only"]);
    expect(result.issues).toEqual([]);
    expect(current).toEqual({ aspect_ratio: "9:16", quality: "ultra", seed: 42, old_route_only: "x" });
  });
  it("keeps an exact explicit snapshot unchanged on readback and reports invalid values", () => {
    const saved = { aspect_ratio: "21:9", quality: "ultra" };
    expect(agentCallParameters(requirements, candidate, saved)).toEqual(saved);
    expect(agentParameterIssues(requirements, candidate, saved)).toHaveLength(2);
  });
  it("retains alias-compatible values across channels and returns current-parameter quote requirements", () => {
    const result = switchAgentChannel(requirements, { ratio: "9:16", quality: "high", seed: 3 }, candidate);
    expect(result.parameters).toEqual({ aspect_ratio: "9:16", quality: "high", seed: 3 });
    expect(agentRequirementsForParameters(requirements, result.parameters, candidate.model)).toEqual(requirements);
  });
  it("re-evaluates conditional ranges without silently sending an invalid combination", () => {
    const video = { ...candidate, model: { ...candidate.model, operations: ["video.generate" as const], parameters: [
      { key: "resolution", label: "分辨率", control: "select" as const, default: "1080p", options: [{ label: "1080p", value: "1080p" }] },
      { key: "duration", label: "时长", control: "number" as const, min: 1, max: 10, default: 5, constraints: [{ when: [{ parameter: "resolution", values: ["1080p"] }], max: 6 }] },
    ] } };
    const result = switchAgentChannel({ operation: "video.generate", count: 1 }, { resolution: "1080p", duration: 9 }, video);
    expect(result.parameters.duration).toBe(5);
    expect(result.changedKeys).toContain("duration");
    expect(result.issues).toEqual([]);
  });
  it("fills a newly visible required field after resetting its controller in the same switch", () => {
    const conditional = { ...candidate, model: { ...candidate.model, parameters: [
      { key: "mode", label: "模式", control: "select" as const, default: "portrait", options: [{ label: "肖像", value: "portrait" }] },
      { key: "lighting", label: "光线", control: "select" as const, required: true, default: "soft", options: [{ label: "柔光", value: "soft" }], visibleWhen: [{ parameter: "mode", values: ["portrait"] }] },
    ] } };
    const result = switchAgentChannel(requirements, { mode: "old-route" }, conditional);
    expect(result.parameters).toEqual({ mode: "portrait", lighting: "soft" });
    expect(result.issues).toEqual([]);
  });
  it("maps quality, duration, ratio and exact size without losing extra model-declared fields", () => {
    const params = { size: "3840x2160", quality: "high", aspect_ratio: "16:9", n: 2, seed: 42 };
    expect(agentRequirementsForParameters(requirements, params, candidate.model)).toEqual({ operation: "image.generate", count: 2, resolution: "3840x2160", quality: "high", aspectRatio: "16:9" });
    expect(agentCallParameters(requirements, candidate, params)).toEqual(params);
  });
});
