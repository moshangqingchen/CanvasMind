import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnectionView } from "./client-api";
import {
  cleanSupplierAddress,
  findSupplierGroupConnection,
  manualModelCapabilities,
  manualModelProtocols,
  manualModelsForConnection,
  readSupplierModels,
  supplierOwnsConnection,
} from "./client-suppliers";

const connection = (
  config: Record<string, unknown> = {},
): ProviderConnectionView => ({
  id: "connection-a",
  name: "Test",
  provider: "openai",
  apiKeySet: true,
  apiKey: "",
  config: {
    supplierKey: "custom-gateway",
    baseUrl: "https://one.example.com/v1",
    modelGroup: "vip",
    usage: "canvas",
    ...config,
  },
});

afterEach(() => vi.unstubAllGlobals());

describe("supplier settings boundaries", () => {
  it("hydrates stale saved models with their original success time without requesting refresh", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([{ id: "old" }], { headers: {
      "X-Model-Scan-Status": "stale", "X-Model-Scan-Source": "saved",
      "X-Model-Scan-Checked-At": "2026-09-22T00:00:00Z", "X-Model-Scan-Last-Success-At": "2026-09-20T00:00:00Z",
    } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await readSupplierModels("cached", false, { cachedOnly: true })).toMatchObject({
      models: [{ id: "old" }], status: "stale", source: "saved", lastSuccessAt: "2026-09-20T00:00:00Z",
    });
    const url = String(fetcher.mock.calls[0]![0]);
    expect(url).toContain("cached=1");
    expect(url).not.toContain("refresh=1");
  });
  it("keeps explicit parents and legacy custom origins isolated", () => {
    const supplier = {
      id: "supplier-a",
      supplierKey: "custom-gateway",
      apiUrl: "https://one.example.com",
    };
    expect(supplierOwnsConnection(supplier, connection())).toBe(true);
    expect(
      supplierOwnsConnection(
        supplier,
        connection({ baseUrl: "https://two.example.com/v1" }),
      ),
    ).toBe(false);
    expect(
      supplierOwnsConnection(
        { ...supplier, apiUrl: "https://one.example.com/gateway-a" },
        connection({ baseUrl: "https://one.example.com/gateway-b/v1" }),
      ),
    ).toBe(false);
    expect(
      supplierOwnsConnection(
        { ...supplier, apiUrl: "https://one.example.com/gateway-a" },
        connection({ baseUrl: "https://one.example.com/gateway-a/v1" }),
      ),
    ).toBe(true);
    expect(
      supplierOwnsConnection(
        supplier,
        connection({ supplierId: "supplier-b" }),
      ),
    ).toBe(false);
    expect(
      supplierOwnsConnection(
        supplier,
        connection({ supplierId: "supplier-a" }),
      ),
    ).toBe(true);
  });

  it("never reuses a canvas group connection as an agent connection", () => {
    const canvas = connection();
    const agent = { ...connection({ usage: "agent" }), id: "agent-a" };
    expect(
      findSupplierGroupConnection([canvas], "vip", "agent"),
    ).toBeUndefined();
    expect(
      findSupplierGroupConnection([canvas, agent], "vip", "agent")?.id,
    ).toBe("agent-a");
    expect(
      findSupplierGroupConnection([canvas, agent], "vip", "canvas")?.id,
    ).toBe("connection-a");
  });

  it.each(["rest", "openai"] as const)(
    "isolates legacy %s gateways on the same host and preserves API prefixes",
    (provider) => {
      const supplier = {
        id: "gateway-a",
        supplierKey: provider,
        apiUrl: "https://one.example.com/gateway-a/v1",
      };
      const group = {
        ...connection({
          supplierKey: provider,
          baseUrl: "https://one.example.com/gateway-a/v1/",
        }),
        provider,
      };
      expect(supplierOwnsConnection(supplier, group)).toBe(true);
      expect(
        supplierOwnsConnection(supplier, {
          ...group,
          config: {
            ...group.config,
            baseUrl: "https://one.example.com/gateway-b/v1",
          },
        }),
      ).toBe(false);
      expect(
        supplierOwnsConnection(supplier, {
          ...group,
          config: {
            ...group.config,
            baseUrl: "https://two.example.com/gateway-a/v1",
          },
        }),
      ).toBe(false);
      expect(
        supplierOwnsConnection(supplier, {
          ...group,
          config: { ...group.config, baseUrl: "https://api.openai.com/v1" },
        }),
      ).toBe(false);
    },
  );

  it("offers model-specific protocols without dividing API Keys by legacy purpose", () => {
    const chatProtocols = ["chat-completions", "responses", "anthropic-messages", "google-generate-content", "xai-responses", "generic-openai-compatible"];
    expect(manualModelProtocols("openai", "canvas")).toEqual(["openai-images", ...chatProtocols]);
    expect(manualModelProtocols("rest", "canvas")).toEqual(chatProtocols);
    const restConfig = {
      connector: {
        models: [
          {
            id: "configured-video",
            name: "Video",
            operations: ["video.generate"],
          },
        ],
      },
    };
    expect(manualModelProtocols("rest", "canvas", restConfig)).toEqual([
      "rest", ...chatProtocols,
    ]);
    expect(manualModelCapabilities("rest", "canvas", restConfig)).toEqual([
      "video", "chat",
    ]);
    expect(
      manualModelProtocols("rest", "agent", { protocol: "responses" }),
    ).toEqual(chatProtocols);
    expect(
      manualModelProtocols("weai", "canvas", { protocol: "gemini" }, "image"),
    ).toEqual(["gemini"]);
    expect(manualModelProtocols("weai", "canvas", {}, "image")).toEqual([
      "openai-images",
    ]);
    expect(manualModelProtocols("openai", "disabled")).toEqual([]);
    expect(manualModelProtocols("rest", "canvas", restConfig, "chat")).toEqual(chatProtocols);
    expect(manualModelProtocols("rest", "agent", restConfig, "video")).toEqual(["rest"]);
    expect(manualModelProtocols("openai", "agent", {}, "image")).toEqual(["openai-images"]);
    expect(manualModelProtocols("openai", "canvas", {}, "video")).toEqual([]);
    expect(manualModelCapabilities("cli", "agent")).toEqual([]);
    expect(manualModelProtocols("cli", "agent")).toEqual([]);
  });

  it("preserves exact manual model aliases", () => {
    expect(
      manualModelsForConnection(
        connection({
          manualModels: [
            {
              id: "models/My-Custom-Image",
              capability: "image",
              protocol: "openai-images",
            },
          ],
        }),
      )[0]?.id,
    ).toBe("models/My-Custom-Image");
  });

  it("normalizes address entry without keeping credentials", () => {
    expect(cleanSupplierAddress(" one.example.com/gateway/v1/ ")).toBe(
      "https://one.example.com/gateway/v1",
    );
    expect(() =>
      cleanSupplierAddress("https://user:password@example.com"),
    ).toThrow();
    expect(
      cleanSupplierAddress("https://one.example.com?token=discard#fragment"),
    ).toBe("https://one.example.com");
  });
});

describe("supplier model reads", () => {
  it("reports a successful empty key result accurately", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("[]", { headers: { "X-Model-Scan-Status": "empty" } }),
      ),
    );
    expect(await readSupplierModels("connection-a", true)).toEqual({
      models: [],
      status: "empty",
    });
  });

  it("does not report a cached snapshot as a successful refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify([{ id: "cached-model" }]), {
            headers: { "X-Model-Scan-Status": "stale" },
          }),
      ),
    );
    await expect(readSupplierModels("connection-a", true)).rejects.toThrow(
      "本次扫描未完成",
    );
  });

  it("reports authorization and invalid response failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Key 无权限" }), {
            status: 403,
            headers: { "X-Model-Scan-Status": "unauthorized" },
          }),
      ),
    );
    await expect(readSupplierModels("connection-a", true)).rejects.toThrow(
      "Key 无权限",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [] }))),
    );
    await expect(readSupplierModels("connection-a", true)).rejects.toThrow(
      "模型列表格式无效",
    );
  });
});
