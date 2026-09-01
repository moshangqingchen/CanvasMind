import { assertValidGraph } from "@super-canvas/core";
import type { PortDefinition, PortKind } from "@super-canvas/core";

import type {
  DirectorCanvasEdge,
  DirectorCanvasNode,
  DirectorGraphPatch,
  RoutedDirectorCall,
} from "./types.js";

export interface CompileDirectorGraphOptions {
  readonly origin?: { readonly x: number; readonly y: number };
  readonly idFactory?: (kind: "prompt" | "generation" | "edge") => string;
  readonly draft?: boolean;
  readonly proposalId?: string;
}

export class DirectorGraphCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectorGraphCompileError";
  }
}

const port = (
  id: string,
  kind: PortKind,
  label: string,
  required = false,
  multiple = false,
): PortDefinition => ({ id, kind, label, required, multiple });

function outputKind(call: RoutedDirectorCall): "image" | "video" {
  return call.requirements.operation.startsWith("video.") ? "video" : "image";
}

function assertCompilable(calls: readonly RoutedDirectorCall[]): void {
  if (calls.length === 0) {
    throw new DirectorGraphCompileError("At least one routed call is required");
  }
  const ids = new Set<string>();
  for (const call of calls) {
    if (ids.has(call.id)) {
      throw new DirectorGraphCompileError(`Duplicate call id: ${call.id}`);
    }
    ids.add(call.id);
    if (!call.selected?.eligible) {
      throw new DirectorGraphCompileError(
        `Call ${call.id} has no approved eligible model selection`,
      );
    }
    if (
      call.requirements.operation.startsWith("video.") &&
      call.requirements.count !== 1
    ) {
      throw new DirectorGraphCompileError(
        `Video call ${call.id} must produce exactly one clip`,
      );
    }
  }
  for (const call of calls) {
    for (const dependency of call.dependsOn ?? []) {
      if (!ids.has(dependency)) {
        throw new DirectorGraphCompileError(
          `Call ${call.id} has unknown dependency ${dependency}`,
        );
      }
      if (dependency === call.id) {
        throw new DirectorGraphCompileError(
          `Call ${call.id} cannot depend on itself`,
        );
      }
    }
  }
}

function callLayers(
  calls: readonly RoutedDirectorCall[],
): ReadonlyMap<string, number> {
  const callsById = new Map(calls.map((call) => [call.id, call] as const));
  const visiting = new Set<string>();
  const layers = new Map<string, number>();
  const layerFor = (id: string): number => {
    const known = layers.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) {
      throw new DirectorGraphCompileError("Call dependencies contain a cycle");
    }
    visiting.add(id);
    const dependencies = callsById.get(id)?.dependsOn ?? [];
    const layer = dependencies.length
      ? Math.max(...dependencies.map((dependency) => layerFor(dependency))) + 1
      : 0;
    visiting.delete(id);
    layers.set(id, layer);
    return layer;
  };
  for (const call of calls) layerFor(call.id);
  return layers;
}

function modelSupportsInput(
  call: RoutedDirectorCall,
  kind: "image" | "video",
): boolean {
  return (call.selected?.candidate.model.inputKinds ?? []).some(
    (candidate) => candidate === kind || candidate === `${kind}[]`,
  );
}

function dependencyTargetPort(
  source: RoutedDirectorCall,
  target: RoutedDirectorCall,
  imageDependencyIndex: number,
): string {
  const sourceKind = outputKind(source);
  const targetKind = outputKind(target);
  if (sourceKind === "video") {
    if (targetKind !== "video" || !modelSupportsInput(target, "video")) {
      throw new DirectorGraphCompileError(
        `Call ${target.id} cannot consume video output from ${source.id}`,
      );
    }
    return "referenceVideos";
  }
  if (!modelSupportsInput(target, "image")) {
    throw new DirectorGraphCompileError(
      `Call ${target.id} cannot consume image output from ${source.id}`,
    );
  }
  if (
    targetKind === "video" &&
    imageDependencyIndex === 0 &&
    target.requirements.operation === "video.image-to-video"
  ) {
    return "firstFrame";
  }
  return "references";
}

