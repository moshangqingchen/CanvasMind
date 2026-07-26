import { describe, expect, it } from "vitest";

import {
  maskConnection,
  publicRunSnapshot,
  publicRuntimeEvent,
} from "./server";

describe("maskConnection", () => {
  it("deeply masks sensitive headers from legacy provider configs", () => {
    const masked = maskConnection({
      id: "legacy-rest",
      name: "Legacy REST",
      provider: "rest",
      encryptedSecret: "encrypted-value",
      config: {
        headers: {
          Authorization: "Bearer legacy-secret",
          Cookie: "session=legacy-secret",
          Accept: "application/json",
        },
        connector: {
          submit: {
            headers: {
              "X-API-Key": "legacy-secret",
              "Content-Type": "application/json",
            },
          },
          poll: {
            headers: { "Proxy-Authorization": "legacy-secret" },
          },
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(JSON.stringify(masked)).not.toContain("legacy-secret");
    expect(masked?.config).toMatchObject({
      headers: {
        Authorization: "********",
        Cookie: "********",
        Accept: "application/json",
      },
      connector: {
        submit: {
          headers: {
            "X-API-Key": "********",
            "Content-Type": "application/json",
          },
        },
        poll: {
          headers: { "Proxy-Authorization": "********" },
        },
      },
    });
  });
});

describe("public run snapshots", () => {
  it("omits recovery payloads and provider response material", () => {
    const snapshot = publicRunSnapshot({
      run: {
        id: "run-1",
        canvasId: "canvas-1",
        clientRequestId: "request-1",
        scope: "all",
        nodeId: null,
        status: "needs_attention",
        revisionGraph: {
          nodes: [{ data: { headers: { Authorization: "graph-secret" } } }],
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
      },
      nodes: [
        {
          id: "node-run-1",
          workflowRunId: "run-1",
          nodeId: "image-1",
          status: "needs_attention",
          attempt: 1,
          providerTaskId: "provider-task-1",
          inputJson: {
            providerTask: {
              raw: {
                headers: { Authorization: "provider-secret" },
                image: "data:image/png;base64,QUJDREVGRw==",
              },
            },
          },
          outputAssetIds: ["asset-1", 42 as unknown as string],
          errorJson: {
            message: "provider failed: apiKey=provider-secret",
            type: "请求参数错误",
            code: "invalid_request",
            api: "OpenAI Images API",
            docsUrl:
              "https://platform.openai.com/docs/guides/error-codes/api-errors",
            raw: "data:image/png;base64,QUJDREVGRw==",
          },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    });

    expect(snapshot).toEqual({
      run: {
        id: "run-1",
        canvasId: "canvas-1",
        clientRequestId: "request-1",
        scope: "all",
        nodeId: null,
        status: "needs_attention",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
      },
      nodes: [
        {
          id: "node-run-1",
          nodeId: "image-1",
          status: "needs_attention",
          outputAssetIds: ["asset-1"],
          errorJson: {
            message: "provider failed: apiKey=[redacted]",
            type: "请求参数错误",
            code: "invalid_request",
            api: "OpenAI Images API",
            docsUrl:
              "https://platform.openai.com/docs/guides/error-codes/api-errors",
          },
        },
      ],
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("providerTask");
    expect(serialized).not.toContain("provider-task-1");
    expect(serialized).not.toContain("provider-secret");
    expect(serialized).not.toContain("QUJDREVGRw==");
    expect(serialized).not.toContain("revisionGraph");
  });

  it("keeps SSE events to the public status/output subset", () => {
    const event = publicRuntimeEvent({
      type: "node",
      runId: "run-1",
      nodeRunId: "node-run-1",
      at: "2026-01-01T00:00:00.000Z",
      payload: {
        nodeId: "image-1",
        status: "succeeded",
        output: {
          kind: "image",
          assetIds: ["asset-1"],
          prompt: "private prompt",
          providerTask: { raw: "provider-secret" },
        },
        inputJson: { Authorization: "provider-secret" },
      },
    });

    expect(event).toEqual({
      type: "node",
      runId: "run-1",
      nodeRunId: "node-run-1",
      at: "2026-01-01T00:00:00.000Z",
      payload: {
        nodeId: "image-1",
        status: "succeeded",
        output: { kind: "image", assetIds: ["asset-1"] },
      },
    });
    expect(JSON.stringify(event)).not.toContain("provider-secret");
    expect(JSON.stringify(event)).not.toContain("private prompt");
  });
});
