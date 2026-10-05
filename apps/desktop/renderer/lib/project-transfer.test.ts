import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import type { AssetView, CanvasDocument } from "../components/types";
import {
  collectReferencedAssetIds,
  createPortableProjectPackage,
  PROJECT_JSON_FORMAT,
  PROJECT_PACKAGE_FORMAT,
  PROJECT_PACKAGE_VERSION,
  ProjectAssetUploadError,
  prepareProjectImport,
  remapGraphAssetIds,
  uploadPreparedPackageAssets,
} from "./project-transfer";

const graph: CanvasDocument = {
  schemaVersion: 1,
  nodes: [
    {
      id: "asset-node",
      type: "workflow",
      position: { x: 10, y: 20 },
      data: {
        nodeType: "asset-input",
        label: "素材",
        assetId: "asset-old",
        outputs: [{ id: "image", kind: "image", label: "图片" }],
      },
    },
    {
      id: "prompt-node",
      type: "workflow",
      position: { x: 300, y: 20 },
      data: {
        nodeType: "prompt",
        label: "Prompt",
        parts: [
          { type: "text", text: "参考 " },
          { type: "asset", assetId: "asset-old", role: "reference" },
        ],
        lastOutputAssetIds: ["generated-old"],
        materializedOutputAssetIds: ["generated-old"],
        generatedPromptParts: [
          { type: "asset", assetId: "asset-old", role: "reference" },
        ],
        outputs: [{ id: "prompt", kind: "text", label: "提示词" }],
      },
    },
  ],
  edges: [],
  drawings: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

function asset(id: string, bytes: Uint8Array, name = `${id}.png`): AssetView {
  return {
    id,
    name,
    kind: "image",
    mimeType: "image/png",
    size: bytes.byteLength,
    storageKey: `assets/${id}/original.png`,
    metadata: {},
    createdAt: "2026-08-09T00:00:00.000Z",
  };
}

function packageManifest(
  packageGraph: unknown,
  packageAssets: unknown[] = [],
): Record<string, unknown> {
  return {
    format: PROJECT_PACKAGE_FORMAT,
    version: PROJECT_PACKAGE_VERSION,
    exportedAt: "2026-08-09T00:00:00.000Z",
    title: "导入项目",
    graph: packageGraph,
    assets: packageAssets,
  };
}

function packageFile(
  manifest: unknown,
  entries: Record<string, Uint8Array> = {},
): File {
  return new File(
    [
      zipSync({
        "manifest.json": strToU8(JSON.stringify(manifest)),
        ...entries,
      }),
    ],
    "project.supercanvas",
  );
}

describe("project transfer", () => {
  it("packages and remaps mask/source references without rewriting ordinary parameters", async () => {
    const source = structuredClone(graph);
    source.nodes[1]!.data.parameters = { maskAssetId: "mask-old", maskSourceAssetId: "asset-old", prompt: "mask-old" };
    source.nodes[1]!.data.generatedParameters = { maskAssetId: "history-mask", maskSourceAssetId: "history-source" };
    source.nodes[1]!.data.generatedDetails = { imageMask: { maskAssetId: "details-mask", maskSourceAssetId: "details-source" },
      inputAssetIds: ["details-source", "details-mask"], inputAssets: [
        { id: "details-source", role: "reference" }, { id: "details-mask", role: "mask", name: "details-mask" },
      ] };
    expect(collectReferencedAssetIds(source)).toEqual(["asset-old", "details-mask", "details-source", "generated-old", "history-mask", "history-source", "mask-old"]);
    const bytes = new Uint8Array([1, 2, 3]);
    const packageBlob = await createPortableProjectPackage({ title: "局部编辑", graph: source,
      assets: collectReferencedAssetIds(source).map(id => asset(id, bytes)), fetchAsset: async () => new Response(bytes) });
    const prepared = await prepareProjectImport({ file: new File([packageBlob], "mask.supercanvas"),
      fallbackTitle: "mask", fallbackViewport: graph.viewport, availableAssetIds: new Set() });
    expect(prepared.packageAssets.map(asset => asset.id).sort()).toEqual(collectReferencedAssetIds(source));
    const restored = await uploadPreparedPackageAssets({ prepared, upload: async file => asset(`new-${file.name.replace(/\.png$/u, "")}`, bytes) });
    expect(restored.graph.nodes[1]!.data.parameters).toEqual({ maskAssetId: "new-mask-old", maskSourceAssetId: "new-asset-old", prompt: "mask-old" });
    expect(restored.graph.nodes[1]!.data.generatedParameters).toEqual({ maskAssetId: "new-history-mask", maskSourceAssetId: "new-history-source" });
    expect(restored.graph.nodes[1]!.data.generatedDetails).toEqual({ imageMask: { maskAssetId: "new-details-mask", maskSourceAssetId: "new-details-source" },
      inputAssetIds: ["new-details-source", "new-details-mask"], inputAssets: [
        { id: "new-details-source", role: "reference" }, { id: "new-details-mask", role: "mask", name: "details-mask" },
      ] });
    expect(source.nodes[1]!.data.parameters.maskAssetId).toBe("mask-old");
  });
  it("carries review state and remaps edit ancestry while accepting old packages", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const sourceGraph = structuredClone(graph);
    sourceGraph.nodes[1]!.data.designSourceAssetId = "asset-old";
    const original = asset("asset-old", bytes);
    const generated = {
      ...asset("generated-old", bytes),
      metadata: {
        runId: "old-run",
        imageDesignReview: {
          status: "approved",
          note: "保留第二版日期",
          revision: 3,
          updatedAt: "2026-09-27T00:00:00Z",
        },
      },
    };
    const blob = await createPortableProjectPackage({
      title: "设计迁移",
      graph: sourceGraph,
      assets: [original, generated],
      fetchAsset: async () => new Response(bytes),
    });
    const prepared = await prepareProjectImport({
      file: new File([blob], "design.supercanvas"),
      fallbackTitle: "导入",
      fallbackViewport: graph.viewport,
      availableAssetIds: new Set(),
    });
    expect(
      prepared.packageAssets.find((value) => value.id === "generated-old")
        ?.imageDesignReview,
    ).toEqual({ status: "approved", note: "保留第二版日期" });
    const upload = vi.fn(async (file: File, review?: unknown) => {
      void review;
      return asset(`new-${file.name}`, bytes);
    });
    const restored = await uploadPreparedPackageAssets({ prepared, upload });
    expect(upload.mock.calls[1]?.[1]).toEqual({
      status: "approved",
      note: "保留第二版日期",
    });
    expect(restored.graph.nodes[1]!.data.designSourceAssetId).toBe(
      "new-asset-old.png",
    );
    const legacy = await prepareProjectImport({
      file: packageFile({
        ...packageManifest({
          schemaVersion: 1,
          nodes: [],
          edges: [],
          viewport: graph.viewport,
        }),
        version: 1,
      }),
      fallbackTitle: "旧项目",
      fallbackViewport: graph.viewport,
      availableAssetIds: new Set(),
    });
    expect(legacy.source).toBe("package");
  });
  it("keeps customer image transcripts bound to imported assets without rewriting customer text", () => {
    const source = structuredClone(graph);
    source.nodes[1]!.data!.graphicDesignBrief = {
      customerText: "  客户原文：asset-old\n活动条款不可删减。  ",
      customerImageAssetIds: ["customer-old"],
      customerImages: [
        {
          assetId: "customer-old",
          text: "图片文字：customer-old",
          warnings: [],
        },
      ],
      references: [{ assetId: "logo-old", role: "logo" }],
      customerConfirmed: true,
    };
    expect(collectReferencedAssetIds(source)).toEqual([
      "asset-old",
      "customer-old",
      "generated-old",
      "logo-old",
    ]);
    const remapped = remapGraphAssetIds(
      source,
      new Map([
        ["customer-old", "customer-new"],
        ["logo-old", "logo-new"],
      ]),
    );
    expect(remapped.nodes[1]!.data!.graphicDesignBrief).toEqual({
      customerText: "  客户原文：asset-old\n活动条款不可删减。  ",
      customerImageAssetIds: ["customer-new"],
      customerImages: [
        {
          assetId: "customer-new",
          text: "图片文字：customer-old",
          warnings: [],
        },
      ],
      references: [{ assetId: "logo-new", role: "logo" }],
      customerConfirmed: true,
    });
    expect(source.nodes[1]!.data!.graphicDesignBrief).toMatchObject({
      customerImageAssetIds: ["customer-old"],
    });
  });

  it("collects and remaps every durable graph asset reference", () => {
    expect(collectReferencedAssetIds(graph)).toEqual([
      "asset-old",
      "generated-old",
    ]);
    const remapped = remapGraphAssetIds(
      graph,
      new Map([
        ["asset-old", "asset-new"],
        ["generated-old", "generated-new"],
      ]),
    );
    expect(remapped.nodes[0]?.data?.assetId).toBe("asset-new");
    expect(remapped.nodes[1]?.data?.parts).toContainEqual({
      type: "asset",
      assetId: "asset-new",
      role: "reference",
    });
    expect(remapped.nodes[1]?.data?.lastOutputAssetIds).toEqual([
      "generated-new",
    ]);
    expect(remapped.nodes[1]?.data?.materializedOutputAssetIds).toEqual([
      "generated-new",
    ]);
    expect(remapped.nodes[1]?.data?.generatedPromptParts).toEqual([
      { type: "asset", assetId: "asset-new", role: "reference" },
    ]);
  });

  it("preflights legacy JSON and reports references missing locally", async () => {
    const prepared = await prepareProjectImport({
      file: new File(
        [JSON.stringify({ title: " 导入项目 ", graph })],
        "project.canvas.json",
        { type: "application/json" },
      ),
      fallbackTitle: "当前项目",
      fallbackViewport: graph.viewport,
      availableAssetIds: new Set(["asset-old"]),
    });
    expect(prepared.source).toBe("json");
    expect(prepared.title).toBe("导入项目");
    expect(prepared.missingAssetIds).toEqual(["generated-old"]);
  });

  it("round-trips a portable package and remaps uploaded asset ids", async () => {
    const assetBytes = new Uint8Array([137, 80, 78, 71]);
    const generatedBytes = new Uint8Array([137, 80, 78, 71, 1]);
    const views = [
      asset("asset-old", assetBytes, "参考.png"),
      asset("generated-old", generatedBytes, "结果.png"),
    ];
    const byId = new Map([
      ["asset-old", assetBytes],
      ["generated-old", generatedBytes],
    ]);
    const blob = await createPortableProjectPackage({
      title: "完整项目",
      graph,
      assets: views,
      fetchAsset: vi.fn(async (id: string) => new Response(byId.get(id)!)),
    });
    const prepared = await prepareProjectImport({
      file: new File([blob], "完整项目.supercanvas", { type: blob.type }),
      fallbackTitle: "当前项目",
      fallbackViewport: graph.viewport,
      availableAssetIds: new Set(),
    });
    expect(prepared.source).toBe("package");
    expect(prepared.packageAssets.map((item) => item.id)).toEqual([
      "asset-old",
      "generated-old",
    ]);
    expect(prepared.missingAssetIds).toEqual([]);

    let sequence = 0;
    const upload = vi.fn(async (file: File) => ({
      ...views[sequence],
      id: `imported-${sequence++}`,
      name: file.name,
      size: file.size,
    }));
    const materialized = await uploadPreparedPackageAssets({
      prepared,
      upload,
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(materialized.graph.nodes[0]?.data?.assetId).toBe("imported-0");
    expect(materialized.graph.nodes[1]?.data?.lastOutputAssetIds).toEqual([
      "imported-1",
    ]);
  });

  it.each(["../manifest.json", "C:/manifest.json", "assets\\escape.bin"])(
    "rejects unsafe archive path %s before extracting it",
    async (path) => {
      const unsafe = zipSync({ [path]: strToU8("{}") });
      await expect(
        prepareProjectImport({
          file: new File([unsafe], "unsafe.supercanvas"),
          fallbackTitle: "当前项目",
          fallbackViewport: graph.viewport,
          availableAssetIds: new Set(),
        }),
      ).rejects.toThrow("不安全的文件路径");
    },
  );

  it("rejects excessive entry counts and suspicious compression ratios", async () => {
    const tooManyEntries: Record<string, Uint8Array> = {
      "manifest.json": strToU8("{}"),
    };
    for (let index = 0; index < 1_001; index += 1) {
      tooManyEntries[`assets/${index}.bin`] = new Uint8Array();
    }
    await expect(
      prepareProjectImport({
        file: new File([zipSync(tooManyEntries)], "many.supercanvas"),
        fallbackTitle: "当前项目",
        fallbackViewport: graph.viewport,
        availableAssetIds: new Set(),
      }),
    ).rejects.toThrow("文件数量过多");

    const compressedBomb = zipSync(
      { "manifest.json": strToU8(" ".repeat(2 * 1024 * 1024)) },
      { level: 9 },
    );
    await expect(
      prepareProjectImport({
        file: new File([compressedBomb], "bomb.supercanvas"),
        fallbackTitle: "当前项目",
        fallbackViewport: graph.viewport,
        availableAssetIds: new Set(),
      }),
    ).rejects.toThrow("异常压缩比");
  });

  it("validates package versions, graph versions, and JSON wrapper versions", async () => {
    const emptyGraph = {
      schemaVersion: 1,
      nodes: [],
      edges: [],
      drawings: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    await expect(
      prepareProjectImport({
        file: packageFile({ ...packageManifest(emptyGraph), version: 999 }),
        fallbackTitle: "当前项目",
        fallbackViewport: graph.viewport,
        availableAssetIds: new Set(),
      }),
    ).rejects.toThrow("完整项目包版本");
    await expect(
      prepareProjectImport({
        file: packageFile(packageManifest({ ...emptyGraph, schemaVersion: 2 })),
        fallbackTitle: "当前项目",
        fallbackViewport: graph.viewport,
        availableAssetIds: new Set(),
      }),
    ).rejects.toThrow("schemaVersion");
    await expect(
      prepareProjectImport({
        file: new File(
          [
            JSON.stringify({
              format: PROJECT_JSON_FORMAT,
              version: 2,
              graph: emptyGraph,
            }),
          ],
          "future.canvas.json",
        ),
        fallbackTitle: "当前项目",
        fallbackViewport: graph.viewport,
        availableAssetIds: new Set(),
      }),
    ).rejects.toThrow("项目文件版本");
    await expect(
      prepareProjectImport({
        file: new File(
          [JSON.stringify({ graph: { ...emptyGraph, schemaVersion: null } })],
          "invalid.canvas.json",
        ),
        fallbackTitle: "当前项目",
        fallbackViewport: graph.viewport,
        availableAssetIds: new Set(),
      }),
    ).rejects.toThrow("schemaVersion");
  });

  it("enforces graph complexity limits before semantic validation", async () => {
    const oversizedPorts = Array.from({ length: 129 }, (_, index) => ({
      id: `port-${index}`,
      kind: "image" as const,
      label: `端口 ${index}`,
    }));
    await expect(
      prepareProjectImport({
        file: new File(
          [
            JSON.stringify({
              graph: {
                schemaVersion: 1,
                nodes: [
                  {
                    id: "too-many-ports",
                    type: "workflow",
                    data: { inputs: oversizedPorts },
                  },
                ],
                edges: [],
                viewport: { x: 0, y: 0, zoom: 1 },
              },
            }),
          ],
          "large.canvas.json",
        ),
        fallbackTitle: "当前项目",
        fallbackViewport: graph.viewport,
        availableAssetIds: new Set(),
      }),
    ).rejects.toThrow("端口数量超过 128");
  });

  it("requires declared assets to be referenced and stored at one assets level", async () => {
    const oneAssetGraph = { ...graph, nodes: [graph.nodes[0]], edges: [] };
    const descriptor = {
      id: "asset-old",
      name: "参考.png",
      kind: "image",
      mimeType: "image/png",
      size: 1,
      path: "assets/nested/reference.png",
    };
    await expect(
      prepareProjectImport({
        file: packageFile(packageManifest(oneAssetGraph, [descriptor]), {
          [descriptor.path]: new Uint8Array([1]),
        }),
        fallbackTitle: "当前项目",
        fallbackViewport: graph.viewport,
        availableAssetIds: new Set(),
      }),
    ).rejects.toThrow("assets 目录的第一层");

    const emptyGraph = {
      schemaVersion: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const unused = { ...descriptor, path: "assets/reference.png" };
    await expect(
      prepareProjectImport({
        file: packageFile(packageManifest(emptyGraph, [unused]), {
          [unused.path]: new Uint8Array([1]),
        }),
        fallbackTitle: "当前项目",
        fallbackViewport: graph.viewport,
        availableAssetIds: new Set(),
      }),
    ).rejects.toThrow("未被画布引用的素材");
  });

  it("falls back to chunked Blob reads when File.stream is unavailable", async () => {
    const emptyGraph = {
      schemaVersion: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const file = packageFile(packageManifest(emptyGraph));
    Object.defineProperty(file, "stream", { value: undefined });
    const prepared = await prepareProjectImport({
      file,
      fallbackTitle: "当前项目",
      fallbackViewport: graph.viewport,
      availableAssetIds: new Set(),
    });
    expect(prepared.source).toBe("package");
    expect(prepared.graph.nodes).toEqual([]);
  });

  it("reports partial uploads so the caller can roll them back", async () => {
    const assetBytes = new Uint8Array([137, 80, 78, 71]);
    const generatedBytes = new Uint8Array([137, 80, 78, 71, 1]);
    const views = [
      asset("asset-old", assetBytes, "参考.png"),
      asset("generated-old", generatedBytes, "结果.png"),
    ];
    const byId = new Map([
      ["asset-old", assetBytes],
      ["generated-old", generatedBytes],
    ]);
    const blob = await createPortableProjectPackage({
      title: "完整项目",
      graph,
      assets: views,
      fetchAsset: async (id) => new Response(byId.get(id)!),
    });
    const prepared = await prepareProjectImport({
      file: new File([blob], "完整项目.supercanvas", { type: blob.type }),
      fallbackTitle: "当前项目",
      fallbackViewport: graph.viewport,
      availableAssetIds: new Set(),
    });
    let call = 0;
    const upload = vi.fn(async (file: File): Promise<AssetView> => {
      if (call++ > 0) throw new Error("上传连接中断");
      return {
        ...views[0]!,
        id: "imported-first",
        name: file.name,
        size: file.size,
      };
    });

    let caught: unknown;
    try {
      await uploadPreparedPackageAssets({ prepared, upload });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProjectAssetUploadError);
    expect(caught).toMatchObject({
      message: "上传连接中断",
      failedAsset: { id: "generated-old" },
      uploadedAssets: [{ id: "imported-first" }],
    });
  });

  it("explains why referenced text assets cannot be packaged", async () => {
    const oneAssetGraph = { ...graph, nodes: [graph.nodes[0]], edges: [] };
    await expect(
      createPortableProjectPackage({
        title: "文本素材项目",
        graph: oneAssetGraph,
        assets: [
          {
            ...asset("asset-old", new Uint8Array([1]), "说明.txt"),
            kind: "text",
            mimeType: "text/plain",
          },
        ],
      }),
    ).rejects.toThrow("上传接口仅支持图片、视频和音频");
  });
});
