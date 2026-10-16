import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseTk1688Marketplace, normalizeTk1688CnyModel } from "./tk1688-catalog.js";
import { applyUserImageSizePresets } from "./image-size-presets.js";
import { applyUserImageQualityPresets } from "./user-image-quality-presets.js";
import { OpenAIImageAdapter } from "./openai.js";
import { StaticConnectionResolver } from "./credentials.js";
import { tk1688DescriptionFacts } from "./tk1688-image-size-contract.js";

type Row = Record<string, unknown> & { alias: string; base_model: string; charge_type: string; input_price_usd: number };
const evidence = JSON.parse(readFileSync(new URL("./fixtures/tk1688-20261014.json", import.meta.url), "utf8")) as {
  evidence: { url: string; sampledAt: string; sha256: string }[];
  market: { success: true; data: { items: Row[]; total: number } };
  status: { data: { payment_fx_rate_cny_per_usd: number } };
  accountModelIds: string[]; keyModelIds: string[];
  changes: { model: string; group: string; type: string; new?: Row | null; old?: Row | null; fields?: Record<string, { old: unknown; new: unknown }> }[];
};
const checkedAt = evidence.evidence.find(source => source.url.endsWith("/listings"))!.sampledAt;
const parsed = parseTk1688Marketplace(evidence.market, evidence.status, { checkedAt });
const current = new Map(parsed.models.map(model => [model.id, model]));
const rows = new Map(evidence.market.data.items.map(row => [row.alias, row]));
const addedImages = evidence.changes.filter(change => change.new?.charge_type === "per_request");

describe("词元 2026-10-14 official marketplace changes (no live generation)", () => {
  it("does not promote negative native-output wording to a native resolution claim", () => {
    for (const description of ["非原生4k，超分4k", "不支持原生4k，超分4k", "not native 4k, upscaled 4k"])
      expect(tk1688DescriptionFacts(description)).toMatchObject({ nativeResolutions: [], upscaledResolutions: ["4K"] });
  });
  it("reads all 686 aliases, excludes six currently offline channels and 123 unreturned aliases only in this snapshot", () => {
    expect(parsed.complete).toBe(true);
    expect(parsed.models.filter(model => model.id.includes("@"))).toHaveLength(680);
    expect(parsed.excludedModelIds).toHaveLength(6);
    expect(evidence.changes).toHaveLength(275);
    expect(addedImages).toHaveLength(8);
    expect(evidence.changes.filter(change => change.new === null)).toHaveLength(123);
    expect(parsed.models.some(model => model.operations.includes("video.generate"))).toBe(false);
  });

  it.each(evidence.changes.map(change => [change.model, change] as const))("maps the exact changed alias %s to current price, permissions and facts", (_id, change) => {
    const model = current.get(change.model);
    const row = rows.get(change.model);
    if (change.new === null) {
      expect(model).toBeUndefined();
      return;
    }
    expect(row).toBeDefined();
    if (row!.channel_alive === false) {
      expect(model).toBeUndefined();
      expect(parsed.excludedModelIds).toContain(change.model);
      return;
    }
    expect(model?.id).toBe(change.model);
    expect(model?.description).toBe(row!.description);
    expect(model?.metadata?.tk1688MerchantId).toBe(row!.supplier_id);
    expect(model?.metadata?.tk1688Channel).toBe(row!.channel_no);
    expect(model?.metadata?.tk1688CatalogCheckedAt).toBe(checkedAt);
    if (row!.charge_type === "per_request") {
      expect(model?.operations).toEqual(["image.generate", "image.edit"]);
      expect(model?.pricing).toMatchObject({ currency: "CNY", billingUnit: "request",
        unitAmount: Number((row!.input_price_usd * 6.8896).toPrecision(10)) });
      expect(model?.metadata?.tk1688OriginalPricing).toMatchObject({ currency: "USD", unitAmount: row!.input_price_usd });
    } else {
      expect(model?.operations).toEqual([]);
      expect(model?.outputKinds).toEqual(["text"]);
      expect(model?.metadata?.tk1688ContextTokens).toBe(row!.context_tokens ?? undefined);
      expect(model?.metadata?.tk1688MaxOutputTokens).toBe(row!.max_output_tokens ?? undefined);
      expect(model?.metadata?.tk1688OriginalPricing).toMatchObject({ currency: "USD" });
    }
  });

  it("joins both current default/vip Key families with account aliases without giving another Key their access", () => {
    const available = parseTk1688Marketplace(evidence.market, evidence.status, { checkedAt,
      accountModelIds: evidence.accountModelIds, keyModelIds: evidence.keyModelIds }).models;
    for (const change of addedImages) expect(available.some(model => model.id === change.model)).toBe(true);
    expect(parseTk1688Marketplace(evidence.market, evidence.status, { accountModelIds: evidence.accountModelIds,
      keyModelIds: ["unrelated-text-model"] }).models).toEqual([]);
    expect(parseTk1688Marketplace(evidence.market, evidence.status, { accountModelIds: [],
      keyModelIds: evidence.keyModelIds }).models).toEqual([]);
  });

  it("separates s109c434 native 1K/2K and upscaled 4K, sample time and merchant publication time", () => {
    const model = current.get("gpt-image-2.5-flare@s109c434")!;
    expect(model.metadata).toMatchObject({ tk1688NativeResolutions: ["1K", "2K"], tk1688UpscaledResolutions: ["4K"],
      tk1688ListingCreatedAt: "2026-10-14T06:03:05.000Z" });
    expect(normalizeTk1688CnyModel(model)).toEqual(model);
    expect(current.get("gpt-image-2.5-flare")?.metadata?.tk1688NativeResolutions).toBeUndefined();
    expect(current.get("gpt-image-2.5-flare")?.metadata?.tk1688ListingCreatedAt).toBeUndefined();
  });

  it.each(addedImages.map(change => [change.model] as const))("sends exact %s with user 4K/max and extracts the original result using an isolated transport", async modelId => {
    const model = applyUserImageQualityPresets(applyUserImageSizePresets(current.get(modelId)!));
    expect(model.parameters?.find(parameter => parameter.key === "quality")?.default).toBe("max");
    expect(model.metadata?.imageUserSizePresetTiers).toEqual(["1K", "2K", "4K"]);
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ url: "https://output.example/unchanged.png" }] }));
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "tk-test", provider: "openai", apiKey: "test-only",
      baseUrl: "https://api.tk1688.com/v1", settings: { modelCatalogModels: [model] } }]), { fetch: fetcher });
    const task = await adapter.submit({ connectionId: "tk-test", operation: "image.generate", model: modelId,
      prompt: "contract test", parameters: { size: "3840x2160", resolution: "4K", aspect_ratio: "16:9", quality: "max", response_format: "url" }, idempotencyKey: "isolated-fixture" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.tk1688.com/v1/images/generations");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ model: modelId, size: "3840x2160", quality: "max" });
    expect(await adapter.extractOutputs(task.result)).toEqual([expect.objectContaining({ url: "https://output.example/unchanged.png", kind: "image" })]);
  });
});
