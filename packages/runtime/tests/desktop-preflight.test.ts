import { afterEach, describe, expect, it, vi } from "vitest";
import { assertDesktopPublicAssets } from "../src/desktop-preflight.js";
import type { WorkflowGraph } from "@super-canvas/core";

afterEach(() => vi.unstubAllEnvs());
const graph = { schemaVersion: 1, nodes: [
  { id: "source", type: "asset-input", position: { x: 0, y: 0 }, data: { type: "asset-input", assetId: "image" } },
  { id: "video", type: "video-generation", position: { x: 1, y: 0 }, data: { type: "video-generation", provider: "rest", __runtimeConnection: { provider: "rest", config: { connector: { assetsRequirePublicUrls: true } } } } },
], edges: [{ id: "e", source: "source", target: "video", sourceHandle: "image", targetHandle: "firstFrame" }], viewport: { x: 0, y: 0, zoom: 1 } } as unknown as WorkflowGraph;
describe("desktop public asset preflight", () => {
  it("requires public reference links only for Chuangxiang Banana, while native Banana edits accept local bytes", () => {
    vi.stubEnv("SUPERCANVAS_DESKTOP", "true");
    for (const baseUrl of ["https://genimage.pro/v1", "https://api.frimodel.com/v1", "https://token.secure-skill.com/v1", "https://vapi.chuangxiangai.asia"]) {
      const banana = structuredClone(graph);
      banana.nodes[1]!.type = "image-generation";
      banana.nodes[1]!.data = { nodeType: "image-generation", provider: "openai", model: "gemini-3-pro-image-preview", __runtimeConnection: { provider: "openai", config: { baseUrl, modelGroup: "生图" } } };
      if (baseUrl.includes("chuangxiang")) expect(() => assertDesktopPublicAssets(banana, new Set(["video"]))).toThrow(/未提交付费/);
      else expect(() => assertDesktopPublicAssets(banana, new Set(["video"]))).not.toThrow();
    }
  });
  it("requires a reference channel for Secure Skill GPT image edits before starting upstream nodes", () => {
    vi.stubEnv("SUPERCANVAS_DESKTOP", "true");
    const secure = structuredClone(graph);
    secure.nodes[1]!.type = "image-generation";
    secure.nodes[1]!.data = { nodeType: "image-generation", provider: "openai", model: "gpt-image-2.5-flare",
      __runtimeConnection: { provider: "openai", config: { baseUrl: "https://token.secure-skill.com/v1" } } };
    expect(() => assertDesktopPublicAssets(secure, new Set(["video"]))).toThrow(/未提交付费/);
    expect(() => assertDesktopPublicAssets({ ...secure, edges: [] }, new Set(["video"]))).not.toThrow();
    (secure.nodes[1]!.data as any).__runtimeConnection.config.referenceImageHosting = "litterbox-24h";
    expect(() => assertDesktopPublicAssets(secure, new Set(["video"]))).not.toThrow();
  });
  it("blocks before paid execution only for selected public-asset workflows", () => {
    vi.stubEnv("SUPERCANVAS_DESKTOP", "true");
    expect(() => assertDesktopPublicAssets(graph, new Set(["video"]))).toThrow(/未提交付费/);
    expect(() => assertDesktopPublicAssets(graph, new Set(["source"]))).not.toThrow();
    expect(() => assertDesktopPublicAssets({ ...graph, edges: [] }, new Set(["video"]))).not.toThrow();
  });
  it("does not change hosted web behavior", () => {
    vi.stubEnv("SUPERCANVAS_DESKTOP", "false");
    expect(() => assertDesktopPublicAssets(graph, new Set(["video"]))).not.toThrow();
  });
  it("allows public URL connections only after explicit hosting opt-in", () => {
    vi.stubEnv("SUPERCANVAS_DESKTOP", "true");
    const optedIn = structuredClone(graph);
    (optedIn.nodes[1]!.data as any).__runtimeConnection.config.referenceImageHosting = "litterbox-24h";
    expect(() => assertDesktopPublicAssets(optedIn, new Set(["video"]))).not.toThrow();
  });
  it("allows local multipart image edits despite a legacy group-wide public URL flag", () => {
    vi.stubEnv("SUPERCANVAS_DESKTOP", "true");
    const mixed = structuredClone(graph);
    mixed.nodes[1]!.type = "image-generation";
    mixed.nodes[1]!.data = { nodeType: "image-generation", provider: "rest", model: "gpt-image-2", __runtimeConnection: {
      provider: "rest", config: { connector: { assetsRequirePublicUrls: true,
        submit: { path: "/v1/images/generations/async", bodyMode: "json" },
        operationOverrides: { "image.edit": { submit: { path: "/v1/images/edits/async", bodyMode: "multipart", mappings: [{ target: "/image", source: { kind: "assets", assetKind: "image" } }] } } },
      } },
    } };
    expect(() => assertDesktopPublicAssets(mixed, new Set(["video"]))).not.toThrow();
  });
  it("does not apply stale REST connector flags to a direct OpenAI connection", () => {
    vi.stubEnv("SUPERCANVAS_DESKTOP", "true");
    const direct = structuredClone(graph);
    Object.assign(direct.nodes[1]!.data, { provider: "openai", __runtimeConnection: { provider: "openai", config: { connector: { assetsRequirePublicUrls: true } } } });
    expect(() => assertDesktopPublicAssets(direct, new Set(["video"]))).not.toThrow();
  });
});
