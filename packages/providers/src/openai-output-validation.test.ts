import { describe, expect, it } from "vitest";
import { StaticConnectionResolver } from "./credentials";
import { OpenAIImageAdapter } from "./openai";

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aKcAAAAASUVORK5CYII=";

function adapter(): OpenAIImageAdapter {
  return new OpenAIImageAdapter(new StaticConnectionResolver([]));
}

describe("OpenAI image output validation", () => {
  const malformed = [
    "",
    " \r\n\t ",
    "data:image/png;base64,",
    "data:image/png;base64, \n ",
    "!!!",
    "A",
    "AQ=",
    "AQID=",
    "AQID===",
    "AQ!ID",
    "<html>upstream error</html>",
  ];

  it.each(malformed)(
    "does not turn malformed Base64 %j into an image",
    async (b64_json) => {
      expect(await adapter().extractOutputs({ data: [{ b64_json }] })).toEqual(
        [],
      );
    },
  );

  it.each(malformed)(
    "uses the image URL when primary Base64 %j is malformed",
    async (b64_json) => {
      const url = "https://cdn.example.test/generated.png";
      expect(
        await adapter().extractOutputs({ data: [{ b64_json, url }] }),
      ).toEqual([
        { kind: "image", url, mimeType: "image/png", filename: "openai-1.png" },
      ]);
    },
  );

  it.each(["", " \t\n "])(
    "omits an empty URL %j after rejecting primary Base64",
    async (url) => {
      expect(
        await adapter().extractOutputs({ data: [{ b64_json: "", url }] }),
      ).toEqual([]);
    },
  );

  it.each([
    pngBase64,
    pngBase64.replace(/=+$/u, ""),
    ` \n${pngBase64.slice(0, 40)}\r\n${pngBase64.slice(40)}\t `,
    `data:image/png;base64,${pngBase64}`,
  ])(
    "preserves valid PNG bytes with supported Base64 formatting",
    async (b64_json) => {
      const outputs = await adapter().extractOutputs({
        data: [{ b64_json, url: "https://cdn.example.test/fallback.png" }],
      });
      expect(outputs).toHaveLength(1);
      expect(outputs[0]).toMatchObject({
        kind: "image",
        mimeType: "image/png",
      });
      expect(
        Buffer.from(outputs[0]!.data!).equals(Buffer.from(pngBase64, "base64")),
      ).toBe(true);
      expect(outputs[0]).not.toHaveProperty("url");
    },
  );

  it("retains valid sibling output without archiving an empty result", async () => {
    const outputs = await adapter().extractOutputs({
      data: [{ b64_json: "" }, { b64_json: pngBase64 }],
    });
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.filename).toBe("openai-2.png");
    expect(outputs[0]?.data?.byteLength).toBeGreaterThan(0);
  });

  it("skips malformed Gemini inline data before using its image URL", async () => {
    const url = "https://cdn.example.test/generated.png";
    const outputs = await adapter().extractOutputs({
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: "image/png", data: "!!!" } },
              { text: `![generated](${url})` },
            ],
          },
        },
      ],
    });
    expect(outputs).toEqual([{ kind: "image", url }]);
  });
});
