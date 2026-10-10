import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GenericRestAdapter, StaticConnectionResolver, type ModelDescriptor, type NormalizedRequest } from "@super-canvas/providers";
import { miaowuConnectorForModels } from "./miaowu-catalog";
import { applyMiaowuVideoSchema, parseMiaowuVideoSchema } from "./miaowu-video-schema";

const fixture = JSON.parse(readFileSync(new URL("./miaowu-video-current-20261009.fixture.json", import.meta.url), "utf8"));
function modelFor(id: string): ModelDescriptor {
  const row = fixture.rows.find((value: { model: string }) => value.model === id);
  return applyMiaowuVideoSchema({ id, name: id, operations: ["video.generate"], outputKinds: ["video"], metadata: { parameterSource: "pricing.video_api" } },
    { id, sourceUrl: row.url, checkedAt: row.checkedAt, status: "live", httpStatus: row.httpStatus,
      normalizedSchemaSha256: row.attempts[0].sha256, contract: parseMiaowuVideoSchema(id, row.payload) });
}

describe("current Key newly visible Miaowu native video IDs", () => {
  it.each([
    ["seedance-2.0-pro", 4, 15, ["720p", "480p"], 9, 3],
    ["seedance-2.5-pro", 4, 29, ["720p"], 30, 10],
    ["doubao-seedance-2.0-mini", 5, 15, ["720p"], 9, 0],
  ] as const)("uses the same-Key schema for %s without inheriting another model's controls", (id, min, max, resolutions, images, audios) => {
    const model = modelFor(id);
    expect(model.parameters?.find(p => p.key === "duration")).toMatchObject({ min, max, step: 1 });
    expect(model.parameters?.find(p => p.key === "resolution")?.options?.map(o => o.value)).toEqual(resolutions);
    expect(model.limits).toMatchObject({ maxInputImages: images, maxInputVideos: 0, maxInputAudios: audios });
    expect(model.metadata).toMatchObject({ parameterSource: "dream.video_schema", videoSchemaStatus: "live", canvasRunnable: true, supportsFirstLastFrames: false });
  });
  it("submits the complete Pro ID, polls the original task and extracts its original video URL", async () => {
    const model = modelFor("seedance-2.0-pro"), connector = miaowuConnectorForModels([model]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "original-pro-task", status: "queued" }))
      .mockResolvedValueOnce(Response.json({ id: "original-pro-task", status: "completed", url: "https://media.example/original.webm" }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "same-key", provider: "rest", baseUrl: "https://api.miaowuai.store", apiKey: "synthetic-key",
      settings: { connector, modelCatalogModels: [model], scannedModelIds: [model.id], modelScanStatus: "live" } }]), { fetch: fetcher });
    const request: NormalizedRequest = { connectionId: "same-key", idempotencyKey: "isolated", model: model.id, operation: "video.generate", prompt: "Fixture video", parameters: { duration: 15, resolution: "480p", aspect_ratio: "21:9" } };
    expect((await adapter.validate(request)).valid).toBe(true);
    const task = await adapter.submit(request);
    const submitted = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(submitted).toMatchObject({ model: "seedance-2.0-pro", seconds: 15, resolution: "480p", ratio: "21:9" });
    expect(submitted).not.toHaveProperty("generate_audio");
    expect(task.providerTaskId).toBe("original-pro-task");
    const finished = await adapter.poll(task);
    expect(String(fetcher.mock.calls[1]![0])).toContain("/v1/videos/original-pro-task");
    expect(finished.status).toBe("succeeded");
    expect(await adapter.extractOutputs(finished.result)).toMatchObject([{ kind: "video", url: "https://media.example/original.webm" }]);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("rejects unsupported frame/audio/video material and duration combinations before submitting the Mini", async () => {
    const model = modelFor("doubao-seedance-2.0-mini"), connector = miaowuConnectorForModels([model]);
    const fetcher = vi.fn<typeof fetch>();
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "same-key", provider: "rest", baseUrl: "https://api.miaowuai.store", apiKey: "synthetic-key",
      settings: { connector, modelCatalogModels: [model], scannedModelIds: [model.id], modelScanStatus: "live" } }]), { fetch: fetcher });
    const request: NormalizedRequest = { connectionId: "same-key", idempotencyKey: "isolated", model: model.id, operation: "video.generate", prompt: "Fixture", parameters: { duration: 5, resolution: "720p", aspect_ratio: "16:9" } };
    for (const invalid of [
      { ...request, parameters: { ...request.parameters, duration: 4 } },
      { ...request, parameters: { ...request.parameters, resolution: "1080p" } },
      { ...request, parameters: { ...request.parameters, aspect_ratio: "1:1" } },
      { ...request, assets: [{ id: "frame", kind: "image" as const, role: "firstFrame" as const, mimeType: "image/png", url: "https://media.example/frame.png" }] },
      { ...request, assets: [{ id: "source", kind: "video" as const, mimeType: "video/mp4", url: "https://media.example/source.mp4" }] },
      { ...request, assets: [{ id: "source", kind: "audio" as const, mimeType: "audio/mpeg", url: "https://media.example/source.mp3" }] },
    ]) {
      expect((await adapter.validate(invalid)).valid).toBe(false);
      await expect(adapter.submit(invalid)).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
