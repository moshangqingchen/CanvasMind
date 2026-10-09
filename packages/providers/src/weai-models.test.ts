import { expect, it } from "vitest";
import { weAIModelDescriptors } from "./weai-models.js";

it.each(["gemini-3-pro-image-preview", "gemini-3.0-pro-image", "gemini-3.0-pro-image-preview", "gemini-3.1-flash-image-preview"])("keeps the documented legacy Banana alias %s on native image parameters", (id) => {
  const [model] = weAIModelDescriptors(id, false, "gemini香蕉");
  expect(model?.id).toBe(id);
  expect(model?.metadata).toMatchObject({ protocol: "gemini-generate-content", fixedOutputCount: 1 });
  expect(model?.parameters?.some(p => p.key === "image_size" && p.options?.some(o => o.value === "1K"))).toBe(true);
  expect(model?.parameters?.some(p => p.key === "size")).toBe(false);
});

it("does not add unmeasured output or quality fields to the verified Adobe base request", () => {
  const [model] = weAIModelDescriptors("gpt-image-2", false, "生图-openai-adobe-按次");
  expect(model?.parameters?.some(p => ["quality", "response_format", "output_format", "output_compression"].includes(p.key))).toBe(false);
  const [fixed] = weAIModelDescriptors("gpt-image-2-high", false, "生图-openai-adobe-按次");
  expect(fixed?.metadata?.fixedQuality).toBe("high");
  expect(fixed?.parameters?.some(p => p.key === "response_format")).toBe(true);
});
