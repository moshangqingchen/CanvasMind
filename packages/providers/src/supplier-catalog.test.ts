import { describe, expect, it, vi } from "vitest";
import { discoverSupplierCatalog, normalizeSupplierSiteBase, normalizeSupplierUrl, parseSupplierCatalog, parseSupplierKeyGroups, parseSupplierPricingChannels, supplierModelUrls } from "./supplier-catalog.js";

describe("supplier discovery", () => {
  it.each(["timeout", "unauthorized", "invalid-body", "rejected-body"] as const)(
    "keeps NewAPI account groups but marks a %s price feed incomplete",
    async failure => {
      const calls: string[] = [];
      const result = await discoverSupplierCatalog({ kind: "newapi", siteUrl: "https://partial-price.example", apiUrl: "https://partial-price.example/v1" }, async url => {
        const endpoint = new URL(String(url)).pathname;
        calls.push(endpoint);
        if (endpoint === "/api/pricing") {
          if (failure === "timeout") throw new DOMException("Synthetic price timeout", "TimeoutError");
          if (failure === "unauthorized") return Response.json({ success: false }, { status: 401 });
          if (failure === "rejected-body") return Response.json({ success: true, code: 503, data: [], group_ratio: { default: 1 } });
          return Response.json({ success: true, data: { unavailable: true } });
        }
        if (endpoint === "/api/user/self/groups") return Response.json({ success: true, data: {
          default: { ratio: .5, desc: "当前账号默认分组" }, vip: { ratio: 1, desc: "当前账号 VIP 分组" },
        } });
        throw new Error("Unexpected synthetic catalog endpoint");
      });
      expect(result).toMatchObject({ kind: "newapi", status: "live", complete: false });
      expect(result.error).toContain("模型价格目录");
      expect(result.groups.map(group => ({ id: group.id, models: group.models }))).toEqual([
        { id: "default", models: [] }, { id: "vip", models: [] },
      ]);
      expect(result.groups[0]?.details?.rateMultiplier).toBe(.5);
      expect(calls).toEqual(["/api/pricing", "/api/user/self/groups"]);
    },
  );
  it("distinguishes a confirmed empty NewAPI price feed from a failed one while retaining account groups", async () => {
    const result = await discoverSupplierCatalog({ kind: "newapi", siteUrl: "https://empty-price.example", apiUrl: "https://empty-price.example/v1" }, async url => {
      const endpoint = new URL(String(url)).pathname;
      if (endpoint === "/api/pricing") return Response.json({ success: true, data: [], group_ratio: { default: 1 } });
      if (endpoint === "/api/user/self/groups") return Response.json({ success: true, data: { default: { ratio: 1, desc: "当前账号默认分组" } } });
      throw new Error("Unexpected synthetic catalog endpoint");
    });
    expect(result).toMatchObject({ kind: "newapi", status: "live", complete: true, groups: [{ id: "default", models: [] }] });
    expect(result.error).toBeUndefined();
  });
  it.each([
    [{ quota_display_type: "CUSTOM", custom_currency_symbol: "￥", custom_currency_exchange_rate: 1, usd_exchange_rate: 7.3 }, "¥0.2/请求"],
    [{ quota_display_type: "CNY", usd_exchange_rate: 7.3 }, "¥1.46/请求"],
    [{ quota_display_type: "USD", usd_exchange_rate: 7.3 }, "$0.2/请求"],
  ])("respects the supplier's accounting display without applying an unrelated exchange rate: %j", async (settings, priceLabel) => {
    const result = await discoverSupplierCatalog({ kind: "newapi", siteUrl: "https://currency.example", apiUrl: "https://currency.example/v1" }, async url => {
      if (String(url).endsWith("/api/status")) return Response.json({ success: true, data: settings });
      if (String(url).endsWith("/api/pricing")) return Response.json({ success: true, group_ratio: { default: 1 }, data: [{ model_name: "grok-video-1.5", model_price: 0.2, quota_type: 1, enable_groups: ["default"] }] });
      return Response.json({ success: true, data: [] });
    });
    expect(result.groups[0]?.models[0]?.priceLabel).toBe(priceLabel);
  });
  it("distinguishes music, speech, visual understanding and declared multi-output directories", () => {
    const models = parseSupplierCatalog({ data: [
      { id: "lyria-3-pro", output_modalities: ["audio"] },
      { id: "opaque-music", capability: "music", output_modalities: ["audio"] },
      { id: "tts-1", output_modalities: ["audio"] },
      { id: "image-understanding-pro", output_modalities: ["text"] },
      { id: "dual", operations: ["image.generate", "video.generate"] },
      { id: "video-image-to-video" },
    ] }).groups[0]!.models;
    expect(models.map(model => model.capability)).toEqual(["music", "music", "other", "chat", "video", "video"]);
    expect(models[4]?.outputKinds).toEqual(["image", "video"]);
    expect(models[4]?.metadata?.outputKindsSource).toBe("declared");
  });
  it("reads词元 official marketplace contracts with account groups instead of generic pricing", async () => {
    const calls: string[] = [];
    const alias = "gpt-image-2.5-sunburst@s47c261";
    const result = await discoverSupplierCatalog({ siteUrl: "https://tk1688.com", apiUrl: "https://api.tk1688.com/v1", token: "test-site-token:42" }, async (url, init) => {
      calls.push(String(url));
      if (String(url).endsWith("/marketplace/listings")) return Response.json({ success: true, data: { total: 1, items: [{
        id: 1, base_model: "gpt-image-2.5-sunburst", alias, status: "active", channel_alive: true,
        charge_type: "per_request", input_price_usd: 0.03, description: "Adobe原生4K(3840*2160)，不支持N。",
      }] } });
      if (String(url).endsWith("/api/status")) return Response.json({ success: true, data: { platform_markup_percent: 20, payment_fx_rate_cny_per_usd: 6.8896 } });
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-site-token");
      if (String(url).endsWith("/self/groups")) return Response.json({ success: true, data: { default: { ratio: 1, desc: "默认" }, vip: { ratio: 1, desc: "VIP" } } });
      return Response.json({ success: true, data: [alias] });
    });
    expect(calls).not.toContain("https://tk1688.com/api/pricing");
    expect(result).toMatchObject({ kind: "newapi", complete: true, status: "live" });
    for (const group of result.groups) {
      expect(group.models.find(model => model.id === alias)).toMatchObject({ capability: "image", priceLabel: "¥0.206688/次", limits: { maxOutputImages: 1 },
        metadata: { tk1688FixedSize: "3840x2160", tk1688OmitN: true, tk1688Pricing: { kind: "per-request", currency: "CNY", unitAmount: 0.206688 } } });
    }
  });
  it("keeps a failed词元 marketplace read incomplete without probing unrelated platform endpoints", async () => {
    const calls: string[] = [];
    const result = await discoverSupplierCatalog({ siteUrl: "https://tk1688.com", apiUrl: "https://api.tk1688.com/v1" }, async url => {
      calls.push(String(url)); return Response.json({ success: false }, { status: 503 });
    });
    expect(result).toMatchObject({ status: "failed", complete: false, groups: [] });
    expect(calls.some(url => url.includes("/api/v1/model-plaza"))).toBe(false);
  });
  it("reads the separate model-price page and isolates prices by exact group/model", async () => {
    const data = [{name:"Images",description:"支持low、high、max",platforms:[{
      groups:[{name:"gpt-image-2.5",rate_multiplier:1},{name:"discount",rate_multiplier:0.5}],
      supported_models:[{name:"gpt-image-2.5-flare",pricing:{billing_mode:"image",per_request_price:0.16}}],
    }]}];
    const groups = parseSupplierPricingChannels({code:0,data}, "CNY");
    expect(groups.map(group => group.models[0]?.priceLabel)).toEqual(["¥0.16/张", "¥0.08/张"]);
    expect(groups[0]?.models[0]?.metadata?.supplierChannelDescription).toBe("支持low、high、max");
    const result = await discoverSupplierCatalog({siteUrl:"https://token.secure-skill.com",apiUrl:"https://token.secure-skill.com/v1",kind:"sub2api"}, async url => {
      if (String(url).endsWith("/pricing/channels")) return Response.json({code:0,data});
      if (String(url).endsWith("/groups/available")) return Response.json({data:[{name:"gpt-image-2.5"}]});
      return Response.json({data:{groups:[]}});
    });
    expect(result.groups.find(group=>group.id==="gpt-image-2.5")?.models[0]?.priceLabel).toBe("¥0.16/张");
  });
  it("keeps identically named public groups separate by official ID in either channel order", () => {
    const channels = [
      { name: "sd2.5 second", platforms: [{ groups: [{ id: 54, name: "视频生成" }],
        supported_models: [{ name: "seedance-2.5", pricing: { billing_mode: "per_second", per_request_price: .62 } }] }] },
      { name: "sd first", platforms: [{ groups: [{ id: "53", name: "视频生成" }],
        supported_models: [{ name: "seedance-2.5", pricing: { billing_mode: "per_second", per_request_price: .55 } }] }] },
    ];
    const project = (data: typeof channels) => parseSupplierPricingChannels({ code: 0, data }, "CNY")
      .map(group => ({ id: group.id, supplierGroupId: group.supplierGroupId, price: group.models[0]?.priceLabel }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(project(channels)).toEqual([
      { id: "视频生成 [分组ID 53]", supplierGroupId: "53", price: "¥0.55/秒" },
      { id: "视频生成 [分组ID 54]", supplierGroupId: "54", price: "¥0.62/秒" },
    ]);
    expect(project([...channels].reverse())).toEqual(project(channels));
    const plaza = parseSupplierCatalog({ data: { groups: [
      { id: 53, name: "视频生成", models: ["seedance-2.5"] },
      { id: 54, name: "视频生成", models: ["seedance-2.5"] },
    ] } });
    expect(plaza.groups.map(group => group.supplierGroupId)).toEqual(["53", "54"]);
    expect(new Set(plaza.groups.map(group => group.id)).size).toBe(2);
  });
  it("imports Secure Skill resolution prices through exact account group IDs and preserves final image-group rates", async () => {
    const channels = [
      { name: "sd2.5-2", platforms: [{ groups: [{ id: 54, name: "视频生成", rate_multiplier: 1 }], supported_models: [{ name: "seedance-2.5",
        pricing: { billing_mode: "per_second", intervals: [{ tier_label: "480p", per_request_price: .4 }, { tier_label: "720p", per_request_price: .62 }, { tier_label: "1080p", per_request_price: 1.45 }] } }] }] },
      { name: "sd-first", platforms: [{ groups: [{ id: 53, name: "视频生成", rate_multiplier: 1 }], supported_models: [{ name: "seedance-2.5",
        pricing: { billing_mode: "per_second", intervals: [{ tier_label: "480p", per_request_price: .45 }, { tier_label: "720p", per_request_price: .55 }] } }] }] },
      { name: "image", platforms: [{ groups: [{ id: 9, name: "image-2-1k", rate_multiplier: .3, image_price_1k: .05, image_price_2k: .05, image_price_4k: .05 }],
        supported_models: [{ name: "gpt-image-2", pricing: { billing_mode: "image", per_request_price: .9 } }] }] },
    ];
    const calls: string[] = [];
    const result = await discoverSupplierCatalog({ siteUrl: "https://token.secure-skill.com", apiUrl: "", kind: "sub2api" }, async url => {
      calls.push(String(url));
      if (String(url).endsWith("/model-plaza")) return Response.json({}, { status: 404 });
      if (String(url).endsWith("/pricing/channels")) return Response.json({ code: 0, data: channels });
      if (String(url).endsWith("/groups/available")) return Response.json({ data: [{ id: 54, name: "sd2.5特价分组-2" }, { id: 53, name: "sd特价分组1" }, { id: 9, name: "image-2-1k" }] });
      throw new Error("Unexpected mock endpoint");
    });
    expect(result.groups.find(group => group.id === "sd2.5特价分组-2")).toMatchObject({ supplierGroupId: "54", models: [{ id: "seedance-2.5",
      metadata: { secureSkillCatalogPricing: { kind: "tiered", billingUnit: "second", tiers: [{ price: .4 }, { price: .62 }, { price: 1.45 }] } } }] });
    expect(result.groups.find(group => group.id === "sd特价分组1")).toMatchObject({ supplierGroupId: "53", models: [{ id: "seedance-2.5",
      metadata: { secureSkillCatalogPricing: { kind: "tiered", billingUnit: "second", tiers: [{ price: .45 }, { price: .55 }] } } }] });
    expect(result.groups.find(group => group.id === "image-2-1k")?.models[0]).toMatchObject({ priceLabel: "1K ¥0.05/张 · 2K ¥0.05/张 · 4K ¥0.05/张",
      metadata: { secureSkillCatalogPricing: { kind: "tiered", billingUnit: "image", tiers: [{ price: .05 }, { price: .05 }, { price: .05 }] } } });
    expect(calls).toHaveLength(3);
    expect(result.complete).toBe(true);
  });
  it("lists the three exact Secure Skill video declarations with prices while their generation protocol remains unconfirmed", () => {
    const channels = [{ name: "flow", platforms: [{ platform: "flow2", groups: [{ id: 14, name: "flow" }],
      supported_models: [{ name: "omni", pricing: { billing_mode: "per_request", per_request_price: .63 } },
        { name: "gemini-3-pro-image", pricing: { billing_mode: "image", per_request_price: .1 } }] }] },
    { name: "enterprise", platforms: [{ platform: "newtoken-sd", groups: [{ id: 16, name: "video-企业版" }],
      supported_models: [{ name: "video-2.0-fast", pricing: { billing_mode: "per_second", per_request_price: .55 } },
        { name: "video-2.0-pro", pricing: { billing_mode: "per_second", per_request_price: .65 } }] }] }];
    const groups = parseSupplierPricingChannels({ code: 0, data: channels }, "CNY", { supplierSiteUrl: "https://token.secure-skill.com", checkedAt: "2026-10-08T14:33:39.047Z" });
    for (const [groupId, id, kind, price] of [["14", "omni", "per-request", .63], ["16", "video-2.0-fast", "per-second", .55], ["16", "video-2.0-pro", "per-second", .65]]) {
      expect(groups.find(group => group.supplierGroupId === groupId)?.models.find(model => model.id === id)).toMatchObject({ capability: "video", outputKinds: ["video"], protocol: "unknown",
        metadata: { canvasRunnable: false, outputKindsSource: "declared", catalogGenerationDeclarationSource: "official-price-page",
          canvasUnavailableReason: "官网已列出视频型号 · 调用协议待确认", secureSkillCatalogPricing: { kind, unitAmount: price, currency: "CNY" } } });
    }
    expect(groups[0]?.models[1]).toMatchObject({ capability: "image", outputKinds: ["image"] });
    expect(groups[0]?.models[1]?.metadata?.catalogGenerationDeclarationSource).toBeUndefined();
  });
  it("preserves explicit understanding outputs and does not borrow Secure Skill declarations on another host or platform", () => {
    const payload = (platform: string, row: Record<string, unknown> = {}) => ({ code: 0, data: [{ platforms: [{ platform, groups: [{ id: 14, name: "flow" }], supported_models: [{ name: "omni", ...row }] }] }] });
    const official = { supplierSiteUrl: "https://token.secure-skill.com" };
    for (const row of [{ output_modalities: ["text"], input_modalities: ["image", "video"] }, { capability: "chat" }]) {
      const textModel = parseSupplierPricingChannels(payload("flow2", row), "CNY", official)[0]?.models[0];
      expect(textModel?.capability).toBe("chat");
      if ("output_modalities" in row) expect(textModel?.outputKinds).toEqual(["text"]);
      expect(textModel?.metadata?.catalogGenerationDeclarationSource).toBeUndefined();
    }
    for (const model of [parseSupplierPricingChannels(payload("flow2"), "CNY", { supplierSiteUrl: "https://other.example" })[0]?.models[0],
      parseSupplierPricingChannels(payload("unknown"), "CNY", official)[0]?.models[0]]) {
      expect(model?.capability).not.toBe("video");
      expect(model?.metadata?.catalogGenerationDeclarationSource).toBeUndefined();
    }
  });
  it.each(["plaza", "fallback"])("joins %s public pricing to only the same official account ID without losing public-only groups", async mode => {
    const groups = [{ id: 36, name: "MiniMax H3" }, { id: 54, name: "视频生成" },
      { id: 53, name: "视频生成" }, { id: 16, name: "video-企业版" }, { id: 999, name: "minimax-h3-优化版" }];
    const channels = groups.map(group => ({ name: `channel ${group.id}`, platforms: [{ groups: [group],
      supported_models: [{ name: group.id === 36 || group.id === 999 ? "minimax-h3" : "seedance-2.5",
        pricing: { billing_mode: "per_second", per_request_price: group.id === 53 ? .55 : group.id === 54 ? .62 : group.id === 36 ? .08 : 9 } }] }] }));
    const result = await discoverSupplierCatalog({ siteUrl: "https://token.secure-skill.com", apiUrl: "", kind: "sub2api" }, async url => {
      if (String(url).endsWith("/model-plaza")) return mode === "plaza"
        ? Response.json({ data: { groups: groups.map(group => ({ ...group, models: [] })) } })
        : Response.json({}, { status: 404 });
      if (String(url).endsWith("/pricing/channels")) return Response.json({ code: 0, data: channels });
      expect(String(url)).toBe("https://token.secure-skill.com/api/v1/groups/available");
      return Response.json({ data: [{ id: "036", name: "minimax-h3-优化版" },
        { id: 53, name: "sd特价分组1" }, { id: 54, name: "sd2.5特价分组-2" }] });
    });
    expect(result.status).toBe("live");
    expect(result.groups).toHaveLength(5);
    expect(result.groups.find(group => group.id === "minimax-h3-优化版")).toMatchObject({ supplierGroupId: "36", models: [{ id: "minimax-h3", priceLabel: "¥0.08/秒" }] });
    expect(result.groups.find(group => group.id === "sd特价分组1")).toMatchObject({ supplierGroupId: "53", models: [{ id: "seedance-2.5", priceLabel: "¥0.55/秒" }] });
    expect(result.groups.find(group => group.id === "sd2.5特价分组-2")).toMatchObject({ supplierGroupId: "54", models: [{ id: "seedance-2.5", priceLabel: "¥0.62/秒" }] });
    expect(result.groups.find(group => group.supplierGroupId === "16")).toMatchObject({ id: "public-group:16", label: "video-企业版 [公开分组ID 16]", models: [{ id: "seedance-2.5", priceLabel: "¥9/秒" }] });
    expect(result.groups.find(group => group.supplierGroupId === "999")).toMatchObject({ id: "public-group:999", models: [{ id: "minimax-h3", priceLabel: "¥9/秒" }] });
    expect(new Set(result.groups.map(group => group.id)).size).toBe(5);
  });
  it("reports cross-channel price conflicts for the same official group/model instead of taking the first channel", () => {
    const channels = [1, 2, 1].map((price, index) => ({ name: `channel ${index}`, platforms: [{ groups: [{ id: 53, name: "视频生成" }],
      supported_models: [{ name: "seedance-2.5", pricing: { billing_mode: "per_second", per_request_price: price } }] }] }));
    for (const data of [channels, [...channels].reverse()]) {
      const groups = parseSupplierPricingChannels({ code: 0, data }, "CNY");
      expect(groups).toHaveLength(1);
      expect(groups[0]?.models).toHaveLength(1);
      expect(groups[0]?.models[0]).toMatchObject({ priceLabel: "价格存在冲突，待确认", metadata: { supplierPriceConflict: true,
        supplierPriceAlternatives: expect.arrayContaining([{ label: "¥1/秒", channel: "channel 0" }, { label: "¥2/秒", channel: "channel 1" }]) } });
    }
    const repeated = parseSupplierPricingChannels({ code: 0, data: [channels[0], channels[0]] }, "CNY");
    expect(repeated[0]?.models[0]?.priceLabel).toBe("¥1/秒");
    expect(repeated[0]?.models[0]?.metadata?.supplierPriceConflict).toBeUndefined();
    const tokenChannels = [1e-5, 2e-5].map(output_price => ({ name: "official token", platforms: [{ groups: [{ id: 37, name: "seedance-官方token版" }],
      supported_models: [{ name: "doubao-seedance-2-0-fast-260128", pricing: { billing_mode: "token", output_price } }] }] }));
    const token = parseSupplierPricingChannels({ code: 0, data: tokenChannels }, "CNY", { supplierSiteUrl: "https://token.secure-skill.com", checkedAt: "2026-10-08T00:00:00Z" })[0]?.models[0];
    expect(token?.metadata?.supplierPriceConflict).toBe(true);
    expect(token?.priceLabel).toBe("价格存在冲突，待确认");
    expect(token?.metadata?.secureSkillCatalogPricing).toBeUndefined();
    expect(token?.metadata?.supplierPriceAlternatives).toEqual([
      { label: "720p · 不含参考视频 ¥10/1M tokens", channel: "official token" },
      { label: "720p · 不含参考视频 ¥20/1M tokens", channel: "official token" },
    ]);
  });
  it("preserves model plaza modalities, documented input limits and reasoning without changing group membership", () => {
    const result = parseSupplierCatalog({ data: { groups: [
      { name: "vision", models: [{ id: "image-understanding-pro", input_modalities: ["text", "image", "video"], output_modalities: ["text"],
        limits: { maxInputImages: 16 }, description: "最多上传2个视频", reasoning_efforts: ["high", "xhigh"], protocol: "responses" }] },
      { name: "text", models: [{ id: "image-understanding-pro", capabilities: { vision: false } }] },
    ] } });
    expect(result.groups[0]?.models[0]).toMatchObject({ id: "image-understanding-pro", capability: "chat", protocol: "responses",
      inputKinds: ["text", "image", "video"], outputKinds: ["text"], limits: { maxInputImages: 16, maxInputVideos: 2 },
      metadata: { modelFactsSource: "supplier-catalog", agentCapabilities: { imageInput: true, videoInput: true, audioInput: false },
        reasoningOptions: [{ value: "high" }, { value: "xhigh" }] } });
    expect(result.groups[1]?.models[0]?.limits).toBeUndefined();
    expect(result.groups[1]?.models[0]?.metadata?.agentCapabilities).toEqual({ imageInput: false });
  });

  it("retains overlapping New API group membership and empty published groups", () => {
    const result = parseSupplierCatalog({ group_ratio: { vip: 1, basic: 2, empty: 1 }, usable_group: { vip: "VIP", empty: "Empty" }, data: [{ model_name: "gpt-image-2", enable_groups: ["vip", "basic"], supported_endpoint_types: ["openai-images"], price_label: "0.1/张" }] });
    expect(result.kind).toBe("newapi");
    expect(result.groups.map((group) => [group.id, group.models.map((model) => model.id)])).toEqual([["vip", ["gpt-image-2"]], ["empty", []], ["basic", ["gpt-image-2"]]]);
    expect(result.groups[0]?.models[0]).toMatchObject({ capability: "image", protocol: "openai-images", priceLabel: "0.1/张" });
  });
  it("reads Sub2API model plaza groups and OpenAI empty-data alternative", () => {
    expect(parseSupplierCatalog({ data: { groups: [{ name: "Claude", models: [{ name: "claude-sonnet" }] }] } })).toMatchObject({ kind: "sub2api", groups: [{ id: "Claude", models: [{ id: "claude-sonnet", capability: "chat" }] }] });
    expect(parseSupplierCatalog({ data: [], models: [{ id: "unknown-model" }] }).groups[0]?.models[0]).toMatchObject({ id: "unknown-model", capability: "other", protocol: "unknown" });
    expect(parseSupplierCatalog({ data: [] }).recognized).toBe(true);
    expect(parseSupplierCatalog({ message: "sign in first" }).recognized).toBe(false);
  });
  it("normalizes API endpoints without duplicate v1 and rejects embedded credentials", () => {
    expect(supplierModelUrls("https://api.example.com/v1/")).toEqual(["https://api.example.com/v1/models"]);
    expect(supplierModelUrls("https://api.example.com/v1/models")).toContain("https://api.example.com/v1/models");
    expect(normalizeSupplierSiteBase("https://api.example.com/gateway/one/v1/")).toBe("https://api.example.com/gateway/one");
    for (const address of ["https://user:password@example.com", "https://example.com?token=secret", "file:///etc/passwd"]) expect(() => normalizeSupplierUrl(address)).toThrow();
  });
  it("retries gated pricing with a site token and numeric user ID only on the explicit site", async () => {
    const calls: Array<{ url: string; auth: string | null; user: string | null }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input); const headers = new Headers(init?.headers);
      calls.push({ url, auth: headers.get("authorization"), user: headers.get("New-Api-User") });
      if (!headers.get("authorization")) return Response.json({ error: "login" }, { status: 401 });
      return Response.json({ data: [{ model_name: "gpt-image-2", enable_groups: ["images"] }] });
    });
    const result = await discoverSupplierCatalog({ siteUrl: "https://site.example.com/gateway/v1", apiUrl: "https://api.example.com/v1", token: "test-token:42" }, fetcher);
    expect(result.status).toBe("live");
    expect(calls).toEqual([
      { url: "https://site.example.com/gateway/api/pricing", auth: null, user: null },
      { url: "https://site.example.com/gateway/api/pricing", auth: "Bearer test-token", user: "42" },
      { url: "https://site.example.com/gateway/api/user/self/groups", auth: "Bearer test-token", user: "42" },
    ]);
  });
  it("stops at a login-gated NewAPI site rather than inferring another platform", async () => {
    const fetcher = vi.fn(async () => Response.json({ error: "denied" }, { status: 401 }));
    const result = await discoverSupplierCatalog({ siteUrl: "https://docs.example.com", apiUrl: "https://api.example.com", token: "test-token" }, fetcher);
    expect(result.status).toBe("unauthorized");
    expect(result.groups).toHaveLength(0);
    expect(result.kind).toBe("newapi");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("recognizes disabled plazas in CDR probe order while retaining gateway paths", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input); calls.push(url);
      return url.endsWith("/setup/status") ? Response.json({ code: 0, data: { needs_setup: false } }) : Response.json({ error: "missing" }, { status: 404 });
    });
    const result = await discoverSupplierCatalog({ siteUrl: "https://example.com/gateway", apiUrl: "https://api.example.com/v1" }, fetcher);
    expect(result).toMatchObject({ kind: "sub2api", status: "failed", groups: [] });
    expect(calls).toEqual(["https://example.com/gateway/api/pricing", "https://example.com/gateway/api/v1/model-plaza", "https://example.com/gateway/api/status", "https://example.com/gateway/setup/status", "https://example.com/gateway/api/v1/groups/available", "https://example.com/gateway/api/v1/pricing/channels"]);
  });
  it("recognizes NewAPI status before querying a Sub2API fingerprint", async () => {
    const calls: string[] = [];
    const result = await discoverSupplierCatalog({ siteUrl: "https://example.com", apiUrl: "" }, async (input) => {
      calls.push(String(input));
      return String(input).endsWith("/api/status") ? Response.json({ data: { system_name: "My gateway" } }) : Response.json({}, { status: 404 });
    });
    expect(result.kind).toBe("newapi");
    expect(calls).toHaveLength(4);
  });
  it("does not send a website token to generic model endpoints", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const result = await discoverSupplierCatalog({ kind: "openai-compatible", siteUrl: "https://site.example.com", apiUrl: "https://api.example.com/gateway/v1", token: "login-token:42" }, async (input, init) => {
      calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
      return Response.json({ data: [{ id: "models/my-original-id" }] });
    });
    expect(calls).toEqual([{ url: "https://api.example.com/gateway/v1/models", auth: null }]);
    expect(result.groups[0]?.models[0]?.id).toBe("models/my-original-id");
  });
  it("preserves raw model IDs and expands enable_group/all into every detected group", () => {
    const parsed = parseSupplierCatalog({ usable_group: { first: "First", second: "Second" }, data: [
      { model_name: "models/raw/image", enable_groups: [], enable_group: ["all"] },
      { model_name: "MODEl:Case/1", enable_group: ["hidden"] },
    ] });
    expect(parsed.groups.map((group) => group.id)).toEqual(["first", "second", "hidden"]);
    for (const group of parsed.groups) expect(group.models.some((model) => model.id === "models/raw/image")).toBe(true);
    expect(parsed.groups[2]?.models.some((model) => model.id === "MODEl:Case/1")).toBe(true);
  });
});

