import { idleCatalogCheckFixture } from "./helpers/catalog-check-fixture";
import { expect, test } from "@playwright/test";
import type { AgentPlan, AgentSession } from "../lib/agent-contracts";
import type { AssetView, CanvasDocument } from "../components/types";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("素材上传未完成时拒绝智能体放入，导入保存并刷新方案后可重试且保留素材", async ({ page, baseURL }) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const origin = new URL(baseURL ?? "http://127.0.0.1:3211").origin;
  const canvasId = "agent-held-import";
  const now = "2026-10-15T00:00:00.000Z";
  const canvas: { id: string; title: string; revision: number; graph: CanvasDocument } = {
    id: canvasId, title: "在途导入与智能体隔离回归", revision: 1,
    graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 0.7 }, edges: [], drawings: [], nodes: [{
      id: "existing-prompt", type: "workflow", position: { x: 64, y: 64 }, style: { width: 320, height: 200 },
      data: { nodeType: "prompt", label: "原提示词", parts: [{ type: "text", text: "导入前已有的文本" }],
        inputs: [], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] },
    }] },
  };
  let plan: AgentPlan = {
    id: "held-import-plan", sessionId: "held-import-task", canvasId, version: 1,
    status: "awaiting_approval", summary: "放入一个本地文字成果", baseCanvasRevision: 1,
    proposal: { type: "proposal", summary: "放入一个本地文字成果", assumptions: [], calls: [],
      texts: [{ id: "held-import-text", title: "Agent 新文本", content: "只放入文字，不生成素材" }] },
    calls: [], patch: { nodes: [], edges: [], generationNodeIds: [], touchedExistingNodeIds: [] },
  };
  const session: AgentSession = { id: plan.sessionId, canvasId, title: "已有待确认方案", messages: [], plans: [plan] };
  const asset: AssetView = { id: "held-import-image", name: "held-import.png", kind: "image", mimeType: "image/png",
    storageKey: "isolated-test/held-import.png", size: png.length, metadata: { source: "upload" }, createdAt: now };
  const uploadedAssets: AssetView[] = [];
  const counts = { external: 0, paid: 0, upload: 0, materialize: 0, refresh: 0, saves: 0, unexpectedMutations: 0 };
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let uploadHeld = false;
  let releaseUpload: () => void = () => undefined;
  const uploadGate = new Promise<void>(resolve => { releaseUpload = resolve; });
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin && !["data:", "blob:", "about:"].includes(url.protocol)) {
      counts.external++; return route.abort("blockedbyclient");
    }
    const path = url.pathname, method = request.method();
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/projects") return route.fulfill({ json: { projects: [{
      id: canvasId, title: canvas.title, nodeCount: canvas.graph.nodes.length, createdAt: now, updatedAt: now,
    }] } });
    if (path === `/api/canvas/${canvasId}`) {
      if (method === "PUT") {
        const body = request.postDataJSON() as { graph: CanvasDocument; title?: string; expectedRevision?: number };
        expect(body.expectedRevision).toBe(canvas.revision);
        counts.saves++; canvas.graph = body.graph; canvas.title = body.title ?? canvas.title; canvas.revision++;
      }
      return route.fulfill({ json: canvas });
    }
    if (path === "/api/assets/upload" && method === "POST") {
      counts.upload++; uploadHeld = true;
      await uploadGate;
      uploadedAssets.push(asset);
      return route.fulfill({ status: 201, json: { ...asset, url: `/api/assets/${asset.id}/content` } });
    }
    if (path === "/api/assets") return route.fulfill({ json: uploadedAssets });
    if (path === `/api/assets/${asset.id}`) return route.fulfill({ json: { ...asset, actualDimensions: { width: 1, height: 1 } } });
    if (path.startsWith(`/api/assets/${asset.id}/`)) return route.fulfill({ contentType: "image/png", body: png });
    if (path === `/api/projects/${canvasId}/archive`) return route.fulfill({ json: { archivedAssetIds: [asset.id] } });
    if (path === "/api/agent/sessions") return route.fulfill({ json: [{ id: session.id, title: session.title }] });
    if (path === `/api/agent/sessions/${session.id}`) return route.fulfill({ json: session });
    if (path === `/api/agent/plans/${plan.id}` && method === "PATCH") {
      expect(request.postDataJSON()).toMatchObject({ version: plan.version });
      counts.refresh++;
      // Match the existing refresh workflow: imports change the canvas revision,
      // so the user refreshes the proposal before approving the new snapshot.
      plan = { ...plan, version: plan.version + 1, baseCanvasRevision: canvas.revision };
      session.plans = [plan];
      return route.fulfill({ json: plan });
    }
    if (path === `/api/agent/plans/${plan.id}/materialize`) {
      counts.materialize++;
      expect(request.postDataJSON()).toMatchObject({ version: plan.version, canvasRevision: canvas.revision });
      if (plan.baseCanvasRevision !== canvas.revision) return route.fulfill({ status: 409, json: { error: "画布已改变，请刷新方案后重新确认" } });
      canvas.graph = { ...canvas.graph, nodes: [...canvas.graph.nodes, {
        id: "agent-after-import", type: "workflow", position: { x: 624, y: 64 }, style: { width: 320, height: 200 },
        data: { nodeType: "prompt", label: "Agent 新文本", parts: [{ type: "text", text: "只放入文字，不生成素材" }],
          inputs: [], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] },
      }] };
      canvas.revision++; plan = { ...plan, status: "succeeded" }; session.plans = [plan];
      return route.fulfill({ json: { plan, canvas } });
    }
    if (path === "/api/suppliers/catalog-upgrade") return route.fulfill({ json: idleCatalogCheckFixture() });
    if (path === "/api/runs" && method !== "GET" || path === "/api/agent/turn" || /\/api\/agent\/plans\/[^/]+\/(execute|preflight)$/.test(path)) {
      counts.paid++; return route.abort("blockedbyclient");
    }
    if (method !== "GET" && method !== "HEAD") { counts.unexpectedMutations++; return route.abort("blockedbyclient"); }
    if (["/api/providers", "/api/suppliers", "/api/runs", "/api/agent/models"].includes(path) || path.includes("/models")) return route.fulfill({ json: [] });
    if (path.includes("/chat")) return route.fulfill({ json: { messages: [] } });
    return route.fulfill({ json: { groups: [], items: [], runs: [], drops: [] } });
  });

  try {
    await page.goto(`/canvas/${canvasId}`);
    await expect(page.locator('.react-flow__node[data-id="existing-prompt"]')).toBeVisible();
    await page.evaluate(encoded => {
      const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));
      const clipboardData = new DataTransfer();
      clipboardData.items.add(new File([bytes], "held-import.png", { type: "image/png" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    }, png.toString("base64"));
    await expect.poll(() => uploadHeld).toBe(true);
    const pending = page.locator('.react-flow__node[data-id^="pending-import-"]');
    await expect(pending).toHaveCount(1);
    const importedNodeId = (await pending.getAttribute("data-id"))!;
    await page.getByRole("button", { name: "打开智能体", exact: true }).click();
    const approve = page.getByRole("button", { name: "放入画布", exact: true });
    await approve.click();
    await expect(page.getByRole("alert").filter({ hasText: "素材仍在导入，请等待导入完成后重试" })).toBeVisible();
    expect(counts.materialize).toBe(0);
    await expect(page.locator(".canvas-editor")).not.toHaveAttribute("inert");
    await expect(pending).toHaveCount(1);
    await expect(approve).toBeEnabled();

    releaseUpload();
    await expect.poll(() => canvas.graph.nodes.some(node => node.id === importedNodeId && node.data.assetId === asset.id)).toBe(true);
    expect(counts.saves).toBeGreaterThan(0);
    await expect(page.locator(`.react-flow__node[data-id="${importedNodeId}"] img`)).toBeVisible();
    // Keep the real revision boundary: a refreshed plan, rather than silently
    // accepting its old base revision, is what can now be safely materialized.
    await page.getByRole("button", { name: "检查方案与模型", exact: true }).click();
    await expect.poll(() => counts.refresh).toBe(1);
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect(page.locator('.react-flow__node[data-id="agent-after-import"]')).toBeVisible();
    await expect(page.locator(`.react-flow__node[data-id="${importedNodeId}"] img`)).toBeVisible();
    expect(canvas.graph.nodes.some(node => node.id === importedNodeId && node.data.assetId === asset.id)).toBe(true);
    expect(canvas.graph.nodes.some(node => node.id === "existing-prompt")).toBe(true);
    expect(counts).toMatchObject({ external: 0, paid: 0, upload: 1, materialize: 1, refresh: 1, unexpectedMutations: 0 });
    expect(errors).toEqual([]);
  } finally {
    releaseUpload();
  }
});
