import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CanvasSaveConflictError,
  canvasErrorMessage,
  fetchCanvas,
  saveCanvas,
} from "./client-api";

const graph = {
  schemaVersion: 1 as const,
  nodes: [],
  edges: [],
  drawings: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchCanvas", () => {
  it("times out and retries when a successful response body never completes", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        ({
          ok: true,
          status: 200,
          // Deliberately ignore the request signal. The client must still
          // bound response-body consumption with its own deadline.
          text: () => new Promise<string>(() => undefined),
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchCanvas();
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(40_000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("times out and retries when the request never returns headers", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>(() => undefined),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchCanvas();
    const assertion = expect(pending).rejects.toThrow("画布请求超时");
    await vi.advanceTimersByTimeAsync(40_000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects an invalid successful response instead of hanging", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200 })),
    );

    await expect(fetchCanvas()).rejects.toThrow("画布响应无效，请重新加载页面");
  });
});

describe("saveCanvas", () => {
  it("preserves graph validation details returned by the canvas API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: "画布图包含无效连接",
            issues: [
              {
                code: "unknown_target_port",
                message:
                  "Edge edge-reference references unknown target port references",
              },
            ],
          },
          { status: 422 },
        ),
      ),
    );

    await expect(saveCanvas("canvas-1", graph)).rejects.toThrow(
      "画布图包含无效连接：Edge edge-reference references unknown target port references",
    );
  });

  it("sends the expected revision and returns the new revision", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return Response.json({
          id: "canvas-1",
          title: "Canvas",
          graph,
          revision: 5,
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveCanvas("canvas-1", graph, "Canvas", 4),
    ).resolves.toMatchObject({ revision: 5 });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      graph,
      title: "Canvas",
      expectedRevision: 4,
    });
  });

  it("raises a typed conflict error with the server revision", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: "画布已更新",
            code: "CANVAS_REVISION_CONFLICT",
            currentRevision: 9,
          },
          { status: 409 },
        ),
      ),
    );

    const error = await saveCanvas("canvas-1", graph, undefined, 7).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(CanvasSaveConflictError);
    expect(error).toMatchObject({
      message: "画布已更新",
      code: "CANVAS_REVISION_CONFLICT",
      currentRevision: 9,
    });
  });

  it("retries a transient canvas save failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: "暂时不可用" }, { status: 503 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "canvas-1",
          title: "Canvas",
          graph,
          revision: 6,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveCanvas("canvas-1", graph, "Canvas", 5),
    ).resolves.toMatchObject({ revision: 6 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("canvasErrorMessage", () => {
  it("limits issue details while retaining the base error", () => {
    expect(
      canvasErrorMessage(
        {
          error: "画布图包含无效连接",
          issues: [
            { message: "first" },
            { message: "second" },
            { message: "third" },
            { message: "fourth" },
          ],
        },
        "fallback",
      ),
    ).toBe("画布图包含无效连接：first；second；third；…");
  });
});
