import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  applyChuangxiangImageCapabilities,
  chuangxiangImageEvidence,
} from "./chuangxiang-image-capabilities.js";
import { chuangxiangImageVerification } from "./chuangxiang-image-evidence.js";
import type { ModelDescriptor } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { OpenAIImageAdapter } from "./openai.js";
import { imageSizeForTier, type ImageSizeTier } from "./image-size-presets.js";

const config = {
  baseUrl: "https://vapi.chuangxiangai.asia",
  modelGroup: "生图",
  usage: "canvas",
};
const model: ModelDescriptor = {
  id: "gpt-image-2.5-flare-yf",
  name: "Flare",
  operations: ["image.generate"],
  metadata: { priceLabel: "¥0.08/张" },
};

describe("Chuangxiang paid image evidence", () => {
  it("requires a decoded image witness for every advertised tier, quality and tested size", () => {
    const report = JSON.parse(
      readFileSync(
        new URL(
          "../../../docs/chuangxiang-image-verification-2026-09-21.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      cases: Array<{
        model: string;
        requestedQuality: string;
        requestedTier: string;
        requestedSize: string;
        outcome: string;
        width: number;
        height: number;
      }>;
    };
    for (const [id, evidence] of Object.entries(chuangxiangImageVerification)) {
      const images = report.cases.filter(
        (r) => r.model === id && r.outcome === "image",
      );
      const matches = (r: (typeof images)[number]) => {
        const [w, h] = r.requestedSize.split("x").map(Number);
        return Math.abs(r.width / r.height / (w! / h!) - 1) <= 0.025;
      };
      const nearestTier = (r: (typeof images)[number]) =>
        (["1K", "2K", "4K"] as ImageSizeTier[])
          .map((tier) => {
            const [w, h] = imageSizeForTier(tier, `${r.width}:${r.height}`)
              .split("x")
              .map(Number);
            return { tier, distance: Math.hypot(r.width - w!, r.height - h!) };
          })
          .sort((a, b) => a.distance - b.distance)[0]!.tier;
      for (const quality of evidence.qualities)
        expect(images.some((r) => r.requestedQuality === quality)).toBe(true);
      for (const tier of evidence.tiers)
        expect(
          images.some(
            (r) =>
              r.requestedTier === tier && nearestTier(r) === tier && matches(r),
          ),
        ).toBe(true);
      for (const size of evidence.testedSizes)
        expect(
          images.some(
            (r) =>
              r.requestedSize === size &&
              matches(r) &&
              nearestTier(r) === r.requestedTier,
          ),
        ).toBe(true);
      for (const size of evidence.mismatchedSizes)
        expect(
          images.some((r) => r.requestedSize === size && !matches(r)),
        ).toBe(true);
      for (const size of evidence.failedSizes)
        expect(
          report.cases.some(
            (r) =>
              r.model === id &&
              r.requestedQuality === "high" &&
              r.requestedSize === size &&
              r.outcome === "error",
          ),
        ).toBe(true);
      expect(
        evidence.qualities.every((q) => ["high", "xhigh", "max"].includes(q)),
      ).toBe(true);
    }
  });
  it("scopes evidence to the exact HTTPS origin, group, model and canvas connection", () => {
    expect(chuangxiangImageEvidence(config, model.id)).toBeDefined();
    expect(
      chuangxiangImageEvidence(
        {
          ...config,
          baseUrl: config.baseUrl + "/v1/",
          modelGroup: "自定义名称",
          accountKeyGroup: "生图",
        },
        model.id,
      ),
    ).toBeDefined();
    for (const changed of [
      { baseUrl: "https://vapi.chuangxiangai.asia.example.com" },
      { baseUrl: "http://vapi.chuangxiangai.asia" },
      { baseUrl: config.baseUrl + "/custom" },
      { baseUrl: config.baseUrl + "?group=生图" },
      { baseUrl: config.baseUrl + "#fragment" },
      { baseUrl: "https://user:pass@vapi.chuangxiangai.asia" },
      { baseUrl: "https://api.eaheng.com" },
      { accountKeyGroup: "其他" },
      { modelGroup: "其他" },
      { usage: "agent" },
      { usage: "disabled" },
      { supplierArchived: true },
    ])
      expect(
        chuangxiangImageEvidence({ ...config, ...changed }, model.id),
      ).toBeUndefined();
    expect(
      chuangxiangImageEvidence(config, "grok-imagine-image-quality"),
    ).toBeUndefined();
    expect(chuangxiangImageEvidence(config, "gpt-image-2.5")).toBeUndefined();
  });
  it("labels a wrong ratio separately from an untested preset and preserves pricing and operations", () => {
    const result = applyChuangxiangImageCapabilities(
      { provider: "openai", config },
      model,
    );
    const size = result.parameters!.find((p) => p.key === "size")!;
    expect(size.options?.find((o) => o.value === "768x1360")?.label).toContain(
      "实测比例有偏差",
    );
    expect(size.options?.find((o) => o.value === "1536x2720")?.label).toContain(
      "比例预设",
    );
    expect(
      size.options?.find((o) => o.value === "3840x2160")?.label,
    ).not.toContain("预设");
    expect(result.operations).toEqual(["image.generate"]);
    expect(result.metadata?.priceLabel).toBe(model.metadata!.priceLabel);
    expect(
      result.parameters?.find((p) => p.key === "quality")?.description,
    ).toContain("其余选项未逐档实测");
    expect(
      applyChuangxiangImageCapabilities({ provider: "openai", config }, result),
    ).toEqual(result);
  });
  it("does not classify a shrunken 4K response as 4K or enable denied models", () => {
    const evidence = chuangxiangImageEvidence(
      config,
      "gpt-image-2.5-sunburst-cf",
    )!;
    expect(evidence.tiers).not.toContain("4K");
    expect(evidence.note).toContain("1672×941");
    const denied = { ...model, metadata: { canvasRunnable: false } };
    expect(
      applyChuangxiangImageCapabilities({ provider: "openai", config }, denied),
    ).toBe(denied);
    expect(
      applyChuangxiangImageCapabilities({ provider: "rest", config }, model),
    ).toBe(model);
    const editingOnly = { ...model, operations: ["image.edit"] as const };
    expect(
      applyChuangxiangImageCapabilities(
        { provider: "openai", config },
        { ...editingOnly, operations: [...editingOnly.operations] },
      ).parameters,
    ).toBeUndefined();
  });
  it("distinguishes a service error from an untested ratio without mislabeling a successful size", () => {
    const failed = applyChuangxiangImageCapabilities(
      { provider: "openai", config },
      { ...model, id: "gpt-image-2.5-cf" },
    );
    expect(
      failed.parameters
        ?.find((p) => p.key === "size")
        ?.options?.find((o) => o.value === "768x1360")?.label,
    ).toContain("本轮服务错误");
    const baseline = applyChuangxiangImageCapabilities(
      { provider: "openai", config },
      { ...model, id: "gpt-image-2-cf" },
    );
    expect(
      baseline.parameters
        ?.find((p) => p.key === "size")
        ?.options?.find((o) => o.value === "1024x1024")?.label,
    ).not.toContain("服务错误");
  });
  it("allows later 4K requests while preserving suffixes and rejecting invalid quality", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from("fixture").toString("base64") }],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const adapter = new OpenAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "test",
          provider: "openai",
          apiKey: "fixture",
          baseUrl: config.baseUrl + "/v1",
          settings: config,
        },
      ]),
      { fetch: fetchMock },
    );
    const request = {
      connectionId: "test",
      operation: "image.generate" as const,
      model: model.id,
      prompt: "fixture",
      idempotencyKey: "fixture",
    };
    await adapter.submit({
        ...request,
        model: "gpt-image-2.5-sunburst-cf",
        parameters: { size: "3840x2160", quality: "high" },
      });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ model: "gpt-image-2.5-sunburst-cf", size: "3840x2160" });
    await adapter.submit({
        ...request,
        model: "gpt-image-2.5-sunburst-cf",
        parameters: { size: "auto", size_tier: "4K", quality: "high" },
      });
    fetchMock.mockClear();
    await expect(
      adapter.submit({ ...request, parameters: { quality: "ultra" } }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    await adapter.submit({
      ...request,
      parameters: { size: "3840x2160", quality: "max", n: 1 },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(config.baseUrl + "/v1/images/generations");
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: model.id,
      size: "3840x2160",
      quality: "max",
      n: 1,
    });
    for (const quality of ["auto", "low", "medium", "high", "xhigh", "max"]) {
      await adapter.submit({ ...request, parameters: { size: "1024x1024", quality } });
      const last = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
      expect(JSON.parse(String(last[1].body))).toMatchObject({ model: model.id, quality });
    }
    for (const quality of ["low", "medium", "high"]) {
      await adapter.submit({ ...request, model: "gpt-image-2-cf", parameters: { size: "1024x1024", quality } });
      const last = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
      expect(JSON.parse(String(last[1].body))).toMatchObject({ model: "gpt-image-2-cf", quality });
    }
  });
  it("opens six options only for a 2.5 route with max evidence, and three for Image 2 high", () => {
    for (const [id, expected] of [
      ["gpt-image-2.5-flare-yf", ["auto", "low", "medium", "high", "xhigh", "max"]],
      ["gpt-image-2.5-yf", ["high"]],
      ["gpt-image-2-cf", ["low", "medium", "high"]],
    ] as const) {
      const result = applyChuangxiangImageCapabilities({ provider: "openai", config }, { ...model, id });
      expect(result.parameters?.find(p => p.key === "quality")?.options?.map(o => o.value)).toEqual(expected);
      expect(result.metadata?.imageTestedQualities).toEqual(chuangxiangImageVerification[id]!.qualities);
    }
  });
});
