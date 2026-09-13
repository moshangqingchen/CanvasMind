import { describe, expect, it, vi } from "vitest";
import { OpenAIImageAdapter } from "./openai";
import { StaticConnectionResolver } from "./credentials";

describe("FriModel verified 2.5 transport", () => {
  it.each(["gpt-image-2.5-flare-adobe", "gpt-image-2.5-sunburst-adobe"])(
    "validates and forwards quality and edit inputs for %s",
    async (model) => {
      const fetch = vi.fn(async (url: RequestInfo | URL) =>
        Response.json(
          String(url).endsWith("/models")
            ? { data: [{ id: model }] }
            : { data: [{ b64_json: "aW1hZ2U=" }] },
        ),
      );
      const adapter = new OpenAIImageAdapter(
        new StaticConnectionResolver([
          {
            id: "fri",
            provider: "openai",
            baseUrl: "https://api.frimodel.com/v1",
            apiKey: "test",
            settings: {
              supplierKey: "frimodel",
              modelGroup: "gpt_image_adobe",
            },
          },
        ]),
        { fetch },
      );
      const request = {
        connectionId: "fri",
        operation: "image.edit" as const,
        model,
        prompt: "Make the cup green",
        idempotencyKey: "test-image25",
        parameters: { quality: "max", size: "3840x2160" },
        assets: [
          {
            id: "ref",
            kind: "image" as const,
            mimeType: "image/png",
            data: new Uint8Array([137, 80, 78, 71]),
          },
        ],
      };
      expect(await adapter.validate(request)).toMatchObject({ valid: true });
      expect(
        await adapter.validate({
          ...request,
          parameters: { ...request.parameters, quality: "xhigh" },
        }),
      ).toMatchObject({ valid: model === "gpt-image-2.5-flare-adobe" });
      const catalog = await adapter.listModels("fri");
      expect(catalog[0]?.operations).toContain("image.edit");
      expect(
        catalog[0]?.parameters
          ?.find((p) => p.key === "quality")
          ?.options?.map((o) => o.value),
      ).toContain("max");
      await adapter.submit(request);
      const call = (
        fetch.mock.calls as unknown as [RequestInfo | URL, RequestInit][]
      ).find(([url]) => String(url).endsWith("/images/edits"));
      expect(call).toBeDefined();
      const form = call![1].body as FormData;
      expect(form.get("model")).toBe(model);
      expect(form.get("quality")).toBe("max");
      expect(form.get("size")).toBe("3840x2160");
      expect(form.get("image")).toBeInstanceOf(Blob);
      expect(
        await adapter.validate({ ...request, model: "gpt-image-2-adobe" }),
      ).toMatchObject({ valid: false });
      expect(
        await adapter.validate({
          ...request,
          model: "gpt-image-2.5-unverified",
        }),
      ).toMatchObject({ valid: false });
    },
  );
});
