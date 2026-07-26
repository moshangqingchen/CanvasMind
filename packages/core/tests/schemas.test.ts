import { describe, expect, it } from "vitest";

import {
  CreateRunRequestSchema,
  NormalizedRequestSchema,
  PromptPartSchema,
  WorkflowGraphSchema,
} from "../src/index.js";

describe("public schemas", () => {
  it("requires a selected node for partial run scopes", () => {
    expect(
      CreateRunRequestSchema.safeParse({
        canvasId: "canvas",
        clientRequestId: "client-idempotency-key",
        scope: "node",
      }).success,
    ).toBe(false);
    expect(
      CreateRunRequestSchema.safeParse({
        canvasId: "canvas",
        clientRequestId: "client-idempotency-key",
        scope: "all",
      }).success,
    ).toBe(true);
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