export function compileDirectorGraphPatch(
  calls: readonly RoutedDirectorCall[],
  options: CompileDirectorGraphOptions = {},
): DirectorGraphPatch {
  assertCompilable(calls);
  const origin = options.origin ?? { x: 120, y: 120 };
  const draft = options.draft ?? true;
  let sequence = 0;
  const batch = globalThis.crypto.randomUUID().slice(0, 8);
  const idFactory =
    options.idFactory ??
    ((kind: "prompt" | "generation" | "edge") =>
      `director-${kind}-${batch}-${sequence++}`);
  const nodes: DirectorCanvasNode[] = [];
  const edges: DirectorCanvasEdge[] = [];
  const generationNodeIds: string[] = [];
  const generationByCall = new Map<string, string>();
  const callById = new Map(calls.map((call) => [call.id, call] as const));
  const layers = callLayers(calls);
  const rowByLayer = new Map<number, number>();

  for (const call of calls) {
    const layer = layers.get(call.id) ?? 0;
    const row = rowByLayer.get(layer) ?? 0;
    rowByLayer.set(layer, row + 1);
    const promptId = idFactory("prompt");
    const generationId = idFactory("generation");
    const video = outputKind(call) === "video";
    const x = origin.x + layer * 900;
    const y = origin.y + row * 330;
    const commonData = {
      label: call.label,
      directorDraft: draft,
      directorCallId: call.id,
      ...(options.proposalId ? { directorProposalId: options.proposalId } : {}),
    } as const;

    nodes.push({
      id: promptId,
      type: "workflow",
      position: { x, y },
      style: { width: 360, height: 210 },
      data: {
        ...commonData,
        nodeType: "prompt",
        parts: [{ type: "text", text: call.prompt }],
        outputs: [port("prompt", "text", "提示词")],
      },
    });
    nodes.push({
      id: generationId,
      type: "workflow",
      position: { x: x + 420, y },
      style: { width: 420, height: 210 },
      data: {
        ...commonData,
        nodeType: video ? "video-generation" : "image-generation",
        provider: call.selected!.candidate.provider,
        connectionId: call.selected!.candidate.connectionId,
        model: call.selected!.candidate.model.id,
        parts: [{ type: "text", text: "" }],
        inputs: video
          ? [
              port("prompt", "text", "Prompt"),
              port("firstFrame", "image", "首帧"),
              port("lastFrame", "image", "尾帧"),
              port("references", "image[]", "参考图", false, true),
              port("referenceVideos", "video[]", "参考视频", false, true),
              port("referenceAudios", "audio[]", "参考音频", false, true),
            ]
          : [
              port("prompt", "text", "Prompt"),
              port("references", "image[]", "参考图", false, true),
            ],
        outputs: [
          port(
            video ? "video" : "images",
            video ? "video" : "image",
            video ? "视频" : "图片",
          ),
        ],
        parameters: call.parameters,
      },
    });
    edges.push({
      id: idFactory("edge"),
      source: promptId,
      sourceHandle: "prompt",
      target: generationId,
      targetHandle: "prompt",
      type: "smoothstep",
    });
    generationNodeIds.push(generationId);
    generationByCall.set(call.id, generationId);
  }

  for (const call of calls) {
    const target = generationByCall.get(call.id)!;
    let imageDependencyIndex = 0;
    for (const dependency of call.dependsOn ?? []) {
      const sourceCall = callById.get(dependency)!;
      const source = generationByCall.get(dependency)!;
      const sourceKind = outputKind(sourceCall);
      const targetHandle = dependencyTargetPort(
        sourceCall,
        call,
        imageDependencyIndex,
      );
      if (sourceKind === "image") imageDependencyIndex += 1;
      edges.push({
        id: idFactory("edge"),
        source,
        sourceHandle: sourceKind === "video" ? "video" : "images",
        target,
        targetHandle,
        type: "smoothstep",
      });
    }
  }

  assertValidGraph({ nodes, edges });
  return {
    nodes,
    edges,
    generationNodeIds,
    touchedExistingNodeIds: [],
  };
}
