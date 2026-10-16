import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GenericRestAdapter, StaticConnectionResolver, type ModelDescriptor, type NormalizedRequest } from "@super-canvas/providers";
import { miaowuConnectorForModels } from "./miaowu-catalog";
import { applyMiaowuVideoSchema, parseMiaowuVideoSchema } from "./miaowu-video-schema";

const fixture = JSON.parse(readFileSync(new URL("./miaowu-video-20261014.fixture.json", import.meta.url), "utf8"));
function modelFor(id: string): ModelDescriptor {
  const row = fixture.rows.find((value: { payload: { id: string } }) => value.payload.id === id);
  return applyMiaowuVideoSchema({ id, name: id, operations: ["video.generate"], outputKinds: ["video"], metadata: { parameterSource: "pricing.video_api" } },
    { id, sourceUrl: row.url, checkedAt: row.checkedAt, status: "live", httpStatus: row.httpStatus,
      normalizedSchemaSha256: row.sha256, contract: parseMiaowuVideoSchema(id, row.payload) });
}

describe("October 14 same-Key Miaowu native video schema update", () => {
  it.each([
    ["doubao-seedance-2.0-mini", 5, 15, ["720p"], 9, 0, 0],
    ["wan3.0-vedio-deal", 5, 30, ["480p"], 10, 0, 5],
    ["seedance-2.0", 4, 15, ["720p", "480p"], 9, 0, 3],
    ["seedance-2.0-fast", 4, 15, ["720p", "480p"], 9, 0, 3],
    ["seedance-2.5-deal", 4, 30, ["480p", "720p"], 30, 10, 10],
  ] as const)("applies the exact %s duration, resolution, ratio and input changes", (id, min, max, resolutions, images, videos, audios) => {
    const model = modelFor(id);
    expect(model.parameters?.find(parameter => parameter.key === "duration")).toMatchObject({ min, max });
    expect(model.parameters?.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value).sort()).toEqual([...resolutions].sort());
    expect(model.limits).toMatchObject({ maxInputImages: images, maxInputVideos: videos, maxInputAudios: audios });
    expect(model.metadata).toMatchObject({ parameterSource: "dream.video_schema", canvasRunnable: true, supportsFirstLastFrames: false });
  });

  it.each(["dola-seedance-2.0-fast", "dola-seedance-2.5"])("retains the full native %s schema when only its price changed", id => {
    const model = modelFor(id);
    expect(model.metadata?.videoSchemaStatus).toBe("live");
    expect(model.parameters?.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toContain("720p");
    expect(model.metadata?.videoContractCheckedAt).toContain("2026-10-14");
  });

  it.each(["doubao-seedance-2.0-mini", "wan3.0-vedio-deal", "seedance-2.5-deal"])("submits %s once and restores the original task without generating again", async id => {
    const model = modelFor(id), connector = miaowuConnectorForModels([model]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "original-oct14-task", status: "queued" }))
      .mockResolvedValueOnce(Response.json({ id: "original-oct14-task", status: "completed", url: "https://media.example/original.mp4" }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "same-key-default", provider: "rest", baseUrl: "https://api.miaowuai.store", apiKey: "synthetic-fixture",
      settings: { connector, scannedModelIds: [id], modelCatalogModels: [model], modelScanStatus: "live", accountKeyGroup: "default", modelGroup: "default" } }]), { fetch: fetcher });
    const request: NormalizedRequest = { connectionId: "same-key-default", model: id, operation: "video.generate", prompt: "Offline test", idempotencyKey: "offline-oct14",
      parameters: { duration: 10, resolution: id === "wan3.0-vedio-deal" ? "480p" : "720p", aspect_ratio: "16:9" } };
    const before = structuredClone(request), task = await adapter.submit(request), finished = await adapter.poll(task);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ model: id, seconds: 10, ratio: "16:9", resolution: request.parameters?.resolution });
    expect(String(fetcher.mock.calls[1]![0])).toContain("/v1/videos/original-oct14-task");
    expect(await adapter.extractOutputs(finished.result)).toMatchObject([{ kind: "video", url: "https://media.example/original.mp4" }]);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(request).toEqual(before);
  });
});
