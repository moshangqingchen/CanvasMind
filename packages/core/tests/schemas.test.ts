import { describe, expect, it } from "vitest";

import {
  CreateRunRequestSchema,
  NormalizedRequestSchema,
  PromptPartSchema,
  WorkflowGraphSchema,
} from "../src/index.js";

describe("public schemas", () => {
  it("accepts optional run fingerprints while retaining the strict revision contract for legacy callers", () => {
    const input = { canvasId: "canvas", clientRequestId: "request", expectedRevision: 1, scope: "all" };
    expect(CreateRunRequestSchema.safeParse(input).success).toBe(true);
    expect(CreateRunRequestSchema.safeParse({ ...input, runFingerprint: "canonical-execution-data" }).success).toBe(true);
    for (const runFingerprint of ["", 3, null, {}]) {
      expect(CreateRunRequestSchema.safeParse({ ...input, runFingerprint }).success).toBe(false);
    }
  });

  it("requires a selected node for partial run scopes", () => {
    expect(
      CreateRunRequestSchema.safeParse({
        canvasId: "canvas",
        clientRequestId: "client-idempotency-key",
        expectedRevision: 1,
        scope: "node",
      }).success,
    ).toBe(false);
    expect(
      CreateRunRequestSchema.safeParse({
        canvasId: "canvas",
        clientRequestId: "client-idempotency-key",
        expectedRevision: 1,
        scope: "all",
      }).success,
    ).toBe(true);
  });

  it.each([undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"])("rejects unbound or invalid run revision %s", expectedRevision => {
    expect(CreateRunRequestSchema.safeParse({
      canvasId: "canvas", clientRequestId: "request", scope: "all", expectedRevision,
    }).success).toBe(false);
  });

  it("rejects malformed prompt references", () => {
    expect(
      PromptPartSchema.safeParse({
        type: "asset",
        assetId: "",
        role: "thumbnail",
      }).success,
    ).toBe(false);
  });

  it("accepts custom node types while retaining strict graph structure", () => {
    expect(
      WorkflowGraphSchema.safeParse({
        nodes: [{ id: "custom", type: "my-provider-node" }],
        edges: [],
      }).success,
    ).toBe(true);
    expect(
      WorkflowGraphSchema.safeParse({ nodes: [], edges: [], unknown: true })
        .success,
    ).toBe(false);
  });

  it("validates normalized provider requests", () => {
    expect(
      NormalizedRequestSchema.safeParse({
        provider: "fake",
        model: "fake-image",
        capability: "image.generate",
        prompt: [{ type: "text", text: "hello" }],
        assets: [],
        parameters: {},
        idempotencyKey: "node-run-1",
      }).success,
    ).toBe(true);
  });
});
