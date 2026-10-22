import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GenericRestAdapter, StaticConnectionResolver, type ModelDescriptor, type NormalizedRequest } from "@super-canvas/providers";
import { modelPriceAmount } from "@super-canvas/providers/media-billing";
import { miaowuConnectorForModels } from "./miaowu-catalog";
import { applyMiaowuVideoSchema, parseMiaowuVideoSchema } from "./miaowu-video-schema";

const fixture = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/fixtures/supplier-a-update-20261021.json", import.meta.url), "utf8")).miaowu;
function modelFor(id: string): ModelDescriptor {
  const payload = fixture.data.find((r: { id: string }) => r.id === id);
  return applyMiaowuVideoSchema({ id, name: id, operations: ["video.generate"], outputKinds: ["video"], metadata: { marketplaceGroup: "default", parameterSource: "key-model-scan" } },
    { id, sourceUrl: `https://api.miaowuai.store/v1/dream/model_schema?model=${encodeURIComponent(id)}`, checkedAt: fixture.checkedAt, status: "live", httpStatus: 200,
      contract: parseMiaowuVideoSchema(id, payload) });
}
describe("Miaowu October21 exact native WAN offers", () => {
  it.each([["wan3.0-vedio-deal", 1.5], ["wan3.0-video-prime-deal", 2.5]] as const)("keeps %s's per-call prices and three schema resolutions together", (id, amount) => {
    const model = modelFor(id);
    expect(model.parameters?.find(p => p.key === "resolution")?.options?.map(o => o.value)).toEqual(["480p", "720p", "1080p"]);
    expect(model.pricing).toMatchObject({ currency: "CNY", billingUnit: "request", kind: "per-request" });
    for (const resolution of ["480p", "720p", "1080p"]) for (const duration of [5, 30]) expect(modelPriceAmount(model.pricing!, { resolution, duration })).toBe(amount);
    expect(model.limits).toMatchObject({ maxInputVideos: 0 });
  });
  it("ignores saved legacy mode without forwarding it or changing the saved values and recovers the original task", async () => {
    const id = "wan3.0-video-prime-deal", model = modelFor(id), connector = miaowuConnectorForModels([model]);
    const resolver = new StaticConnectionResolver([{ id: "miaowu", provider: "rest", baseUrl: "https://api.miaowuai.store", apiKey: "offline-key", settings: {
      connector, accountKeyGroup: "default", modelGroup: "default", usage: "canvas", modelScanStatus: "live", scannedModelIds: [id], modelCatalogModels: [model],
    } }]);
    const input: NormalizedRequest = { connectionId: "miaowu", model: id, prompt: "Offline native schema", operation: "video.generate", idempotencyKey: "offline-once",
      parameters: { duration: 5, aspect_ratio: "16:9", resolution: "1080p", mode: "legacy-reference-mode" } }, before = structuredClone(input);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "same-task", status: "queued" }))
      .mockResolvedValueOnce(Response.json({ id: "same-task", status: "completed", url: "https://result.example/original.mp4" }));
    const adapter = () => new GenericRestAdapter(resolver, { fetch: fetcher });
    expect(await adapter().validate(input)).toEqual({ valid: true, issues: [] });
    expect(fetcher).not.toHaveBeenCalled();
    const task = await adapter().submit(input), body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(body).toMatchObject({ model: id, seconds: 5, resolution: "1080p", ratio: "16:9" });
    expect(body).not.toHaveProperty("mode");
    expect(await adapter().validate({ ...input, parameters: { ...input.parameters, fps: 60 } })).toMatchObject({ valid: false });
    const done = await adapter().poll(JSON.parse(JSON.stringify(task)));
    expect(done.status).toBe("succeeded");
    expect(await adapter().extractOutputs(done.result)).toMatchObject([{ url: "https://result.example/original.mp4" }]);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(input).toEqual(before);
  });
});
