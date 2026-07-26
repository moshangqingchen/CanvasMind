import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import {
  coerceParameterInput,
  modelDescriptorFromConnectionConfig,
  parameterDescriptorsFor,
  parametersWithDefaults,
  setParameterValue,
} from "./model-parameters";

describe("model parameter helpers", () => {
  it("provides practical image and video defaults", () => {
    const image = parameterDescriptorsFor("image-generation", "openai");
    const video = parameterDescriptorsFor("video-generation", "runway");

    expect(parametersWithDefaults(image)).toMatchObject({
      size: "1024x1024",
      quality: "auto",
      n: 1,
    });
    expect(parametersWithDefaults(video)).toMatchObject({
      duration: 5,
      ratio: "1280:720",
    });
    expect(video.some((parameter) => parameter.key === "n")).toBe(false);
  });

  it("uses a REST model's declared fields and filters unrelated operations", () => {
    const model: ModelDescriptor = {
      id: "custom-video",
      name: "Custom Video",
      operations: ["video.generate"],
      parameters: [
        {
          key: "fps",
          label: "FPS",
          control: "number",
          valueType: "integer",
          default: 24,
          operations: ["video.generate"],
        },
        {
          key: "image_only",
          label: "Image only",
          control: "toggle",
          operations: ["image.generate"],
        },
      ],
    };

    expect(
      parameterDescriptorsFor("video-generation", "rest", model).map(
        (parameter) => parameter.key,
      ),
    ).toEqual(["fps"]);
  });

  it("coerces typed form values and removes API-default values", () => {
    const descriptor = {
      key: "n",
      label: "数量",
      control: "number" as const,
      valueType: "integer" as const,
    };
    expect(coerceParameterInput(descriptor, "3.8")).toBe(3);
    expect(
      setParameterValue({ n: 2, quality: "high" }, "n", undefined),
    ).toEqual({ quality: "high" });
  });

  it("reads a connector's configured default model before remote discovery", () => {
    const descriptor = modelDescriptorFromConnectionConfig(
      {
        connector: {
          models: [
            {
              id: "image-4k",
              name: "Image 4K",
              operations: ["image.generate"],
              isDefault: true,
              metadata: { fixedOutputCount: 1 },
              parameters: [
                {
                  key: "size",
                  label: "尺寸",
                  control: "text",
                  default: "3840x2160",
                },
              ],
            },
          ],
        },
      },
      "image-4k",
    );
    expect(descriptor?.id).toBe("image-4k");
    expect(
      parametersWithDefaults(
        parameterDescriptorsFor("image-generation", "rest", descriptor),
      ),
    ).toEqual({ size: "3840x2160" });
  });
});
