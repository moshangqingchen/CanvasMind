import { describe, expect, it } from "vitest";

import {
  maskConnection,
  nodeRunRecoveryAction,
  publicRunSnapshot,
  publicRunRequest,
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
  it("publishes only recognized submission phases without cloud credentials", () => {
    expect(publicRunRequest({ submissionPhase: "generating", cloudGeneration: { endpoint: "https://cloud.example.com", encryptedToken: "private" } })).toEqual({ submissionPhase: "generating" });
    expect(publicRunRequest({ submissionPhase: "private arbitrary value" })).toBeNull();
  });
  it("preserves reusable image and video settings, including empty parameter sets", () => {
    const parameters = { size_tier: "2K", image_quality: "low", output_quality: "medium", background: "opaque",
      output_compression: 0, response_format: "b64_json", style: "natural", seed: 0, generate_audio: false,
      audio: true, negative_prompt: "avoid artifacts ".repeat(30), reference_mode: "frame", seconds: 10 };
    expect(publicRunRequest({ parameters })?.parameters).toEqual(parameters);
    expect(publicRunRequest({ parameters: {} })).toEqual({ parameters: {} });
    expect(publicRunRequest({ provider: "rest" })?.parameters).toBeUndefined();
  });

  it("preserves custom model parameters declared in the frozen run without exposing secrets", () => {
    const snapshot = recoverySnapshot();
    const result = publicRunSnapshot({
      ...snapshot,
      run: { ...snapshot.run, revisionGraph: { nodes: [{ id: "image", data: { __runtimeConnection: { config: {
        modelCatalogModels: [{ id: "custom-model", parameters: [
          { key: "motion_strength" }, { key: "camera_fixed" }, { key: "api_key" },
        ] }],
      } } } }] } },
      nodes: [{ ...snapshot.nodes[0]!, inputJson: { model: "custom-model", parameters: {
        motion_strength: 0.5, camera_fixed: false, api_key: "private-secret", untrusted: "private-value",
      } } }],
    });
    expect(result?.nodes[0]?.request?.parameters).toEqual({ motion_strength: 0.5, camera_fixed: false });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("publishes reference metadata and only includes the sanitized prompt on a details request", () => {
    const input = {
      prompt: "Use both references. token=private-token",
      assetIds: ["ref-1", "ref-1", "ref-2", 42],
      inputAssets: [
        { id: "ref-1", name: "Reference.png", kind: "image", role: "reference", url: "https://private.test/?token=secret", data: "private-bytes" },
        { id: "ref-2", name: "Frame.png", kind: "image", role: "firstFrame" },
        { name: "invalid" },
      ],
    };
    const result = publicRunRequest(input, true);
    expect(result?.inputAssetIds).toEqual(["ref-1", "ref-2"]);
    expect(result?.inputAssets).toEqual([
      { id: "ref-1", name: "Reference.png", kind: "image", role: "reference" },
      { id: "ref-2", name: "Frame.png", kind: "image", role: "firstFrame" },
    ]);
    expect(result?.prompt).toBe("Use both references. token=[redacted]");
    expect(JSON.stringify(result)).not.toMatch(/private|https/);
    expect(publicRunRequest(input)?.prompt).toBeUndefined();
    expect(publicRunRequest({})).toBeNull();
    expect(publicRunRequest({ assetIds: [], inputAssets: [] })).toEqual({ inputAssetIds: [], inputAssets: [] });
  });

  const recoverySnapshot = () => ({
    run: {
      id: "cancelled-run", canvasId: "canvas", clientRequestId: "request",
      scope: "node" as const, status: "cancelled" as const,
      revisionGraph: { nodes: [], edges: [], localRecoveryExpired: true },
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:01.000Z",
    },
    nodes: [{
      id: "cancelled-node", workflowRunId: "cancelled-run", nodeId: "image",
      status: "cancelled" as const, attempt: 1, providerTaskId: "provider-task",
      inputJson: { provider: "openai", providerTask: {
        status: "succeeded", providerTaskId: "provider-task",
        result: { response: { data: [{ url: "https://private.test/original.png?token=secret" }] } },
      } },
      outputAssetIds: [] as string[], errorJson: null,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:01.000Z",
    }],
  });

  it.each(["cancelled", "failed", "needs_attention"] as const)(
    "offers archive-only recovery for %s even after graph retention expires",
    (status) => {
      const input = recoverySnapshot();
      const snapshot = publicRunSnapshot({ ...input, run: { ...input.run, status } });
      expect(snapshot?.run.canRecoverOutputs).toBe(true);
      expect(snapshot?.run.canResume).toBe(false);
      expect(JSON.stringify(snapshot)).not.toMatch(/providerTask|original\.png|secret/);
    },
  );

  it("exposes CLI cancellation support without leaking command or job paths", () => {
    const input = recoverySnapshot();
    const node = input.nodes[0]!;
    const snapshot = publicRunSnapshot({ ...input, nodes: [{ ...node, inputJson: {
      provider: "cli", providerTask: { status: "running", providerTaskId: "site-task", result: {
        cli: { supportsCancel: false, jobKey: "private-job-key" },
        remote: { path: "C:/private/video.mp4" },
      } },
      __runtimeConnection: { executable: "C:/private/bridge.exe" },
    } }] });
    expect(snapshot?.nodes[0]?.cliCancelSupported).toBe(false);
    expect(JSON.stringify(snapshot)).not.toMatch(/private|executable|providerTask/);
  });

  it("does not offer archive-only recovery without a saved successful unarchived result", () => {
    const input = recoverySnapshot();
    const node = input.nodes[0]!;
    const task = node.inputJson.providerTask;
    for (const changed of [
      { ...node, outputAssetIds: ["existing-asset"] },
      { ...node, providerTaskId: "different-task" },
      { ...node, inputJson: { ...node.inputJson, provider: "" } },
      { ...node, inputJson: { ...node.inputJson, providerTask: { ...task, status: "running" } } },
      { ...node, inputJson: { ...node.inputJson, providerTask: { ...task, result: null } } },
    ]) {
      expect(publicRunSnapshot({ ...input, nodes: [changed] })?.run.canRecoverOutputs).toBe(false);
    }
    expect(publicRunSnapshot({ ...input, run: { ...input.run, status: "running" } })?.run.canRecoverOutputs).toBe(false);
  });

  it("keeps an interrupted archive recoverable without resubmission", () => {
    expect(
      nodeRunRecoveryAction({
        id: "node-run-archive",
        workflowRunId: "run-archive",
        nodeId: "image-archive",
        status: "archiving",
        attempt: 1,
        providerTaskId: "provider-task-archive",
        inputJson: {
          providerTask: { status: "succeeded" },
        },
        outputAssetIds: [],
        errorJson: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
      }),
    ).toBe("resume_archive");
  });

  it("does not offer a pointless cloud poll after a terminal supplier 524", () => {
    expect(
      nodeRunRecoveryAction({
        id: "node-run-cloud-524",
        workflowRunId: "run-cloud-524",
        nodeId: "image-cloud-524",
        status: "needs_attention",
        attempt: 1,
        providerTaskId: "cloud:abc",
        inputJson: {
          cloudGeneration: { endpoint: "https://cloud.example.com" },
          providerTask: { status: "running" },
        },
        outputAssetIds: [],
        errorJson: { code: "HTTP 524", statusCode: 524 },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
      }),
    ).toBeUndefined();
  });

  it("does not offer recovery after the local snapshot retention limit", () => {
    const snapshot = publicRunSnapshot({
      run: {
        id: "expired-run",
        canvasId: "canvas-1",
        clientRequestId: "expired-request",
        scope: "all",
        status: "needs_attention",
        revisionGraph: {
          schemaVersion: 1,
          nodes: [],
          edges: [],
          localRecoveryExpired: true,
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
      },
      nodes: [
        {
          id: "expired-node-run",
          workflowRunId: "expired-run",
          nodeId: "image-1",
          status: "needs_attention",
          attempt: 1,
          providerTaskId: "provider-task-1",
          inputJson: { providerTask: { status: "running" } },
          outputAssetIds: [],
          errorJson: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    });

    expect(snapshot?.run.canResume).toBe(false);
  });

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
            provider: "weai",
            supplier: "weai",
            connectionId: "connection-1",
            connectionName: "We-AI · Adobe 按次",
            modelGroup: "生图-openai-adobe-按次",
            operation: "image.generate",
            model: "gpt-image-2::4k",
            prompt: "private prompt",
            parameters: {
              size: "2176x3264",
              quality: "high",
              n: 1,
              untrusted: "must-not-be-public",
            },
            providerTask: {
              status: "succeeded",
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
            statusCode: 400,
            providerMessage: "Unsupported size; token=provider-secret",
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
        canResume: true,
        canRecoverOutputs: false,
      },
      nodes: [
        {
          id: "node-run-1",
          nodeId: "image-1",
          status: "needs_attention",
          updatedAt: "2026-01-01T00:00:01.000Z",
          outputAssetIds: ["asset-1"],
          errorJson: {
            message: "provider failed: apiKey=[redacted]",
            type: "请求参数错误",
            code: "invalid_request",
            api: "OpenAI Images API",
            statusCode: 400,
            providerMessage: "Unsupported size; token=[redacted]",
            docsUrl:
              "https://platform.openai.com/docs/guides/error-codes/api-errors",
          },
          recoveryAction: "resume_archive",
          request: {
            provider: "weai",
            supplier: "weai",
            connectionId: "connection-1",
            connectionName: "We-AI · Adobe 按次",
            modelGroup: "生图-openai-adobe-按次",
            operation: "image.generate",
            model: "gpt-image-2::4k",
            parameters: {
              size: "2176x3264",
              quality: "high",
              n: 1,
            },
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
    expect(serialized).not.toContain("private prompt");
    expect(serialized).not.toContain("must-not-be-public");
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
