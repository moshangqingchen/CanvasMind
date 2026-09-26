import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@super-canvas/providers", async importOriginal => ({ ...await importOriginal<object>(), providerFetch: mocks.fetch }));
import { localReferenceChannel, localReferenceChannelConfigured, localReferenceUrls } from "../src/reference-channel.js";
let root: string; let path: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "supercanvas-channel-test-")); path = join(root, "state.json");
  vi.stubEnv("SUPERCANVAS_DESKTOP", "true"); vi.stubEnv("SUPERCANVAS_REFERENCE_CHANNEL_FILE", path); vi.stubEnv("MASTER_KEY", "isolated-test-key");
  mocks.fetch.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
const save = (extra = {}) => writeFileSync(path, JSON.stringify({ enabled: true, ready: true, baseUrl: "https://assets.example.com", updatedAt: Date.now(), instance: "desktop-instance", ...extra }));
describe("local reference channel", () => {
  it("keeps an offline configured channel distinct from opting out", async () => {
    save({ ready: false });
    expect(localReferenceChannelConfigured()).toBe(true);
    await expect(localReferenceUrls(["reference-1"])).rejects.toThrow("当前生成尚未提交");
    expect(mocks.fetch).not.toHaveBeenCalled();
    save({ enabled: false }); expect(localReferenceChannelConfigured()).toBe(false);
  });
  it("rejects disabled, stale, non-HTTPS or unready channels", () => {
    for (const extra of [{ enabled: false }, { ready: false }, { updatedAt: Date.now() - 100_000 }, { baseUrl: "http://assets.example.com" }]) { save(extra); expect(localReferenceChannel()).toBeNull(); }
  });
  it("probes the current desktop instance before returning one-hour signed asset URLs", async () => {
    save(); mocks.fetch.mockResolvedValue(new Response("desktop-instance"));
    const urls = await localReferenceUrls(["reference-1", "reference-2"]);
    expect(urls).toHaveLength(2); expect(urls[0]).toContain("https://assets.example.com/api/provider-assets/reference-1?token=");
    expect(new URL(mocks.fetch.mock.calls[0]![0]).pathname).toBe("/api/provider-assets/_health");
    expect(mocks.fetch.mock.calls[0]![1].redirect).toBe("error");
  });
  it("fails closed if the tunnel points at an old or unavailable instance", async () => {
    save(); mocks.fetch.mockResolvedValue(new Response("old-instance"));
    await expect(localReferenceUrls(["reference-1"])).rejects.toThrow("当前生成尚未提交");
  });
});
