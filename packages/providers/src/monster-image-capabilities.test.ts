import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  applyMonsterImageCapabilities,
  monsterImageEvidence,
} from "./monster-image-capabilities.js";
import { OpenAIImageAdapter } from "./openai.js";
import { StaticConnectionResolver } from "./credentials.js";
import type { ModelDescriptor } from "./contracts.js";
import { imageSizeForTier } from "./image-size-presets.js";

const group = "B3-GPT生图-特惠渠道";
const config = {
  baseUrl: "https://api.eaheng.com",
  modelGroup: group,
  supplierKey: "custom-example",
  usage: "canvas",
};
const model: ModelDescriptor = {
  id: "gpt-image-2.5",
  name: "Image 2.5",
  operations: ["image.generate"],
  metadata: { priceLabel: "1张0.015" },
};

describe("Monster image capabilities from paid generation evidence", () => {
  it("has a successful paid image witness for every exposed model, tier and quality value", () => {
    const report = JSON.parse(
      readFileSync(
        new URL(
          "../../../docs/monster-image-verification-2026-09-20.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      cases: Array<{
        groupName: string;
        model: string;
        requestedSize: string;
        requestedQuality: string;
        outcome: string;
        width: number | null;
        height: number | null;
      }>;
    };
    const groups = [...new Set(report.cases.map((row) => row.groupName))];
    const models = [
      "gpt-image-2",
      "gpt-image-2.5",
      "gpt-image-2.5-flare",
      "gpt-image-2.5-sunburst",
    ];
    for (const modelGroup of groups)
      for (const id of models) {
        const verified = monsterImageEvidence({ ...config, modelGroup }, id)!;
        expect(verified).toBeDefined();
        const images = report.cases.filter(
          (row) =>
            row.groupName === modelGroup &&
            row.model === id &&
            row.outcome === "image",
        );
        // User classification: compare actual dimensions with same-aspect
        // 2K / 4K presets; a near-4K image counts as 4K, not native 4K.
        const closerTo4K = (width: number, height: number) => {
          const distance = (tier: "2K" | "4K") => {
            const [w, h] = imageSizeForTier(tier, `${width}:${height}`).split("x").map(Number);
            return Math.hypot(width - w!, height - h!);
          };
          return distance("4K") < distance("2K");
        };
        for (const value of verified.qualities)
          expect(images.some((row) => row.requestedQuality === value)).toBe(
            true,
          );
        for (const tier of verified.tiers)
          expect(
            images.some((row) =>
              tier === "1K"
                ? row.requestedSize === "1024x1024" &&
                  Math.min(row.width!, row.height!) >= 1024
                : tier === "2K"
                  ? ["2048x2048", "1536x2720"].includes(row.requestedSize) &&
                    Math.max(row.width!, row.height!) >= 2048
                  : row.requestedSize === "3840x2160" &&
                    closerTo4K(row.width!, row.height!),
            ),
          ).toBe(true);
      }
  });
  it("scopes capabilities to the exact host, group, model and canvas usage", () => {
    expect(monsterImageEvidence(config, model.id)?.tiers).toEqual(["1K", "2K"]);
    expect(
      monsterImageEvidence(
        { ...config, baseUrl: config.baseUrl + "/v1/" },
        model.id,
      ),
    ).toBeDefined();
    for (const changed of [
      { baseUrl: "https://api.eaheng.com.example.test" },
      { baseUrl: "https://other.example" },
      { baseUrl: "http://api.eaheng.com" },
      { baseUrl: "https://api.eaheng.com/custom" },
      { baseUrl: "https://user:pass@api.eaheng.com" },
      { modelGroup: "B3-other" },
      { usage: "agent" },
      { usage: "disabled" },
      { supplierArchived: true },
    ])
      expect(
        monsterImageEvidence({ ...config, ...changed }, model.id),
      ).toBeUndefined();
    expect(monsterImageEvidence(config, "gpt-image-3")).toBeUndefined();
    expect(
      monsterImageEvidence(
        { ...config, modelGroup: "用户起的别名", accountKeyGroup: group },
        model.id,
      ),
    ).toBeDefined();
  });
  it("adds only verified tiers and labels untested ratio presets without widening operations", () => {
    const result = applyMonsterImageCapabilities(
      { provider: "openai", config },
      model,
    );
    const size = result.parameters?.find((p) => p.key === "size");
    expect(size?.control).toBe("dimensions");
    expect(size?.options?.some((o) => o.label.startsWith("4K"))).toBe(false);
    expect(
      size?.options?.find((o) => o.value === "2048x2048")?.label,
    ).not.toContain("预设");
    expect(size?.options?.some((o) => o.label.includes("比例预设"))).toBe(true);
    expect(result.operations).toEqual(["image.generate"]);
    expect(result.metadata?.priceLabel).toBe("1张0.015");
    expect(result.metadata?.imageCapabilityNote).toContain("不支持 4K");
    expect(
      applyMonsterImageCapabilities({ provider: "openai", config }, result),
    ).toEqual(result);
  });
  it("does not override an unavailable model, a non-image operation or another transport", () => {
    const denied = {
      ...model,
      metadata: {
        canvasRunnable: false,
        canvasUnavailableReason: "403 权限拒绝",
      },
    };
    expect(
      applyMonsterImageCapabilities({ provider: "openai", config }, denied),
    ).toBe(denied);
    const noOperation = { ...model, operations: [] };
    expect(
      applyMonsterImageCapabilities(
        { provider: "openai", config },
        noOperation,
      ),
    ).toBe(noOperation);
    expect(
      applyMonsterImageCapabilities({ provider: "rest", config }, model),
    ).toBe(model);
  });
  it.each(["gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])(
    "offers near-4K %s outputs in the 4K tier while retaining actual pixels",
    (id) => {
      for (const modelGroup of [
        "B1-GPT生图原生渠道V1",
        "B2-GPT生图原生渠道V2（推荐）",
      ]) {
        const verified = monsterImageEvidence({ ...config, modelGroup }, id)!;
        expect(verified.tiers).toEqual(["1K", "2K", "4K"]);
        expect(verified.note).toContain("3584×2016");
        expect(verified.note).toContain("归为 4K");
        expect(verified.testedSizes).toContain("3840x2160");
        expect(verified.qualities).toEqual(id === "gpt-image-2.5"
          ? ["auto", "low", "medium", "high", "xhigh", "max"]
          : ["high", "max"]);
      }
      expect(
        monsterImageEvidence(
          { ...config, modelGroup: "B4-GPT生图原生渠道V3（高质量）" },
          id,
        )?.tiers,
      ).toContain("4K");
    },
  );
  it("allows extended quality values only for the exact tested GPT Image 2 route", async () => {
    const adapter = new OpenAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "tested",
          provider: "openai",
          apiKey: "fixture",
          baseUrl: config.baseUrl,
          settings: { modelGroup: "B1-GPT生图原生渠道V1" },
        },
        {
          id: "other",
          provider: "openai",
          apiKey: "fixture",
          baseUrl: "https://unrelated.example",
          settings: { modelGroup: "B1-GPT生图原生渠道V1" },
        },
      ]),
    );
    const request = {
      operation: "image.generate" as const,
      prompt: "Test",
      model: "gpt-image-2",
      idempotencyKey: "fixture",
      parameters: { size: "3840x2160", quality: "max" },
    };
    expect(
      (await adapter.validate({ ...request, connectionId: "tested" })).valid,
    ).toBe(true);
    expect(
      (await adapter.validate({ ...request, connectionId: "other" })).valid,
    ).toBe(false);
    expect(
      monsterImageEvidence(config, "gpt-image-2")?.qualities,
    ).not.toContain("low");
    expect(
      monsterImageEvidence(config, "gpt-image-2")?.qualities,
    ).not.toContain("auto");
    expect(monsterImageEvidence(config, "gpt-image-2.5")?.qualities).toContain(
      "low",
    );
  });
  it("rejects an unverified 4K request before spending money and preserves accepted payloads", async () => {
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
          id: "monster",
          provider: "openai",
          apiKey: "fixture-key",
          baseUrl: config.baseUrl + "/v1",
          settings: config,
        },
        {
          id: "monster-near-4k",
          provider: "openai",
          apiKey: "fixture-key",
          baseUrl: config.baseUrl,
          settings: { ...config, modelGroup: "B1-GPT生图原生渠道V1" },
        },
      ]),
      { fetch: fetchMock },
    );
    const request = {
      connectionId: "monster",
      operation: "image.generate" as const,
      prompt: "Test",
      model: model.id,
      idempotencyKey: "fixture",
    };
    await expect(
      adapter.submit({
        ...request,
        parameters: { size: "3840x2160", quality: "high" },
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      (
        await adapter.validate({
          ...request,
          parameters: { quality: "unsupported-quality-probe" },
        })
      ).valid,
    ).toBe(false);
    await adapter.submit({
      ...request,
      parameters: { size: "2048x2048", quality: "medium", n: 1 },
    });
    const init = (
      fetchMock.mock.calls[0] as unknown as [unknown, RequestInit]
    )[1];
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: model.id,
      size: "2048x2048",
      quality: "medium",
      n: 1,
    });
    await adapter.submit({
      ...request,
      connectionId: "monster-near-4k",
      model: "gpt-image-2.5-sunburst",
      parameters: { size: "3840x2160", quality: "max", n: 1 },
    });
    const near4KInit = (fetchMock.mock.calls[1] as unknown as [unknown, RequestInit])[1];
    expect(JSON.parse(String(near4KInit.body))).toMatchObject({
      model: "gpt-image-2.5-sunburst",
      size: "3840x2160",
      quality: "max",
    });
  });
});
