import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { StaticConnectionResolver } from "./credentials.js";
import { GenericRestAdapter } from "./rest.js";
import type { NormalizedRequest } from "./contracts.js";

const raw = JSON.parse(readFileSync(new URL("../../../apps/desktop/renderer/lib/fixtures/mikoto-g5-whole-connection.json", import.meta.url), "utf8"));
const connection = { id: raw.connection.id, provider: "rest", apiKey: "isolated-test-key", baseUrl: raw.connection.config.baseUrl,
  settings: raw.connection.config };
const request = { connectionId: connection.id, operation: "image.generate" as const, prompt: "isolated fixture", idempotencyKey: "mikoto-g5-rest" };
const ids = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
const mediumRaw = JSON.parse(readFileSync(new URL("../../../apps/desktop/renderer/lib/fixtures/mikoto-rest-whole-connection.json", import.meta.url), "utf8"));

describe("actual Mikoto g5 saved async REST request fields", () => {
  it.each(ids)("sends %s generation and edit exact size/quality without app preferences", async model => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ task_id: "isolated-task", status: "queued" }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([connection]), { fetch: fetcher });
    for (const operation of ["image.generate", "image.edit"] as const) {
      const chosen: NormalizedRequest = { ...request, model, operation,
        parameters: Object.freeze({ size: "2051x2049", size_tier: "1K", quality: "max", aspect_ratio: "1:1" }),
        ...(operation === "image.edit" ? { assets: [{ id: "fixture", kind: "image" as const, mimeType: "image/png", data: new Uint8Array([137, 80, 78, 71]), url: "https://fixture.invalid/input.png" }] } : {}) };
      expect((await adapter.validate(chosen)).valid).toBe(true);
      await adapter.submit(chosen);
      const call = fetcher.mock.calls.at(-1)!;
      expect(String(call[0])).toBe(`https://api.mikoto.vip/v1/images/${operation === "image.edit" ? "edits" : "generations"}/async`);
      const rawBody = call[1]?.body;
      const body = rawBody instanceof FormData ? Object.fromEntries(rawBody.entries()) : JSON.parse(String(rawBody));
      expect(body).toMatchObject({ model, size: "2051x2049", quality: "max" });
      for (const key of ["size_tier", "aspect_ratio", "aspectRatio", "ratio"]) expect(body).not.toHaveProperty(key);
      expect(chosen.parameters).toEqual({ size: "2051x2049", size_tier: "1K", quality: "max", aspect_ratio: "1:1" });
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(ids)("blocks %s inconsistent W/H or illegal saved quality without rewriting choices", async model => {
    const fetcher = vi.fn<typeof fetch>(); const adapter = new GenericRestAdapter(new StaticConnectionResolver([connection]), { fetch: fetcher });
    const parameters = Object.freeze({ size: "2051x2049", size_tier: "1K", quality: "high", aspect_ratio: "16:9" });
    const chosen = { ...request, model, parameters };
    expect((await adapter.validate(chosen)).issues).toContainEqual(expect.objectContaining({ code: "aspect_ratio_size_conflict" }));
    await expect(adapter.submit(chosen)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
    expect(chosen.parameters).toEqual(parameters);
    expect((await adapter.validate({ ...chosen, parameters: { ...parameters, aspect_ratio: "auto", quality: "unrecognized" } })).issues)
      .toContainEqual(expect.objectContaining({ code: "invalid_quality" }));
  });
  it("preserves explicit manual contract fields", async () => {
    for (const [model, settings] of [
      [ids[0], { ...connection.settings, customGroup: true }],
      [ids[1], { ...connection.settings, autoModelInterfaces: { [ids[1]!]: { source: "manual" } } }],
    ] as const) {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ task_id: "isolated-task", status: "queued" }));
      const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ ...connection, settings }]), { fetch: fetcher });
      await adapter.submit({ ...request, model, parameters: { size: "1024x1024", quality: "high", aspect_ratio: "16:9" } });
      expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ model, size: "1024x1024", quality: "high", aspect_ratio: "16:9" });
    }
  });
  it.each([
    { group: "16", size: "1024x1024", quality: "medium", code: "invalid_group_image_size", raw: mediumRaw },
    { group: "16", size: "1440x1440", quality: "high", code: "invalid_quality", raw: mediumRaw },
  ])("validates the existing GPT2 group$group $size/$quality restriction on saved REST", async test => {
    const c = test.raw.connection;
    const fetcher = vi.fn<typeof fetch>();
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: c.id, provider: "rest", apiKey: "isolated-key",
      baseUrl: c.config.baseUrl, settings: c.config }]), { fetch: fetcher });
    const chosen = { ...request, connectionId: c.id, model: "gpt-image-2", parameters: Object.freeze({ size: test.size, quality: test.quality }) };
    expect((await adapter.validate(chosen)).issues).toContainEqual(expect.objectContaining({ code: test.code }));
    await expect(adapter.submit(chosen)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
    expect(chosen.parameters).toEqual({ size: test.size, quality: test.quality });
  });
});
