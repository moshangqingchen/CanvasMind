import { describe, expect, it } from "vitest";
import type { AssetView, RunSnapshot } from "../components/types";
import {
  createImageEditDraft,
  filterDesignImages,
  imageDesignSourceForAsset,
  mergeDesignReviewAssets,
} from "./image-design";

const asset: AssetView = {
  id: "image-original",
  name: "夏日海报",
  kind: "image",
  mimeType: "image/png",
  size: 42,
  storageKey: "assets/original.png",
  createdAt: "2026-09-20T00:00:00Z",
  metadata: {
    runId: "run-original",
    nodeId: "node-original",
    imageDesignReview: {
      status: "approved",
      note: "保留品牌蓝色",
      revision: 2,
    },
  },
};
const snapshot: RunSnapshot = {
  run: {
    id: "run-original",
    canvasId: "canvas-original",
    scope: "node",
    status: "succeeded",
    createdAt: asset.createdAt,
  },
  nodes: [
    {
      id: "node-run",
      nodeId: "node-original",
      status: "succeeded",
      outputAssetIds: [asset.id],
      request: {
        provider: "openai",
        connectionId: "original-key-group",
        model: "original-model",
        parameters: { size: "1536x1024", quality: "high", n: 4 },
      },
    },
  ],
};

describe("image design workflow", () => {
  it("keeps a saved review when an older asset-list request arrives later, without resurrecting deleted assets", () => {
    const stale = {
      ...asset,
      metadata: { runId: "run-original", nodeId: "node-original", width: 1536 },
    };
    const merged = mergeDesignReviewAssets([asset], [stale]);
    expect(merged[0]?.metadata.imageDesignReview).toEqual(
      asset.metadata.imageDesignReview,
    );
    expect(merged[0]?.metadata.width).toBe(1536);
    expect(mergeDesignReviewAssets([asset], [])).toEqual([]);
    const newer = {
      ...asset,
      metadata: {
        imageDesignReview: {
          status: "rejected",
          revision: 3,
          note: "新版评审",
        },
      },
    };
    expect(mergeDesignReviewAssets([asset], [newer])[0]).toEqual(newer);
  });
  it("filters generated images by review notes and status without including video or uploads", () => {
    const assets: AssetView[] = [
      asset,
      {
        ...asset,
        id: "unreviewed",
        name: "另一个版本",
        metadata: { runId: "run-2" },
      },
      { ...asset, id: "video", kind: "video" },
      { ...asset, id: "upload", metadata: {} },
    ];
    expect(
      filterDesignImages(assets, " 品牌蓝色 ", "approved").map(({ id }) => id),
    ).toEqual([asset.id]);
    expect(
      filterDesignImages(assets, "", "unreviewed").map(({ id }) => id),
    ).toEqual(["unreviewed"]);
    expect(filterDesignImages(assets, "", "all")).toHaveLength(2);
  });

  it("requires both producing run and output identity, refusing an unrelated or incomplete request", () => {
    expect(imageDesignSourceForAsset(asset, snapshot).model).toBe(
      "original-model",
    );
    expect(() =>
      imageDesignSourceForAsset(asset, {
        ...snapshot,
        run: { ...snapshot.run, id: "other-run" },
      }),
    ).toThrow("原始生成配置");
    expect(() =>
      imageDesignSourceForAsset(asset, {
        ...snapshot,
        nodes: [{ ...snapshot.nodes[0]!, outputAssetIds: ["other-image"] }],
      }),
    ).toThrow("原始生成配置");
    expect(() =>
      imageDesignSourceForAsset(asset, {
        ...snapshot,
        nodes: [
          { ...snapshot.nodes[0]!, request: { model: "missing-connection" } },
        ],
      }),
    ).toThrow("原始生成配置");
  });

  it("creates a fresh reference and edit node with original configuration and a single output", () => {
    const before = structuredClone({ asset, snapshot });
    const draft = createImageEditDraft({
      asset,
      source: imageDesignSourceForAsset(asset, snapshot),
      position: { x: 20, y: 30 },
    });
    expect(draft.nodes).toHaveLength(2);
    const [reference, edit] = draft.nodes;
    expect(reference?.data.assetId).toBe(asset.id);
    expect(edit?.data).toMatchObject({
      provider: "openai",
      connectionId: "original-key-group",
      model: "original-model",
      parameters: { size: "1536x1024", quality: "high", n: 1 },
      designSourceAssetId: asset.id,
      parts: [{ type: "text", text: "保留品牌蓝色" }],
    });
    expect(edit?.id).toBe(draft.editNodeId);
    expect(edit?.id).not.toBe("node-original");
    expect(edit?.data.generatedResult).toBeUndefined();
    expect(draft.edges).toEqual([
      expect.objectContaining({
        source: reference?.id,
        target: edit?.id,
        sourceHandle: "asset",
        targetHandle: "references",
      }),
    ]);
    expect({ asset, snapshot }).toEqual(before);
  });

  it("retains a painted mask without pretending an unavailable provider can run it", () => {
    const draft = createImageEditDraft({ asset, source: null,
      parameters: { maskAssetId: "saved-mask", maskSourceAssetId: asset.id }, position: { x: 0, y: 0 } });
    const edit = draft.nodes.find(node => node.id === draft.editNodeId)!;
    expect(edit.data).toMatchObject({ parameters: { maskAssetId: "saved-mask", maskSourceAssetId: asset.id, n: 1 } });
    expect(edit.style?.height).toBe(360);
    expect(edit.data.provider).toBeUndefined();
    expect(edit.data.connectionId).toBeUndefined();
    expect(edit.data.model).toBeUndefined();
  });
});
