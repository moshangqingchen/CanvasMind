import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GenericRestAdapter, StaticConnectionResolver, type ModelDescriptor, type NormalizedRequest } from "@super-canvas/providers";
import { modelPriceAmount } from "@super-canvas/providers/media-billing";
import { miaowuConnectorForModels } from "./miaowu-catalog";
import { applyMiaowuVideoSchema, parseMiaowuVideoSchema } from "./miaowu-video-schema";

const fixture = JSON.parse(readFileSync(new URL("./miaowu-video-20261020.fixture.json", import.meta.url), "utf8"));
function modelFor(id: string): ModelDescriptor {
  const row = fixture.rows.find((value: { id: string }) => value.id === id);
  return applyMiaowuVideoSchema({ id, name: id, operations: ["video.generate"], outputKinds: ["video"],
    metadata: { marketplaceGroup: "default", parameterSource: "key-model-scan", canvasRunnable: false, canvasUnavailableReason: "当前分组尚未提供参数合同" } },
  { id, sourceUrl: row.url, checkedAt: row.checkedAt, status: "live", httpStatus: row.httpStatus, normalizedSchemaSha256: row.sha256,
    contract: parseMiaowuVideoSchema(id, row.payload) });
}

describe("October20 exact-group Miaowu native video changes", () => {
  it.each([
    ["seedance-2.5-slow", 4, 30, ["480p"], 9, 3, 3],
    ["doubao-seedance-2.0", 5, 15, ["720p"], 9, 0, 0],
    ["vidu-q4", 4, 16, ["1080p", "720p"], 15, 0, 3],
    ["kling-omni-4.0", 3, 30, ["720p", "1080p"], 10, 0, 3],
  ] as const)("restores %s with this Key's exact duration, resolution, material roles and quote", (id, min, max, resolutions, images, videos, audios) => {
    const model = modelFor(id);
    expect(model.parameters?.find(p => p.key === "duration")).toMatchObject({ min, max });
    expect(model.parameters?.find(p => p.key === "resolution")?.options?.map(o => o.value)).toEqual(resolutions);
    expect(model.limits).toMatchObject({ maxInputImages: images, maxInputVideos: videos, maxInputAudios: audios });
    expect(model.metadata).toMatchObject({ parameterSource: "dream.video_schema", canvasRunnable: true, supportsFirstLastFrames: false });
    expect(model.metadata).not.toHaveProperty("canvasUnavailableReason");
  });

  it("keeps Kling's new 1080p price distinct and does not multiply request prices by duration", () => {
    const kling = modelFor("kling-omni-4.0"), vidu = modelFor("vidu-q4");
    expect(modelPriceAmount(kling.pricing!, { resolution: "720p", duration: 10 })).toBe(.16);
    expect(modelPriceAmount(kling.pricing!, { resolution: "1080p", duration: 10 })).toBe(.25);
    expect(modelPriceAmount(vidu.pricing!, { resolution: "720p", duration: 16 })).toBe(1);
    expect(modelPriceAmount(vidu.pricing!, { resolution: "1080p", duration: 16 })).toBe(2);
    expect(modelPriceAmount(modelFor("seedance-2.5-slow").pricing!, { resolution: "480p", duration: 30 })).toBe(1);
  });

  it.each(["seedance-2.5-slow", "doubao-seedance-2.0", "vidu-q4", "kling-omni-4.0"])("submits %s once, preserves the selected fields and restores the original task", async id => {
    const model = modelFor(id), connector = miaowuConnectorForModels([model]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "original-task", status: "queued" }))
      .mockResolvedValueOnce(Response.json({ id: "original-task", status: "completed", url: "https://result.example/original.mp4" }));
    const resolver = new StaticConnectionResolver([{ id: "miaowu-default", provider: "rest", baseUrl: "https://api.miaowuai.store", apiKey: "offline-fixture",
      settings: { connector, usage: "canvas", accountKeyGroup: "default", modelGroup: "default", modelScanStatus: "live", scannedModelIds: [id], modelCatalogModels: [model] } }]);
    const input: NormalizedRequest = { connectionId: "miaowu-default", model: id, operation: "video.image-to-video", prompt: "Offline fixture", idempotencyKey: "offline-once",
      parameters: { duration: id === "vidu-q4" ? 16 : 10, resolution: id === "seedance-2.5-slow" ? "480p" : id === "kling-omni-4.0" ? "1080p" : "720p", aspect_ratio: "16:9" },
      assets: [{ id: "reference", kind: "image", mimeType: "image/png", url: "https://media.example/original-alpha.png" }] };
    const before = structuredClone(input), task = await new GenericRestAdapter(resolver, { fetch: fetcher }).submit(input);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ model: id, prompt: input.prompt, seconds: input.parameters!.duration,
      resolution: input.parameters!.resolution, ratio: "16:9", image_urls: [input.assets![0]!.url] });
    const restarted = new GenericRestAdapter(resolver, { fetch: fetcher }), completed = await restarted.poll(JSON.parse(JSON.stringify(task)));
    expect(completed.status).toBe("succeeded");
    expect(await restarted.extractOutputs(completed.result)).toMatchObject([{ kind: "video", url: "https://result.example/original.mp4" }]);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(input).toEqual(before);
  });
});