it.each(["/dashboard", "/pricing/", "/api/v1/model-plaza", "/model-plaza", "/channel-plaza", "/v1", "/keys", "/console/token"])("preserves gateway prefixes while stripping the %s page suffix", async (suffix) => {
  const urls: string[] = [];
  const result = await discoverSupplierCatalog({ siteUrl: `https://example.com/gateway${suffix}`, apiUrl: "", kind: "newapi" }, async input => { urls.push(String(input)); return Response.json({ data: [] }); });
  expect(urls).toEqual(["https://example.com/gateway/api/pricing", "https://example.com/gateway/api/user/self/groups"]);
  expect(result.status).toBe("empty");
});

describe("API-key page group fallback", () => {
  // Shapes from the four authenticated 2026-10-08 reads: the account group
  // endpoint succeeded while both model/price endpoints returned 404.
  it.each([
    { siteUrl: "https://api.mikoto.vip", group: { id: 5, name: "生图（1k）", description: "1k 0.02\n量大同行稳定有量0.01", rate_multiplier: 1 } },
    { siteUrl: "https://asian-acc.we-token.cc", group: { id: 6, name: "生图-openai-codex-token计费", rate_multiplier: .7 } },
    { siteUrl: "https://api.hangzhale.com", group: { id: 74, name: "Grok Heavy", description: "生图5分一张", rate_multiplier: .2 } },
    { siteUrl: "https://synoralink.com", group: { id: 81, name: "CCMax（0注入）", description: "0注入，禁止蒸馏", rate_multiplier: 1.5 } },
  ])("keeps $siteUrl account groups without treating two 404 directories as complete prices", async ({ siteUrl, group }) => {
    const calls: string[] = [];
    const result = await discoverSupplierCatalog({ siteUrl, apiUrl: `${siteUrl}/v1`, kind: "sub2api" }, async url => {
      const request = new URL(String(url));
      expect(request.origin).toBe(siteUrl);
      calls.push(request.pathname);
      if (request.pathname === "/api/v1/groups/available") return Response.json({ code: 0, data: [group] });
      if (["/api/v1/model-plaza", "/api/v1/pricing/channels"].includes(request.pathname)) return Response.json({}, { status: 404 });
      throw new Error("Unexpected synthetic account/catalog endpoint");
    });
    expect(result).toMatchObject({ kind: "sub2api", status: "live", complete: false,
      groups: [{ id: group.name, supplierGroupId: String(group.id), models: [], details: { rateMultiplier: group.rate_multiplier } }] });
    expect(result.error).toContain("模型价格目录");
    expect(calls).toEqual(["/api/v1/model-plaza", "/api/v1/groups/available", "/api/v1/pricing/channels"]);
  });
  it.each(["unauthorized", "timeout", "invalid-body", "rejected-body"] as const)(
    "preserves successful Sub2API account groups when the separate price page is %s",
    async failure => {
      const result = await discoverSupplierCatalog({ siteUrl: "https://sub2api-price.example", apiUrl: "", kind: "sub2api" }, async url => {
        const endpoint = new URL(String(url)).pathname;
        if (endpoint === "/api/v1/model-plaza") return Response.json({}, { status: 404 });
        if (endpoint === "/api/v1/groups/available") return Response.json({ code: 0, data: [{ id: 4, name: "images", rate_multiplier: .8 }] });
        if (endpoint !== "/api/v1/pricing/channels") throw new Error("Unexpected synthetic catalog endpoint");
        if (failure === "unauthorized") return Response.json({}, { status: 401 });
        if (failure === "timeout") throw new DOMException("Synthetic price timeout", "TimeoutError");
        if (failure === "rejected-body") return Response.json({ code: 401, data: [] });
        return Response.json({ code: 0, data: { unavailable: true } });
      });
      expect(result).toMatchObject({ kind: "sub2api", status: "live", complete: false, groups: [{ id: "images", models: [] }] });
      expect(result.error).toContain("模型价格目录");
    },
  );
  it.each([[], { channels: [] }])("distinguishes a real empty Sub2API price-page envelope %j from an unreadable page", async data => {
    const result = await discoverSupplierCatalog({ siteUrl: "https://sub2api-empty.example", apiUrl: "", kind: "sub2api" }, async url => {
      const endpoint = new URL(String(url)).pathname;
      if (endpoint === "/api/v1/model-plaza") return Response.json({}, { status: 404 });
      if (endpoint === "/api/v1/groups/available") return Response.json({ code: 0, data: [{ id: 4, name: "images" }] });
      if (endpoint === "/api/v1/pricing/channels") return Response.json({ code: 0, data });
      throw new Error("Unexpected synthetic catalog endpoint");
    });
    expect(result).toMatchObject({ status: "live", complete: true, groups: [{ id: "images", models: [] }] });
    expect(result.error).toBeUndefined();
  });
  it.each(["newapi", "sub2api"] as const)("supplements %s model prices with group descriptions without cross-group leakage", async (kind) => {
    const result = await discoverSupplierCatalog({ kind, siteUrl: "https://fixture.example", apiUrl: "" }, async url => {
      if (String(url).endsWith("/pricing")) return Response.json({ success: true, data: [{ model_name: "gpt-image-2", enable_groups: ["images"], price_label: "$0.2/张" }] });
      if (String(url).endsWith("/model-plaza")) return Response.json({ data: { groups: [{ name: "images", description: "旧说明支持4K", models: [{ id: "gpt-image-2", price_label: "$0.2/张" }] }] } });
      return Response.json({ data: kind === "sub2api" ? [{name:"images", description:"仅支持1K2K，不支持4K", image_price_4k: 0.2}] : { images: { desc: "仅支持1K2K，不支持4K", ratio: 1 } } });
    });
    expect(result.groups[0]).toMatchObject({ id:"images", models:[{id:"gpt-image-2",priceLabel:"$0.2/张"}], details:{ source:"key-groups", supportedResolutions:["1K","2K"], unsupportedResolutions:["4K"], exclusiveResolutions:true } });
  });
  it.each(["empty", "disabled", "gated"])("reads Sub2API group options when model plaza is %s", async (mode) => {
    const calls: string[] = [];
    const result = await discoverSupplierCatalog({ siteUrl: "https://site.example.com/gateway/keys", apiUrl: "https://api.example.com/v1", kind: "sub2api", token: "temporary-login-token" }, async (url, init) => {
      calls.push(String(url));
      if (String(url).endsWith("/model-plaza")) {
        return mode === "empty" ? Response.json({ code: 0, data: { groups: [] } })
          : Response.json({ message: "unavailable" }, { status: mode === "gated" ? 401 : 404 });
      }
      expect(String(url)).toBe("https://site.example.com/gateway/api/v1/groups/available");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer temporary-login-token");
      return Response.json({ code: 0, data: [
        { id: 12, name: "codex 稳定", description: "说明", rate_multiplier: 2 },
        { id: 15, name: "香蕉2 1k2k", platform: "gemini" },
        { id: 15, name: "香蕉2 1k2k" },
      ] });
    });
    expect(result).toMatchObject({ status: "live", kind: "sub2api", groups: [
      { id: "codex 稳定", label: "codex 稳定", models: [] },
      { id: "香蕉2 1k2k", label: "香蕉2 1k2k", models: [] },
    ] });
    expect(calls.every((url) => url.startsWith("https://site.example.com/gateway/"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("temporary-login-token");
  });

  it("uses NewAPI user groups and user-id authentication when public pricing has no groups", async () => {
    const result = await discoverSupplierCatalog({ kind: "newapi", siteUrl: "https://site.example.com/console/token", apiUrl: "https://elsewhere.example.com", token: "site-token:42" }, async (url, init) => {
      if (String(url).endsWith("/api/pricing")) return Response.json({ success: true, data: [] });
      expect(String(url)).toBe("https://site.example.com/api/user/self/groups");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer site-token");
      expect(new Headers(init?.headers).get("New-Api-User")).toBe("42");
      return Response.json({ success: true, data: { default: { ratio: 1, desc: "默认分组" }, vip: { ratio: 0.8, desc: "VIP" } } });
    });
    expect(result).toMatchObject({ status: "live", groups: [{ id: "default", label: "默认分组", models: [] }, { id: "vip", models: [] }] });
  });

  it("merges account groups even when model plaza already returned models", async () => {
    const fetcher = vi.fn(async (url) => String(url).endsWith("/model-plaza")
      ? Response.json({ data: { groups: [{ name: "image", models: ["gpt-image-2"] }, { name: "catalog-only", models: [] }] } })
      : Response.json({ data: [{ name: "image" }, ...Array.from({length: 8}, (_, i) => ({name: `account-${i}`}))] }));
    const result = await discoverSupplierCatalog({ siteUrl: "https://site.example.com", apiUrl: "", kind: "sub2api" }, fetcher);
    expect(result.groups).toHaveLength(10);
    expect(result.groups[0]?.models).toHaveLength(1);
    expect(result.groups.slice(1).every(group => group.models.length === 0)).toBe(true);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "https://site.example.com/api/v1/model-plaza",
      "https://site.example.com/api/v1/pricing/channels",
      "https://site.example.com/api/v1/groups/available",
    ]);
  });

  it.each([401, 503])("marks a model-only result partial when account groups fail with %s", async (status) => {
    const result = await discoverSupplierCatalog({ siteUrl: "https://site.example.com", apiUrl: "", kind: "sub2api" }, async (url) =>
      String(url).endsWith("/model-plaza")
        ? Response.json({ data: { groups: [{ name: "image", models: ["gpt-image-2"] }] } })
        : Response.json({}, { status }));
    expect(result).toMatchObject({status: "live", complete: false, groups: [{id: "image"}]});
    expect(result.error).toContain("保留历史分组");
  });

  it("asks for a site login token when the key-page group list is gated", async () => {
    const result = await discoverSupplierCatalog({ siteUrl: "https://site.example.com", apiUrl: "", kind: "sub2api" }, async (url) =>
      String(url).endsWith("/model-plaza") ? Response.json({ data: { groups: [] } }) : Response.json({}, { status: 401 }));
    expect(result.status).toBe("unauthorized");
    expect(result.error).toContain("API 密钥");
    expect(result.error).toContain("站点账号密码");
  });

  it("does not mistake error envelopes or key-list objects for groups", () => {
    expect(parseSupplierKeyGroups({ code: 401, data: [{ name: "wrong" }] }, "sub2api")).toBeNull();
    expect(parseSupplierKeyGroups({ success: false, data: { wrong: { ratio: 1 } } }, "newapi")).toBeNull();
    expect(parseSupplierKeyGroups({ data: { keys: [{ key: "secret", name: "my key" }] } }, "sub2api")).toBeNull();
    expect(parseSupplierKeyGroups({ data: { message: "login needed" } }, "newapi")).toBeNull();
    expect(parseSupplierKeyGroups({ data: [] }, "sub2api")).toEqual([]);
  });
});
