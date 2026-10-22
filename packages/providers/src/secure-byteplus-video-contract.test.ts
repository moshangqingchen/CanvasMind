import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { NormalizedRequest } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";
import { parseSupplierPricingChannels } from "./supplier-catalog.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { isRemainingVideoModel, normalizeRemainingVideoParameters, remainingVideoModel, remainingVideoRequestIssues, remainingVideoTransport } from "./remaining-video-contracts.js";

const context = { baseUrl: "https://token.secure-skill.com", group: "海外sd-fast/mini", officialGroupId: "60" };
const ids = ["dreamina-seedance-2-0-fast", "dreamina-seedance-2-0-mini"];
const request = (model = ids[0]!, parameters: Record<string, unknown> = { duration: 15, resolution: "480p", aspect_ratio: "16:9" }): NormalizedRequest => ({
  connectionId: "secure60", model, operation: "video.generate", prompt: "Offline contract", idempotencyKey: "offline-only", parameters,
});

describe("Secure group60 BytePlus mapped video contract", () => {
  it("classifies all exact current mappings as videos and preserves each group's own pricing", () => {
    const payload = JSON.parse(readFileSync(new URL("./fixtures/secure-new-media-20261020.json", import.meta.url), "utf8"));
    const groups = parseSupplierPricingChannels(payload, "CNY", { supplierSiteUrl: context.baseUrl, sourceUrl: payload.sourceUrl, checkedAt: payload.checkedAt });
    const byteplus = groups.find(g => g.supplierGroupId === "60")!;
    expect(byteplus.models.map(m => m.id).sort()).toEqual([...ids].sort());
    for (const model of byteplus.models) expect(model).toMatchObject({ capability: "video", outputKinds: ["video"], metadata: { secureSkillCatalogPricing: { kind: "token", currency: "CNY" } } });
    expect(groups.find(g => g.supplierGroupId === "62")?.models.map(m => m.priceLabel)).toEqual([
      "1K ¥0.08/张 · 2K ¥0.08/张 · 4K ¥0.08/张", "1K ¥0.08/张 · 2K ¥0.08/张 · 4K ¥0.08/张",
    ]);
    expect(groups.find(g => g.supplierGroupId === "61")?.models[0]).toMatchObject({ id: "kling-video-v4", priceLabel: "720p ¥0.35/秒 · 1080p ¥0.45/秒" });
  });

  it.each(ids)("requires the supplier origin, stable group60 and complete %s identity", id => {
    expect(isRemainingVideoModel("secure", id, context)).toBe(true);
    for (const changed of [{ ...context, officialGroupId: "59" }, { ...context, officialGroupId: undefined }, { ...context, manualProtocol: true },
      { ...context, baseUrl: "https://token.secure-skill.com.evil.example" }, { ...context, baseUrl: "https://other.example" }]) {
      expect(isRemainingVideoModel("secure", id, changed)).toBe(false);
      expect(remainingVideoTransport("secure", id, changed)).toBeUndefined();
    }
    expect(isRemainingVideoModel("secure", id + "-preview", context)).toBe(false);
    const model = remainingVideoModel("secure", id, { id, name: id, operations: ["video.generate"], limits: { maxInputImages: 9, maxInputAudios: 3 } }, context)!;
    expect(model.metadata).toMatchObject({ durationRangeSource: "user-fallback", userFallbackDurationRange: { min: 1, max: 15 }, generationVerified: false });
    expect(model.limits?.maxInputImages).toBeUndefined();
    expect(model.parameters?.find(p => p.key === "resolution")).toMatchObject({ control: "text", required: true });
  });

  it("preserves open resolution and parameters, and rejects invalid saved duration or absent resolution before submitting", () => {
    const input = request(ids[0], { duration: 16, resolution: "4K", aspect_ratio: "9:16" }), before = structuredClone(input);
    expect(normalizeRemainingVideoParameters("secure", input, context)).toMatchObject({ duration: 16, resolution: "4K", aspect_ratio: "9:16" });
    expect(remainingVideoRequestIssues("secure", input, context)).toContainEqual(expect.objectContaining({ path: "parameters.duration" }));
    expect(remainingVideoRequestIssues("secure", request(ids[0], { duration: 15 }), context)).toContainEqual(expect.objectContaining({ path: "parameters.resolution" }));
    expect(input).toEqual(before);
  });

  it.each(ids)("submits %s once with original URL roles, polls the same task after restart and keeps its signed result", async id => {
    const model = remainingVideoModel("secure", id, undefined, context)!;
    const connector: RestConnectorConfig = { auth: { type: "bearer" }, models: [model], submit: { path: "/unused", method: "POST", bodyMode: "json" },
      output: { path: "$.unused", kind: "video" }, ...remainingVideoTransport("secure", id, context) };
    const resolver = new StaticConnectionResolver([{ id: "secure60", provider: "rest", baseUrl: context.baseUrl, apiKey: "offline-fixture",
      settings: { connector, modelGroup: context.group, accountKeyGroupId: "60", usage: "canvas", modelScanStatus: "live", scannedModelIds: [id] } }]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "same-task", status: "queued" }))
      .mockResolvedValueOnce(Response.json({ id: "same-task", status: "completed", url: "https://result.example/original.mp4?signature=fixture" }));
    const input = { ...request(id), assets: [
      { id: "first", kind: "image" as const, role: "firstFrame" as const, mimeType: "image/png", url: "https://media.example/original.png" },
      { id: "audio", kind: "audio" as const, mimeType: "audio/wav", url: "https://media.example/original.wav" },
    ], parameters: { ...request(id).parameters, generate_audio: false, watermark: false, seed: 0 } };
    const before = structuredClone(input), task = await new GenericRestAdapter(resolver, { fetch: fetcher }).submit(input);
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(fetcher.mock.calls[0]![0]).toBe(context.baseUrl + "/v1/videos");
    expect(body).toMatchObject({ model: id, duration: 15, resolution: "480p", aspect_ratio: "16:9", generate_audio: false, watermark: false, seed: 0,
      content: [{ type: "text", text: input.prompt }, { type: "image_url", image_url: { url: input.assets[0]!.url }, role: "first_frame" },
        { type: "audio_url", audio_url: { url: input.assets[1]!.url }, role: "reference_audio" }] });
    expect(body).not.toHaveProperty("images");
    expect(connector.output?.contentFallback).toBeUndefined();
    const restarted = new GenericRestAdapter(resolver, { fetch: fetcher }), result = await restarted.poll(JSON.parse(JSON.stringify(task)));
    expect(result.status).toBe("succeeded");
    expect(await restarted.extractOutputs(result.result)).toMatchObject([{ kind: "video", url: "https://result.example/original.mp4?signature=fixture" }]);
    expect(fetcher.mock.calls[1]![0]).toBe(context.baseUrl + "/v1/videos/same-task");
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(input).toEqual(before);
  });

  it.each(ids)("routes the saved openai connection for %s through its stable group60 contract", async id => {
    const model = remainingVideoModel("secure", id, undefined, context)!;
    const settings = { accountKeyGroup: context.group, modelGroup: context.group, accountKeyGroupId: "60", usage: "canvas",
      modelScanStatus: "live", scannedModelIds: [id], modelCatalogModels: [{ ...model, metadata: { ...model.metadata, canvasRunnable: true } }],
      autoModelInterfaces: {} };
    const resolver = new StaticConnectionResolver([{ id: "secure60", provider: "openai", baseUrl: context.baseUrl + "/v1", apiKey: "offline-fixture", settings }]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "registry-task", status: "queued" }))
      .mockResolvedValueOnce(Response.json({ id: "registry-task", status: "completed", url: "https://result.example/registry.mp4?signature=fixture" }));
    const registry = () => createDefaultProviderRegistry(resolver, { fetch: fetcher }).get("openai");
    const input = { ...request(id), parameters: { ...request(id).parameters, generate_audio: false, seed: 0 } }, before = structuredClone(input);
    expect(await registry().validate(input)).toEqual({ valid: true, issues: [] });
    expect(fetcher).not.toHaveBeenCalled();
    const task = await registry().submit(input);
    expect(String(fetcher.mock.calls[0]![0])).toBe(context.baseUrl + "/v1/videos");
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ model: id, duration: 15, aspect_ratio: "16:9", resolution: "480p", generate_audio: false, seed: 0 });
    const completed = await registry().poll(JSON.parse(JSON.stringify(task)));
    expect(completed.status).toBe("succeeded");
    expect(String(fetcher.mock.calls[1]![0])).toBe(context.baseUrl + "/v1/videos/registry-task");
    expect(await registry().extractOutputs(completed.result)).toMatchObject([{ kind: "video", url: "https://result.example/registry.mp4?signature=fixture" }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(input).toEqual(before);
    expect(settings.accountKeyGroupId).toBe("60");
  });

  it.each(ids)("does not lend %s's openai route to another or absent stable group", async id => {
    const model = remainingVideoModel("secure", id, undefined, context)!;
    for (const accountKeyGroupId of [undefined, "59", "61"]) {
      const fetcher = vi.fn<typeof fetch>(async () => { throw new Error("No upstream request is allowed"); });
      const resolver = new StaticConnectionResolver([{ id: "secure60", provider: "openai", baseUrl: context.baseUrl + "/v1", apiKey: "offline-fixture",
        settings: { accountKeyGroup: context.group, modelGroup: context.group, ...(accountKeyGroupId ? { accountKeyGroupId } : {}),
          usage: "canvas", modelScanStatus: "live", scannedModelIds: [id],
          modelCatalogModels: [{ ...model, metadata: { ...model.metadata, canvasRunnable: true } }], autoModelInterfaces: {} } }]);
      const adapter = createDefaultProviderRegistry(resolver, { fetch: fetcher }).get("openai"), input = request(id), before = structuredClone(input);
      expect((await adapter.validate(input)).valid).toBe(false);
      await expect(adapter.submit(input)).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
      expect(input).toEqual(before);
    }
  });
});
