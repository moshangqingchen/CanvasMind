import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { AssetView, CanvasEdge, CanvasNode } from "../components/types";
import {
  directLinkedAssetsForNode,
  linkedMediaLimitText,
  validateLinkedMediaInputs,
} from "./linked-media";

function asset(id: string, kind: AssetView["kind"]): AssetView {
  return {
    id,
    kind,
    name: `${id}.bin`,
    mimeType: `${kind}/test`,
    size: 1,
    storageKey: id,
    metadata: {},
    createdAt: "2026-07-22T00:00:00.000Z",
  };
}

function node(id: string, data: CanvasNode["data"]): CanvasNode {
  return { id, type: "workflow", position: { x: 0, y: 0 }, data };
}

describe("linked generation media", () => {
  it("keeps direct edge and output order while excluding indirect assets", () => {
    const assets = [
      asset("far-image", "image"),
      asset("image-1", "image"),
      asset("image-2", "image"),
      asset("video-1", "video"),
      asset("audio-1", "audio"),
    ];
    const nodes = [
      node("far", { label: "far", assetId: "far-image" }),
      node("source-a", {
        label: "a",
        lastOutputAssetIds: ["image-1", "video-1"],
      }),
      node("source-b", {
        label: "b",
        assetId: "image-2",
        lastOutputAssetIds: ["audio-1"],
      }),
      node("target", { label: "target", nodeType: "video-generation" }),
    ];
    const edges: CanvasEdge[] = [
      { id: "indirect", source: "far", target: "source-a" },
      { id: "a", source: "source-a", target: "target" },
      { id: "b", source: "source-b", target: "target" },
      { id: "duplicate", source: "source-a", target: "target" },
    ];

    expect(
      directLinkedAssetsForNode("target", nodes, edges, assets).map(
        (item) => item.id,
      ),
    ).toEqual(["image-1", "video-1", "image-2", "audio-1"]);
  });

  it("reports documented support, count, per-video, and total duration limits", () => {
    const model: ModelDescriptor = {
      id: "video-model",
      name: "视频模型",
      operations: ["video.generate"],
      inputKinds: ["text", "video", "video[]"],
      limits: {
        maxInputVideos: 2,
        maxInputVideoDurationSeconds: 15,
        maxTotalInputVideoDurationSeconds: 20,
      },
    };
    const linked = [asset("v1", "video"), asset("v2", "video")];

    expect(linkedMediaLimitText(model, linked)).toBe(
      "最多 2 个视频，单个最长 15 秒，合计最长 20 秒",
    );
    expect(
      validateLinkedMediaInputs(model, linked, { v1: 16.2, v2: 8 }),
    ).toEqual([
      "视频 1 为 16.2 秒，超过当前模型单个视频最多 15 秒",
      "参考视频合计 24.2 秒，超过当前模型最多 20 秒",
    ]);
  });

  it("blocks video input when the model documentation declares no support", () => {
    const model: ModelDescriptor = {
      id: "text-to-video",
      name: "纯文生视频",
      operations: ["video.generate"],
      inputKinds: ["text", "image"],
      limits: { maxInputVideos: 0 },
    };

    expect(validateLinkedMediaInputs(model, [asset("v1", "video")])).toEqual([
      "模型“纯文生视频”不支持输入视频，请删除视频连线或更换模型",
    ]);
  });

  it("reports documented audio duration limits", () => {
    const model: ModelDescriptor = {
      id: "audio-reference-model",
      name: "音频参考模型",
      operations: ["video.generate"],
      inputKinds: ["text", "audio", "audio[]"],
      limits: {
        maxInputAudios: 1,
        maxInputAudioDurationSeconds: 12,
      },
    };

    expect(
      validateLinkedMediaInputs(model, [asset("a1", "audio")], { a1: 13.4 }),
    ).toEqual(["音频 1 为 13.4 秒，超过当前模型单个音频最多 12 秒"]);
  });
});
