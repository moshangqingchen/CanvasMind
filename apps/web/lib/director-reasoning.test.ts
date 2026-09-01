import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";

import {
  directorModelSupportsReasoning,
  directorReasoningOptions,
} from "./director-reasoning";

function model(
  id: string,
  extra: Partial<ModelDescriptor> = {},
): ModelDescriptor {
  return { id, name: id, operations: [], ...extra };
}

describe("director reasoning options", () => {
  it("keeps unsupported models on automatic effort", () => {
    const selected = model("claude-3-haiku", {
      metadata: { supportsReasoning: false },
    });

    expect(directorModelSupportsReasoning(selected, "anthropic-messages")).toBe(
      false,
    );
    expect(directorReasoningOptions(selected, "anthropic-messages")).toEqual([
      { value: "auto", label: "自动" },
    ]);
  });

  it("exposes the effort levels supported by GPT-5.6", () => {
    const options = directorReasoningOptions(
      model("gpt-5.6"),
      "openai-responses",
    );

    expect(options.map((option) => option.value)).toEqual([
      "auto",
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  it("uses a model-declared parameter list when available", () => {
    const selected = model("vendor-reasoner", {
      parameters: [
        {
          key: "reasoning_effort",
          label: "思考强度",
          control: "select",
          options: [
            { value: "quick", label: "快速" },
            { value: "deep", label: "深度" },
          ],
        },
      ],
    });

    expect(
      directorReasoningOptions(selected, "generic-openai-compatible"),
    ).toEqual([
      { value: "auto", label: "自动" },
      { value: "quick", label: "快速" },
      { value: "deep", label: "深度" },
    ]);
  });

  it("accepts a probed capability for a generic compatible model", () => {
    const selected = model("vendor-model");

    expect(
      directorModelSupportsReasoning(selected, "generic-openai-compatible", {
        reasoning: true,
      }),
    ).toBe(true);
    expect(
      directorReasoningOptions(selected, "generic-openai-compatible", {
        reasoning: true,
      }).map((option) => option.value),
    ).toEqual(["auto", "low", "medium", "high"]);
  });
});
