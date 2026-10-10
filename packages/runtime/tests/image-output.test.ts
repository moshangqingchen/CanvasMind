import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { imageOutputContractMismatches, inspectImageOutput } from "../src/image-output.js";

const opaque = () => sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 1 } } });

describe("native image output verification", () => {
  it.each(["png", "jpeg", "webp", "gif", "avif", "tiff"] as const)("detects %s from the original file, decodes pixels and preserves every byte", async format => {
    const bytes = await opaque().toFormat(format).toBuffer();
    const hash = createHash("sha256").update(bytes).digest("hex");
    const output = await inspectImageOutput(bytes);
    expect(output.mimeType).toBe(`image/${format}`);
    expect(output.extension).toBe(format === "jpeg" ? "jpg" : format === "tiff" ? "tif" : format);
    expect(output.metadata).toMatchObject({ imageOutputVerified: true, imageFormat: format, width: 3, height: 2,
      imagePages: 1, imageHasTransparentPixels: false });
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
  });

  it.each(["png", "webp"] as const)("distinguishes %s alpha channels from actual transparent pixels", async format => {
    const opaqueImage = await inspectImageOutput(await opaque().toFormat(format).toBuffer());
    expect(opaqueImage.metadata).toMatchObject({ imageHasAlpha: format === "png", imageHasTransparentPixels: false });
    const bytes = await sharp({ create: { width: 4, height: 3, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 0 } } }).toFormat(format).toBuffer();
    const transparent = await inspectImageOutput(bytes);
    expect(transparent.metadata).toMatchObject({ width: 4, height: 3, imageHasAlpha: true, imageHasTransparentPixels: true });
    expect(imageOutputContractMismatches(transparent, { output_format: format, background: "transparent" })).toEqual([]);
    expect(imageOutputContractMismatches(opaqueImage, { background: "transparent" })).toEqual(["请求透明背景，原文件没有实际透明像素"]);
  });

  it.each(["{\"error\":\"expired\"}", "<!DOCTYPE html><html>Forbidden</html>", "<svg xmlns='http://www.w3.org/2000/svg'></svg>", "not an image"])
    ("rejects mislabeled response bodies instead of accepting their MIME or extension: %s", async body => {
      await expect(inspectImageOutput(new TextEncoder().encode(body))).rejects.toThrow(/签名/u);
    });

  it("rejects a truncated image even when its headers describe valid dimensions", async () => {
    const bytes = await opaque().png().toBuffer();
    const truncated = bytes.subarray(0, bytes.indexOf("IDAT") + 6);
    await expect(inspectImageOutput(truncated)).rejects.toThrow(/解码/u);
  });

  it("reports explicit format fallback and missing alpha independently", async () => {
    const jpeg = await inspectImageOutput(await opaque().jpeg().toBuffer());
    expect(imageOutputContractMismatches(jpeg, { output_format: "png", background: "transparent" })).toEqual([
      "请求输出格式 png，原文件实际为 jpeg", "请求透明背景，原文件没有实际透明像素",
    ]);
    expect(imageOutputContractMismatches(jpeg, { output_format: "jpg", background: "opaque" })).toEqual([]);
    expect(imageOutputContractMismatches(jpeg, { output_format: "auto" })).toEqual([]);
  });
});
