import { randomUUID } from "node:crypto";
import {
  expect,
  test as base,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

type NodeRecord = {
  id: string;
  type: string;
  position: { x: number; y: number };
  style?: { width: number; height: number };
  data: Record<string, unknown>;
};
type EdgeRecord = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: string;
  data?: Record<string, unknown>;
};
type Graph = { nodes: NodeRecord[]; edges: EdgeRecord[] };
type CopyCanvas = {
  id: string;
  submissions: { runs: number; assetUploads: number };
};

const referenceAssets = [
  { id: "copy-image-one", name: "角色一.png", kind: "image", mimeType: "image/png" },
  { id: "copy-image-two", name: "角色二.png", kind: "image", mimeType: "image/png" },
  { id: "copy-reference-video", name: "动作参考.mp4", kind: "video", mimeType: "video/mp4" },
  { id: "copy-reference-audio", name: "声音参考.wav", kind: "audio", mimeType: "audio/wav" },
  { id: "copy-old-video", name: "历史结果.mp4", kind: "video", mimeType: "video/mp4" },
].map((asset) => ({
  ...asset,
  size: 1,
  storageKey: `copy-fixture/${asset.id}`,
  metadata: {},
  createdAt: "2026-10-10T00:00:00.000Z",
}));

function materialGraph(): Graph & {
  schemaVersion: number;
  viewport: { x: number; y: number; zoom: number };
} {
  const materialNodes: NodeRecord[] = referenceAssets.slice(0, 4).map((asset, index) => ({
    id: `material-${index}`,
    type: "workflow",
    position: { x: 40, y: 80 + index * 220 },
    style: { width: 240, height: 180 },
    data: {
      nodeType: "asset-input", label: asset.name,
      assetId: asset.id, assetKind: asset.kind,
      inputs: [], outputs: [{ id: "asset", kind: asset.kind, label: "素材" }],
    },
  }));
  return {
    schemaVersion: 1,
    viewport: { x: 12, y: 25, zoom: 0.72 },
    nodes: [
      ...materialNodes,
      {
        id: "source-prompt", type: "workflow", position: { x: 310, y: 610 },
        style: { width: 220, height: 180 },
        data: {
          nodeType: "prompt", label: "镜头说明",
          parts: [{ type: "text", text: "保持角色与动作一致" }], inputs: [],
          outputs: [{ id: "prompt", kind: "text", label: "提示词" }],
        },
      },
      {
        id: "video-source", type: "workflow", position: { x: 580, y: 150 },
        style: { width: 440, height: 360 },
        data: {
          nodeType: "video-generation", label: "带素材的视频",
          provider: "fake", connectionId: "fake-default", model: "fake-video-v1",
          parameters: { duration: 7, ratio: "720:1280" },
          parts: [
            { type: "text", text: "角色二沿着海边向前走，" },
            { type: "asset", assetId: "copy-image-two", role: "reference" },
            { type: "text", text: "保留声音参考。" },
          ],
          inputs: [
            { id: "prompt", kind: "text", label: "Prompt" },
            { id: "references", kind: "image[]", label: "参考图", multiple: true },
            { id: "referenceVideos", kind: "video[]", label: "参考视频", multiple: true },
            { id: "referenceAudios", kind: "audio[]", label: "参考音频", multiple: true },
          ],
          outputs: [{ id: "video", kind: "video", label: "视频" }],
        },
      },
      {
        id: "old-result", type: "workflow", position: { x: 1080, y: 150 },
        style: { width: 280, height: 220 },
        data: {
          nodeType: "asset-input", label: "原有生成结果", assetId: "copy-old-video", assetKind: "video",
          generatedResult: true, generatedStatus: "succeeded", generatedFromNodeId: "video-source",
          generatedFromRunId: "copy-fixture-historical-run", generatedOutputIndex: 0,
          inputs: [{ id: "generated", kind: "video", label: "生成来源" }],
          outputs: [{ id: "asset", kind: "video", label: "视频" }],
        },
      },
      {
        id: "downstream", type: "workflow", position: { x: 1080, y: 460 },
        style: { width: 280, height: 180 },
        data: {
          nodeType: "preview", label: "下游预览",
          inputs: [{ id: "video", kind: "video", label: "视频" }], outputs: [],
        },
      },
    ],
    // The deliberately mixed order is what the reference strip must retain.
    edges: [
      { id: "in-image-two", source: "material-1", sourceHandle: "asset", target: "video-source", targetHandle: "references", type: "smoothstep", data: { referenceOrder: 8, role: "reference", detail: { slot: "second" } } },
      { id: "in-audio", source: "material-3", sourceHandle: "asset", target: "video-source", targetHandle: "referenceAudios", type: "smoothstep", data: { referenceOrder: 4, role: "reference" } },
      { id: "in-prompt", source: "source-prompt", sourceHandle: "prompt", target: "video-source", targetHandle: "prompt", type: "smoothstep", data: { referenceOrder: 0 } },
      { id: "in-image-one", source: "material-0", sourceHandle: "asset", target: "video-source", targetHandle: "references", type: "smoothstep", data: { referenceOrder: 2, role: "reference" } },
      { id: "in-video", source: "material-2", sourceHandle: "asset", target: "video-source", targetHandle: "referenceVideos", type: "smoothstep", data: { referenceOrder: 3, role: "reference" } },
      { id: "out-preview", source: "video-source", sourceHandle: "video", target: "downstream", targetHandle: "video", type: "smoothstep" },
      { id: "edge-generated-old-result", source: "video-source", sourceHandle: "video", target: "old-result", targetHandle: "generated", type: "smoothstep" },
    ],
  };
}

