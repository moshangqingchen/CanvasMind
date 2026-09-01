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
});
