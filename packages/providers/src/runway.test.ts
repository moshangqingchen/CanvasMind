import { describe, expect, it, vi } from "vitest";
import { StaticConnectionResolver } from "./credentials";
import { RunwayAdapter } from "./runway";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("RunwayAdapter", () => {
  it("submits, polls, extracts and cancels an image-to-video task", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "DELETE")
          return new Response(null, { status: 204 });
        if (url.includes("/tasks/task-42")) {
          return jsonResponse({
            id: "task-42",
            status: "SUCCEEDED",
            progress: 1,
            output: ["https://runway.test/output.mp4"],
          });
        }
        expect(url).toContain("/image_to_video");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          model: "gen4.5",
          promptText: "Camera slowly pushes forward",
          promptImage: "https://assets.test/frame.png",
          duration: 5,
        });
        return jsonResponse({ id: "task-42", status: "PENDING" });
      },
    ) as unknown as typeof fetch;
    const adapter = new RunwayAdapter(
      new StaticConnectionResolver([
        {
          id: "runway",
          provider: "runway",
          apiKey: "rw-test",
          baseUrl: "https://runway.test/v1",
        },
      ]),
      { fetch: fetchMock },
    );
    const submitted = await adapter.submit({
      connectionId: "runway",
      operation: "video.image-to-video",
      prompt: "Camera slowly pushes forward",
      idempotencyKey: "idem-3",
      assets: [
        {
          id: "frame",
          kind: "image",
          mimeType: "image/png",
          url: "https://assets.test/frame.png",
        },
      ],
      parameters: { duration: 5 },
    });
    expect(submitted.status).toBe("running");
    const completed = await adapter.poll(submitted);
    expect(completed).toMatchObject({ status: "succeeded", progress: 1 });
    expect(await adapter.extractOutputs(completed.result)).toEqual([
      {
        kind: "video",
        url: "https://runway.test/output.mp4",
        mimeType: "video/mp4",
      },
    ]);
    await adapter.cancel(completed);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://runway.test/v1/tasks/task-42",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("rejects unsupported assets and invalid parameters before task creation", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const adapter = new RunwayAdapter(
      new StaticConnectionResolver([
        { id: "runway", provider: "runway", apiKey: "rw-test" },
      ]),
      { fetch: fetchMock },
    );
    const invalidRequest = {
      connectionId: "runway",
      operation: "video.image-to-video" as const,
      prompt: "Move forward",
      idempotencyKey: "invalid-runway",
      assets: [
        {
          id: "bad-frame",
          kind: "image" as const,
          mimeType: "video/mp4",
          role: "lastFrame" as const,
          data: new Uint8Array(),
        },
        {
          id: "input-video",
          kind: "video" as const,
          mimeType: "video/mp4",
          url: "https://assets.test/input.mp4",
        },
      ],
      parameters: { duration: "5", ratio: "wide" },
    };

    const validation = await adapter.validate(invalidRequest);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "too_many_images",
        "invalid_duration",
        "invalid_ratio",
        "unsupported_mime_type",
        "unsupported_asset_role",
        "unresolved_asset",
        "unsupported_asset_kind",
      ]),
    );
    await expect(adapter.submit(invalidRequest)).rejects.toThrow(
      "Provider request is invalid",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not silently ignore image assets on text-to-video requests", async () => {
    const adapter = new RunwayAdapter(
      new StaticConnectionResolver([
        { id: "runway", provider: "runway", apiKey: "rw-test" },
      ]),
    );
    const validation = await adapter.validate({
      connectionId: "runway",
      operation: "video.generate",
      prompt: "Clouds moving over a ridge",
      idempotencyKey: "text-with-image",
      assets: [
        {
          id: "frame",
          kind: "image",
          mimeType: "image/png",
          data: new Uint8Array([1]),
        },
      ],
    });
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "assets_not_supported" }),
      ]),
    );
  });

  it("marks a task creation response without an id as ambiguous", async () => {
    const adapter = new RunwayAdapter(
      new StaticConnectionResolver([
        {
          id: "runway",
          provider: "runway",
          apiKey: "rw-test",
          baseUrl: "https://runway.test/v1",
        },
      ]),
      {
        fetch: (async () =>
          jsonResponse({ status: "PENDING" })) as typeof fetch,
      },
    );

    await expect(
      adapter.submit({
        connectionId: "runway",
        operation: "video.generate",
        prompt: "A cinematic ocean",
        idempotencyKey: "missing-runway-id",
      }),
    ).rejects.toMatchObject({
      details: {
        kind: "invalid_response",
        phase: "submit",
        retryable: false,
        submissionMayHaveOccurred: true,
      },
    });
  });
});
