import { validateGraph } from "@super-canvas/core";
import { describe, expect, it } from "vitest";

import {
  compileDirectorGraphPatch,
  DirectorGraphCompileError,
} from "../src/compiler.js";
import { routeDirectorCall } from "../src/routing.js";
import type {
  DirectorCallDraft,
  DirectorCatalogCandidate,
  RoutedDirectorCall,
} from "../src/types.js";

const NOW = new Date("2026-08-30T00:00:00.000Z");

function modelCandidate(
  id: string,
  kind: "image" | "video",
): DirectorCatalogCandidate {
  return {
    connectionId: `connection-${id}`,
    connectionName: id,
    provider: "test",
    supplier: "test",
    authoritative: true,
    catalogCheckedAt: "2026-08-30T00:00:00.000Z",
    model: {
      id,
      name: id,
      operations:
        kind === "image"
          ? ["image.generate", "image.edit"]
          : ["video.generate", "video.image-to-video"],
      inputKinds:
        kind === "image"
          ? ["text", "image", "image[]"]
          : ["text", "image", "image[]", "video", "video[]"],
      outputKinds: [kind],
      parameters:
        kind === "video"
          ? [
              {
                key: "duration",
                label: "Duration",
                control: "number",
                min: 1,
                max: 30,
              },
            ]
          : [],
      pricing: {
        kind: kind === "image" ? "per-image" : "per-second",
        currency: "CNY",
        unitAmount: 1,
        checkedAt: "2026-08-30T00:00:00.000Z",
        validUntil: "2026-09-01T00:00:00.000Z",
        confidence: "exact",
      },
    },
  };
}

function routed(
  call: DirectorCallDraft,
  candidate: DirectorCatalogCandidate,
): RoutedDirectorCall {
  return routeDirectorCall(call, [candidate], undefined, { now: NOW });
}

describe("director graph compiler", () => {
  it("compiles a selected multi-step workflow with compatible dependencies", () => {
    const image = routed(
      {
        id: "keyframe",
        label: "Keyframe",
        prompt: "hero keyframe",
        requirements: { operation: "image.generate", count: 1 },
      },
      modelCandidate("image-model", "image"),
    );
    const video = routed(
      {
        id: "clip",
        label: "Clip",
        prompt: "animate the keyframe",
        requirements: {
          operation: "video.image-to-video",
          count: 1,
          durationSeconds: 5,
          inputKinds: ["image"],
          inputCounts: { image: 1 },
        },
        dependsOn: ["keyframe"],
      },
      modelCandidate("video-model", "video"),
    );
    let id = 0;
    const patch = compileDirectorGraphPatch([image, video], {
      proposalId: "proposal-1",
      origin: { x: 10, y: 20 },
      idFactory: (kind) => `${kind}-${id++}`,
    });

    expect(patch.nodes).toHaveLength(4);
    expect(patch.generationNodeIds).toEqual(["generation-1", "generation-4"]);
    expect(patch.edges.at(-1)).toMatchObject({
      source: "generation-1",
      sourceHandle: "images",
      target: "generation-4",
      targetHandle: "firstFrame",
    });
    expect(patch.nodes[2]?.position.x).toBeGreaterThan(
      patch.nodes[0]!.position.x,
    );
    expect(
      patch.nodes.every(
        (node) => node.data.directorProposalId === "proposal-1",
      ),
    ).toBe(true);
    expect(validateGraph(patch).valid).toBe(true);
  });

  it("refuses to compile calls without an approved eligible selection", () => {
    expect(() =>
      compileDirectorGraphPatch([
        {
          id: "unpriced",
          label: "Unpriced",
          prompt: "prompt",
          requirements: { operation: "image.generate", count: 1 },
          alternatives: [],
          parameters: { n: 1 },
        },
      ]),
    ).toThrow(DirectorGraphCompileError);
  });

  it("allows an explicitly selected eligible candidate with unknown pricing", () => {
    const call = routed(
      {
        id: "manual",
        label: "Manual candidate",
        prompt: "prompt",
        requirements: { operation: "image.generate", count: 1 },
      },
      {
        ...modelCandidate("manual", "image"),
        model: {
          ...modelCandidate("manual", "image").model,
          pricing: undefined,
        },
      },
    );
    const manualQuote = call.alternatives[0]!;
    expect(manualQuote).toMatchObject({
      eligible: true,
      comparable: false,
      pricingStatus: "unknown",
    });
    let id = 0;
    const patch = compileDirectorGraphPatch(
      [{ ...call, selected: manualQuote }],
      { idFactory: (kind) => `${kind}-${id++}` },
    );
    expect(patch.generationNodeIds).toHaveLength(1);
  });

  it("rejects an incompatible video-to-image dependency", () => {
    const video = routed(
      {
        id: "clip",
        label: "Clip",
        prompt: "clip",
        requirements: {
          operation: "video.generate",
          count: 1,
          durationSeconds: 5,
        },
      },
      modelCandidate("video-model", "video"),
    );
    const imageCandidate = modelCandidate("image-model", "image");
    const image = routed(
      {
        id: "poster",
        label: "Poster",
        prompt: "poster",
        requirements: {
          operation: "image.generate",
          count: 1,
          inputKinds: ["video"],
        },
        dependsOn: ["clip"],
      },
      {
        ...imageCandidate,
        model: {
          ...imageCandidate.model,
          inputKinds: ["text", "image", "image[]", "video", "video[]"],
        },
      },
    );
    expect(() => compileDirectorGraphPatch([video, image])).toThrow(
      "cannot consume video output",
    );
  });
});