const test = base.extend<{ copyCanvas: CopyCanvas }>({
  copyCanvas: async ({ page, request }, yieldCanvas) => {
    await page.setViewportSize({ width: 1600, height: 1050 });
    const submissions = { runs: 0, assetUploads: 0 };
    await page.route(/\/api\/runs(?:\?|\/|$)/u, async (route) => {
      if (route.request().method() !== "GET") {
        submissions.runs++;
        return route.abort();
      }
      return route.fulfill({ json: [] });
    });
    await page.route(/\/api\/assets(?:\?.*)?$/u, (route) => route.fulfill({ json: referenceAssets }));
    await page.route("**/api/assets/upload**", (route) => {
      submissions.assetUploads++;
      return route.abort();
    });
    // Metadata fixtures represent existing materials; no media is generated or uploaded.
    await page.route(/\/api\/assets\/copy-[^/]+\/(?:preview|content)(?:\?.*)?$/u, (route) =>
      route.fulfill({ status: 404, json: { error: "fixture has metadata only" } }));
    const id = `copy-materials-${randomUUID()}`;
    const created = await request.post("/api/canvas", {
      data: { id, title: "复制包含素材回归", graph: materialGraph() },
    });
    expect(created.status()).toBe(201);
    try {
      await page.goto(`/canvas/${id}`);
      await expect(page.locator('.react-flow__node[data-id="video-source"]')).toBeVisible();
      const inspector = page.getByRole("button", { name: "智能体面板", exact: true });
      if (await inspector.getAttribute("aria-expanded") === "true") await inspector.click();
      await yieldCanvas({ id, submissions });
      expect(submissions).toEqual({ runs: 0, assetUploads: 0 });
    } finally {
      await page.close();
      const deleted = await request.delete(`/api/projects/${id}`);
      expect(deleted.ok()).toBeTruthy();
    }
  },
});

