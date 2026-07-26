import { describe, expect, it } from "vitest";

import {
  coreRequestToProviderRequest,
  providerModelToCoreModel,
  providerStateToCoreState,
} from "./compat";

describe("core/provider contract bridge", () => {
  it("renders structured mentions and infers edit/video modes", () => {
    const imageRequest = coreRequestToProviderRequest(
      {
        provider: "openai",
        model: "gpt-image-2",
        capability: "image.generate",
        prompt: [
          { type: "text", text: "A poster using" },
          { type: "asset", assetId: "ref-1", role: "reference" },
        ],
        assets: [{ assetId: "ref-1", kind: "image", mimeType: "image/png" }],
        parameters: {},
        idempotencyKey: "run-1",
      },
      { connectionId: "openai-connection" },
    );
    expect(imageRequest.operation).toBe("image.edit");
    expect(imageRequest.prompt).toBe("A poster using @ref-1");
    expect(imageRequest.assets?.[0]).toMatchObject({
      id: "ref-1",
      kind: "image",
    });

    const videoRequest = coreRequestToProviderRequest(
      {
        provider: "runway",
        model: "gen4.5",
        capability: "video.generate",
        prompt: [{ type: "text", text: "Animate" }],
        assets: [
          {
            assetId: "frame",
            kind: "image",
            url: "https://asset.test/frame.png",
          },
        ],
        parameters: {},
        idempotencyKey: "run-2",
      },
      { connectionId: "runway-connection" },
    );
    expect(videoRequest.operation).toBe("video.image-to-video");
  });

  it("maps provider model/task state to stable core fields", () => {
    expect(
      providerModelToCoreModel(
        {
          id: "gen4.5",
          name: "Gen 4.5",
          operations: ["video.image-to-video"],
        },
        "runway",
      ),
    ).toMatchObject({ provider: "runway", capabilities: ["video.generate"] });
    expect(
      providerStateToCoreState(
        {
          providerTaskId: "task-1",
          status: "succeeded",
          result: { ok: true },
        },
        [{ kind: "image", url: "https://cdn.test/out.png" }],
      ),
    ).toMatchObject({
      status: "succeeded",
      outputs: [{ kind: "image", url: "https://cdn.test/out.png" }],
    });
  });
});
