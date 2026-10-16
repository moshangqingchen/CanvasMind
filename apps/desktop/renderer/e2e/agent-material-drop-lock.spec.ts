import { expect, test } from "@playwright/test";
import type { AgentPlan, AgentSession } from "../lib/agent-contracts";
import type { AssetView, CanvasDocument } from "../components/types";
import type { MaterialDropEventView } from "../lib/client-api";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("智能体事务中到达的素材桥事件留在队列，响应应用后再导入且节点不丢失", async ({ page, baseURL }) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const origin = new URL(baseURL ?? "http://127.0.0.1:3211").origin;
  const now = "2026-10-15T00:00:00.000Z";
  const canvasId = "agent-material-drop-lock";
  const canvas: { id: string; title: string; revision: number; graph: CanvasDocument } = {
    id: canvasId, title: "智能体与素材桥隔离回归", revision: 1,
    graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 0.7 }, drawings: [], edges: [], nodes: [{
      id: "existing-prompt", type: "workflow", position: { x: 64, y: 64 }, style: { width: 320, height: 200 },
      data: { nodeType: "prompt", label: "原有提示词", parts: [{ type: "text", text: "保留原有内容" }],
        inputs: [], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] },
    }] },
  };
  const plan: AgentPlan = {
    id: "bridge-lock-plan", sessionId: "bridge-lock-task", canvasId, version: 1,
    status: "awaiting_approval", summary: "放入一个本地文字成果", baseCanvasRevision: 1,
    proposal: { type: "proposal", summary: "放入一个本地文字成果", assumptions: [], calls: [],
      texts: [{ id: "bridge-lock-text", title: "Agent 新文本", content: "仅放入文字，不生成素材" }] },
    calls: [], patch: { nodes: [], edges: [], generationNodeIds: [], touchedExistingNodeIds: [] },
  };
  const session: AgentSession = { id: plan.sessionId, canvasId, title: "已有待确认方案", messages: [], plans: [plan] };
  const drop: MaterialDropEventView = {
    id: "after-agent-drop", name: "after-agent.png", mimeType: "image/png", size: png.length,
    // Deliberately outside the window so the existing center fallback is used.
    screenX: -10_000, screenY: -10_000, previewAvailable: false, createdAt: now,
  };
  const asset: AssetView = { id: "after-agent-image", name: drop.name, kind: "image", mimeType: "image/png",
    storageKey: "isolated-test/after-agent.png", size: png.length, metadata: { source: "upload" }, createdAt: now };
  const counts = { external: 0, paid: 0, materialize: 0, polls: 0, claims: 0, discards: 0, saves: 0, uploads: 0, unexpectedMutations: 0 };
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let firstPollHeld = false;
  let agentRequestHeld = false;
  let dropAvailable = false;
  let claimed = false;
  let releasePoll: () => void = () => undefined;
  let releaseAgent: () => void = () => undefined;
  const pollGate = new Promise<void>(resolve => { releasePoll = resolve; });
  const agentGate = new Promise<void>(resolve => { releaseAgent = resolve; });
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
    if (path === "/api/integrations/material-drops") {
      if (method === "GET") {
        counts.polls++;
        if (counts.polls === 1) { firstPollHeld = true; await pollGate; }
        return route.fulfill({ json: dropAvailable && !claimed ? [drop] : [] });
      }
      if (method === "PATCH") {
        counts.claims++; expect(request.postDataJSON()).toEqual({ id: drop.id });
        claimed = true; return route.fulfill({ json: asset });
      }
      if (method === "DELETE") { counts.discards++; return route.fulfill({ json: { ok: true } }); }
    }
    if (path === "/api/agent/sessions") return route.fulfill({ json: [{ id: session.id, title: session.title }] });
    if (path === `/api/agent/sessions/${session.id}`) return route.fulfill({ json: session });
    if (path === `/api/agent/plans/${plan.id}/materialize`) {
      counts.materialize++;
      expect(request.postDataJSON()).toMatchObject({ version: 1, canvasRevision: canvas.revision });
      // Freeze the authoritative graph before a late bridge event arrives.
      const approvedGraph = structuredClone(canvas.graph);
      agentRequestHeld = true;
      await agentGate;
      canvas.graph = { ...approvedGraph, nodes: [...approvedGraph.nodes, {
        id: "agent-applied", type: "workflow", position: { x: 624, y: 64 }, style: { width: 320, height: 200 },
        data: { nodeType: "prompt", label: "Agent 新文本", parts: [{ type: "text", text: "仅放入文字" }],
          inputs: [], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] },
      }] };
      canvas.revision++; plan.status = "succeeded";
      return route.fulfill({ json: { plan, canvas } });
    }
    if (path === "/api/assets/upload") { counts.uploads++; return route.abort("blockedbyclient"); }
    if (path === "/api/assets") return route.fulfill({ json: claimed ? [asset] : [] });
    if (path === `/api/assets/${asset.id}`) return route.fulfill({ json: { ...asset, actualDimensions: { width: 1, height: 1 } } });
    if (path.startsWith(`/api/assets/${asset.id}/`)) return route.fulfill({ contentType: "image/png", body: png });
    if (path === `/api/projects/${canvasId}/archive`) return route.fulfill({ json: { archivedAssetIds: [asset.id] } });
    if (path === "/api/suppliers/catalog-upgrade") return route.fulfill({ json: { phase: "complete", updatedConnectionIds: [] } });
    if ((path === "/api/runs" && method !== "GET") || path === "/api/agent/turn" || /\/api\/agent\/plans\/[^/]+\/(execute|preflight)$/.test(path)) {
      counts.paid++; return route.abort("blockedbyclient");
    }
    if (method !== "GET" && method !== "HEAD") { counts.unexpectedMutations++; return route.abort("blockedbyclient"); }
    if (["/api/providers", "/api/suppliers", "/api/runs", "/api/agent/models"].includes(path) || path.includes("/models")) return route.fulfill({ json: [] });
    if (path.includes("/chat")) return route.fulfill({ json: { messages: [] } });
    return route.fulfill({ json: { groups: [], items: [], runs: [], drops: [] } });
  });

  try {
    await page.goto(`/canvas/${canvasId}`);
    await page.bringToFront();
    await expect(page.locator('.react-flow__node[data-id="existing-prompt"]')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => firstPollHeld).toBe(true);
    await page.getByRole("button", { name: "打开智能体", exact: true }).click();
    await page.getByRole("button", { name: "放入画布", exact: true }).click();
    await expect.poll(() => agentRequestHeld).toBe(true);
    await expect(page.locator(".canvas-editor")).toHaveAttribute("inert", "");
    dropAvailable = true;
    const firstPollResponse = page.waitForResponse(response => response.url().endsWith("/api/integrations/material-drops") && response.request().method() === "GET");
    releasePoll();
    await firstPollResponse;
    // Cover two real 750ms timer ticks as well as an explicit focus poll. The
    // in-flight response and later ticks must both respect the transaction.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(1_650);
    expect(counts).toMatchObject({ polls: 1, claims: 0, discards: 0 });
    await expect(page.locator(".react-flow__node")).toHaveCount(1);
    await expect(page.locator('[data-id="material-drop-after-agent-drop"]')).toHaveCount(0);
    releaseAgent();
    await expect(page.locator('.react-flow__node[data-id="agent-applied"]')).toBeVisible();
    await expect(page.locator(".canvas-editor")).not.toHaveAttribute("inert");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => counts.claims).toBe(1);
    await expect(page.locator('.react-flow__node[data-id="material-drop-after-agent-drop"] img')).toBeVisible();
    await expect.poll(() => canvas.graph.nodes.map(node => node.id).sort()).toEqual([
      "agent-applied", "existing-prompt", "material-drop-after-agent-drop",
    ]);
    expect(canvas.graph.nodes.find(node => node.id === "material-drop-after-agent-drop")?.data.assetId).toBe(asset.id);
    expect(counts.saves).toBeGreaterThan(0);
    expect(counts).toMatchObject({ external: 0, paid: 0, materialize: 1, claims: 1, discards: 0, uploads: 0, unexpectedMutations: 0 });
    expect(errors).toEqual([]);
  } finally {
    releasePoll();
    releaseAgent();
  }
});