async function savedGraph(request: APIRequestContext, id: string): Promise<Graph> {
  const response = await request.get(`/api/canvas/${id}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).graph as Graph;
}

function incomingSignature(edge: EdgeRecord) {
  return {
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: edge.type,
    data: edge.data,
  };
}

async function copyWithMaterials(page: Page, nodeId = "video-source", label = "带素材的视频") {
  const node = page.locator(`.react-flow__node[data-id="${nodeId}"]`);
  const title = node.locator(".node-title:visible");
  if (await title.count()) await title.click({ button: "right" });
  else await node.locator(".node-card").click({ button: "right", position: { x: 12, y: 12 } });
  const menu = page.getByRole("menu", { name: `${label} 的操作`, exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "复制（包含素材）", exact: true }).click();
  await expect(menu).toBeHidden();
}

async function waitForCopy(request: APIRequestContext, canvasId: string, originalIds: Set<string>) {
  await expect.poll(async () => (await savedGraph(request, canvasId)).nodes.filter((node) => !originalIds.has(node.id)).length).toBe(1);
  const graph = await savedGraph(request, canvasId);
  return { graph, copy: graph.nodes.find((node) => !originalIds.has(node.id))! };
}

test("复制包含素材保留原素材、提示词及端口顺序，保存重载后仍连到同一素材", async ({ page, request, copyCanvas }) => {
  const source = page.locator('.react-flow__node[data-id="video-source"]');
  const referenceNames = ["角色二.png", "声音参考.wav", "角色一.png", "动作参考.mp4"];
  await expect(source.locator(".node-linked-asset small")).toHaveText(referenceNames);
  const before = await savedGraph(request, copyCanvas.id);
  const originalIds = new Set(before.nodes.map((node) => node.id));
  const originalSource = before.nodes.find((node) => node.id === "video-source")!;
  const incoming = before.edges.filter((edge) => edge.target === "video-source");
  expect(incoming).toHaveLength(5);

  await copyWithMaterials(page);
  const { graph: copied, copy } = await waitForCopy(request, copyCanvas.id, originalIds);
  expect(copied.nodes).toHaveLength(before.nodes.length + 1);
  expect(copied.edges).toHaveLength(before.edges.length + incoming.length);
  expect(copy.data).toMatchObject({
    nodeType: "video-generation", label: "带素材的视频", provider: "fake", connectionId: "fake-default",
    model: "fake-video-v1", parameters: { duration: 7, ratio: "720:1280" }, parts: originalSource.data.parts,
    inputs: originalSource.data.inputs, outputs: originalSource.data.outputs,
  });
  expect(copy.position).not.toEqual(originalSource.position);
  expect(copied.nodes.filter((node) => node.id.startsWith("material-")).map((node) => [node.id, node.data.assetId]))
    .toEqual(before.nodes.filter((node) => node.id.startsWith("material-")).map((node) => [node.id, node.data.assetId]));
  const copiedEdges = copied.edges.filter((edge) => edge.target === copy.id);
  expect(copiedEdges.map(incomingSignature)).toEqual(incoming.map(incomingSignature));
  expect(new Set(copied.edges.map((edge) => edge.id)).size).toBe(copied.edges.length);
  expect(copiedEdges.every((edge) => !before.edges.some((original) => original.id === edge.id))).toBe(true);
  expect(copied.edges.filter((edge) => edge.source === copy.id)).toEqual([]);
  for (const original of before.edges) {
    expect(copied.edges.find((edge) => edge.id === original.id)).toMatchObject(original);
  }
  expect(copied.nodes.find((node) => node.id === "video-source")?.data).toEqual(originalSource.data);
  expect(copied.nodes.find((node) => node.id === "old-result")?.data).toEqual(before.nodes.find((node) => node.id === "old-result")?.data);
  await expect(page.locator(`.react-flow__node[data-id="${copy.id}"] .node-linked-asset small`)).toHaveText(referenceNames);

  await page.reload();
  await expect(page.locator(`.react-flow__node[data-id="${copy.id}"]`)).toBeVisible();
  await expect(page.locator(`.react-flow__node[data-id="${copy.id}"] .node-linked-asset small`)).toHaveText(referenceNames);
  const reloaded = await savedGraph(request, copyCanvas.id);
  expect(reloaded.nodes.find((node) => node.id === copy.id)?.data).toEqual(copy.data);
  expect(reloaded.edges.filter((edge) => edge.target === copy.id).map(incomingSignature)).toEqual(incoming.map(incomingSignature));
  expect(reloaded.edges.filter((edge) => edge.source === copy.id)).toEqual([]);
});

test("多选时仅复制右键目标，一次撤销和重做同时恢复节点与所有素材线", async ({ page, request, copyCanvas }) => {
  const source = page.locator('.react-flow__node[data-id="video-source"]');
  const prompt = page.locator('.react-flow__node[data-id="source-prompt"]');
  await source.locator(".node-head").click();
  await prompt.locator(".node-head").click({ modifiers: ["Control"] });
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  const before = await savedGraph(request, copyCanvas.id);
  const originalIds = new Set(before.nodes.map((node) => node.id));
  const undo = page.getByRole("button", { name: "撤销", exact: true });
  const redo = page.getByRole("button", { name: "重做", exact: true });
  await expect(undo).toBeDisabled();

  await copyWithMaterials(page);
  const { graph: copied, copy } = await waitForCopy(request, copyCanvas.id, originalIds);
  expect(copy.data.nodeType).toBe("video-generation");
  expect(copied.nodes.filter((node) => node.data.nodeType === "prompt")).toHaveLength(1);
  expect(copied.edges.filter((edge) => edge.target === copy.id)).toHaveLength(5);
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(page.locator(`.react-flow__node[data-id="${copy.id}"]`)).toHaveCount(0);
  await expect.poll(async () => {
    const restored = await savedGraph(request, copyCanvas.id);
    return { nodes: restored.nodes.map((node) => node.id), edges: restored.edges.map((edge) => edge.id) };
  }).toEqual({ nodes: before.nodes.map((node) => node.id), edges: before.edges.map((edge) => edge.id) });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();

  await redo.click();
  await expect.poll(async () => {
    const restored = await savedGraph(request, copyCanvas.id);
    return { nodes: restored.nodes.map((node) => node.id), edges: restored.edges.map((edge) => edge.id) };
  }).toEqual({ nodes: copied.nodes.map((node) => node.id), edges: copied.edges.map((edge) => edge.id) });
  await expect(redo).toBeDisabled();
  expect((await savedGraph(request, copyCanvas.id)).edges.filter((edge) => edge.target === copy.id).map(incomingSignature))
    .toEqual(copied.edges.filter((edge) => edge.target === copy.id).map(incomingSignature));
});

test("编辑提示词后立即复制，一次撤销仅移除副本与新连线并保留原节点新文案", async ({ page, request, copyCanvas }) => {
  const before = await savedGraph(request, copyCanvas.id);
  const originalIds = new Set(before.nodes.map((node) => node.id));
  await page.locator('.react-flow__node[data-id="video-source"] .prompt-overview').click();
  const editor = page.getByRole("textbox", { name: "编辑 带素材的视频 提示词", exact: true });
  const freshText = "刚刚改好的镜头文案：角色一起朝镜头走来。";
  await editor.fill(freshText);
  // No autosave or editor-buffer wait: opening the menu must flush this edit.
  await copyWithMaterials(page);
  const { graph, copy } = await waitForCopy(request, copyCanvas.id, originalIds);
  const freshParts = [{ type: "text", text: freshText }];
  expect(graph.nodes.find((node) => node.id === "video-source")?.data.parts).toEqual(freshParts);
  expect(copy.data.parts).toEqual(freshParts);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(`.react-flow__node[data-id="${copy.id}"]`)).toHaveCount(0);
  await page.locator('.react-flow__node[data-id="video-source"] .prompt-overview').click();
  await expect(editor).toHaveText(freshText);
  await expect.poll(async () => {
    const restored = await savedGraph(request, copyCanvas.id);
    return {
      nodes: restored.nodes.map((node) => node.id),
      edges: restored.edges.map((edge) => edge.id),
      parts: restored.nodes.find((node) => node.id === "video-source")?.data.parts,
    };
  }).toEqual({ nodes: before.nodes.map((node) => node.id), edges: before.edges.map((edge) => edge.id), parts: freshParts });
});

test("历史生成结果复制为固定素材，不继承自动结果连线和任务身份", async ({ page, request, copyCanvas }) => {
  const before = await savedGraph(request, copyCanvas.id);
  const originalIds = new Set(before.nodes.map((node) => node.id));
  await copyWithMaterials(page, "old-result", "原有生成结果");
  const { graph, copy } = await waitForCopy(request, copyCanvas.id, originalIds);
  expect(copy.data).toMatchObject({ nodeType: "asset-input", assetKind: "video", assetId: "copy-old-video", label: "固定视频", inputs: [] });
  expect(Object.keys(copy.data).filter((key) => key.startsWith("generated"))).toEqual([]);
  expect(graph.edges.filter((edge) => edge.target === copy.id || edge.source === copy.id)).toEqual([]);
  expect(graph.edges.map((edge) => edge.id)).toEqual(before.edges.map((edge) => edge.id));
  expect(graph.nodes.find((node) => node.id === "old-result")?.data).toEqual(before.nodes.find((node) => node.id === "old-result")?.data);
  await page.reload();
  await expect(page.locator(`.react-flow__node[data-id="${copy.id}"] .node-title`)).toHaveText("固定视频");
  expect((await savedGraph(request, copyCanvas.id)).nodes.find((node) => node.id === copy.id)?.data).toEqual(copy.data);
});
