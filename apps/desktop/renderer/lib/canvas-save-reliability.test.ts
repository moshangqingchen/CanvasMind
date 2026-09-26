import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { CanvasNodeData } from "../components/types";
import { CanvasSaveConflictError } from "./client-api";

let canvasModule: Pick<
  typeof import("../components/canvas-app"),
  | "canvasViewportsEqual"
  | "modelDiscoveryMigrationPatch"
  | "persistCanvasSaveRequest"
>;

const request = {
  canvasId: "canvas-1",
  title: "Latest canvas",
  graph: {
    schemaVersion: 1 as const,
    nodes: [],
    edges: [],
    drawings: [],
    viewport: { x: 12, y: 34, zoom: 0.9 },
  },
  keepalive: true,
  expectedRevision: 7,
};

describe("pagehide canvas persistence", () => {
  beforeAll(async () => {
    // The application uses Next's automatic JSX runtime. Vitest evaluates the
    // imported client component with the classic runtime in this node-only test.
    vi.stubGlobal("React", React);
    canvasModule = await import("../components/canvas-app");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a keepalive PUT for a pending pagehide snapshot", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "canvas-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await canvasModule.persistCanvasSaveRequest(request);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/canvas/canvas-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        graph: request.graph,
        title: request.title,
        expectedRevision: request.expectedRevision,
      }),
      keepalive: true,
    });
  });

  it("turns a stale keepalive save into a typed revision conflict", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: "画布已在其他位置更新，请先处理版本冲突",
            code: "CANVAS_REVISION_CONFLICT",
            currentRevision: 9,
          },
          { status: 409 },
        ),
      ),
    );

    const error = await canvasModule.persistCanvasSaveRequest(request).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(CanvasSaveConflictError);
    expect(error).toMatchObject({
      code: "CANVAS_REVISION_CONFLICT",
      currentRevision: 9,
    });
  });

  it("rejects instead of reporting success when the keepalive save fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "disk full" }, { status: 507 })),
    );

    await expect(canvasModule.persistCanvasSaveRequest(request)).rejects.toThrow(
      "disk full",
    );
  });

  it("treats React Flow's programmatic initial viewport as unchanged", () => {
    const persisted = { x: 8, y: 35, zoom: 0.72 };

    expect(canvasModule.canvasViewportsEqual(persisted, { ...persisted })).toBe(
      true,
    );
    expect(
      canvasModule.canvasViewportsEqual(persisted, {
        ...persisted,
        x: persisted.x + 0.01,
      }),
    ).toBe(false);
  });

  it("keeps connected reference ports when refreshed model metadata stops supporting them", () => {
    const data: CanvasNodeData = { nodeType: "video-generation", label: "Video", provider: "rest", model: "text-only", inputs: [{ id: "prompt", kind: "text", label: "Prompt" }, { id: "referenceVideos", kind: "video[]", label: "Video", multiple: true }] };
    const patch = canvasModule.modelDiscoveryMigrationPatch("video-generation", data, "rest", { id: "text-only", name: "Text only", operations: ["video.generate"], limits: { maxInputImages: 1, maxInputVideos: 0 } }, new Set(["referenceVideos"]));
    expect(patch?.inputs?.map((input) => input.id)).toContain("referenceVideos");
    expect(data.inputs).toHaveLength(2);
  });

  it("does not rewrite an explicit model's parameters during catalog refresh", () => {
    const model: ModelDescriptor = {
      id: "seedance-2.0",
      name: "Seedance 2.0",
      operations: ["video.generate"],
      parameters: [
        {
          key: "duration",
          label: "时长（秒）",
          control: "select",
          default: 5,
          options: [
            { label: "5", value: 5 },
            { label: "10", value: 10 },
          ],
        },
      ],
    };
    const parameters = {
      duration: 15,
      aspect_ratio: "16:9",
      generate_audio: true,
    };
    const data: CanvasNodeData = {
      label: "视频生成",
      nodeType: "video-generation",
      provider: "rest",
      model: model.id,
      parameters,
    };

    expect(
      canvasModule.modelDiscoveryMigrationPatch(
        "video-generation",
        data,
        "rest",
        model,
      ),
    ).toBeNull();
    expect(data.parameters).toBe(parameters);
    expect(data.parameters).toEqual({
      duration: 15,
      aspect_ratio: "16:9",
      generate_audio: true,
    });
  });

  it.each(["quality", "image_quality", "output_quality"])("refreshes a cached default to max for %s while preserving manual choices", key => {
    const model: ModelDescriptor = { id: "gpt-image-2.5-sunburst", name: "Sunburst", operations: ["image.generate"],
      parameters: [{ key, label: "质量", control: "select", default: "high", options: ["low", "high", "max"].map(value => ({ value, label: value })) }] };
    const data: CanvasNodeData = { label: "Image", nodeType: "image-generation", provider: "openai", model: model.id,
      qualityMode: "highest", parameters: { [key]: "high", size: "3840x2160", size_tier: "4K" } };
    const patch = canvasModule.modelDiscoveryMigrationPatch("image-generation", data, "openai", model);
    expect(patch?.parameters).toEqual({ [key]: "max", size: "3840x2160", size_tier: "4K" });
    expect(canvasModule.modelDiscoveryMigrationPatch("image-generation", { ...data, ...patch }, "openai", model)?.parameters).toBeUndefined();
    for (const qualityMode of ["custom", undefined] as const)
      expect(canvasModule.modelDiscoveryMigrationPatch("image-generation", { ...data, qualityMode }, "openai", model)?.parameters).toBeUndefined();
    expect(canvasModule.modelDiscoveryMigrationPatch("image-generation", { ...data, model: "" }, "openai", model)?.parameters?.[key]).toBe("max");
  });

  it("migrates only repaired Banana controls without losing the saved tier or reference port", () => {
    const model: ModelDescriptor = { id: "gemini-3-pro-image-preview", name: "Banana", operations: ["image.generate", "image.edit"],
      metadata: { bananaProtocolVersion: 1 }, parameters: [
        { key: "aspect_ratio", label: "比例", control: "select", default: "auto", options: [{ value: "auto", label: "自动" }] },
        { key: "image_size", label: "分辨率", control: "select", default: "4K", options: ["1K", "2K", "4K"].map(value => ({ value, label: value })) },
      ] };
    const data: CanvasNodeData = { nodeType: "image-generation", label: "Banana", provider: "openai", model: model.id,
      parameters: { size: "auto", size_tier: "2K", quality: "max" }, inputs: [{ id: "references", kind: "image[]", label: "参考图", multiple: true }] };
    const patch = canvasModule.modelDiscoveryMigrationPatch("image-generation", data, "openai", model, new Set(["references"]));
    expect(patch?.parameters).toEqual({ aspect_ratio: "auto", image_size: "2K" });
    expect(patch?.inputs?.some(input => input.id === "references")).toBe(true);
    expect(canvasModule.modelDiscoveryMigrationPatch("image-generation", { ...data, ...patch }, "openai", model, new Set(["references"]))).toBeNull();
  });
});
