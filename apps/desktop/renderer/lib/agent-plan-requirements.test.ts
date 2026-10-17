import { expect, it } from "vitest";
import { AgentProposalSchema } from "./agent-contracts";
import { agentOutputResolutionConflict, currentSingleOutputResolution, preserveCurrentProposalRequirements } from "./agent-plan-requirements";

it("keeps current user exact dimensions as a requirement rather than a capability claim", () => {
  const proposal = AgentProposalSchema.parse({ type: "proposal", summary: "待确认海报", calls: [{ id: "hero", label: "海报", prompt: "暖灯", requirements: { operation: "image.generate", count: 1 } }] });
  const preserved = preserveCurrentProposalRequirements(proposal, "请制作1080×1920海报");
  expect(preserved.calls[0]?.requirements.resolution).toBe("1080x1920");
  expect(preserved.calls[0]?.parameters).toBeUndefined();
  expect(proposal.calls[0]?.requirements.resolution).toBeUndefined();
});

it.each([{ resolution: "2K" }, { size: "2048x2048" }, { width: 2048, height: 2048 }])("does not treat a different legal output parameter as the user's pixels: %j", parameters => {
  expect(agentOutputResolutionConflict("1080x1920", parameters)).toBeTruthy();
});
it("accepts matching exact pixels while retaining application tier preferences", () => {
  expect(agentOutputResolutionConflict("1080x1920", { size: "1080×1920", size_tier: "2K" })).toBeUndefined();
  expect(agentOutputResolutionConflict("1080x1920", { width: 1080, height: 1920 })).toBeUndefined();
  expect(currentSingleOutputResolution("海报1080×1920，标题A")).toBe("1080x1920");
  expect(currentSingleOutputResolution("1080x1920和1080x1080")).toBeUndefined();
});
