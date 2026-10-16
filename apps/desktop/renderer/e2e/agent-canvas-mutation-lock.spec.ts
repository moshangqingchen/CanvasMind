import { expect, test, type Page } from "@playwright/test";
import type { AgentPlan, AgentSession } from "../lib/agent-contracts";

type PromptNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  style: { width: number; height: number };
  data: {
    nodeType: string;
    label: string;
    parts: Array<{ type: string; text: string }>;
    inputs: unknown[];
    outputs: Array<{ id: string; kind: string; label: string }>;
  };
};

function prompt(id: string, x: number, y: number): PromptNode {
  return {
    id, type: "workflow", position: { x, y }, style: { width: 320, height: 200 },
    data: {
      nodeType: "prompt", label: id,
      parts: [{ type: "text", text: `${id} 的原始内容` }], inputs: [],
      outputs: [{ id: "prompt", kind: "text", label: "提示词" }],
    },
  };
}

async function graphOnScreen(page: Page) {
  return page.locator(".react-flow__node").evaluateAll(elements => ({
    nodes: elements.map(element => ({
      id: element.getAttribute("data-id"),
      position: (element as HTMLElement).style.transform,
      selected: element.classList.contains("selected"),
      title: element.querySelector(".node-title")?.textContent,
      text: element.querySelector(".tiptap-prompt")?.textContent,
    })).sort((a, b) => (a.id ?? "").localeCompare(b.id ?? "")),
    groups: document.querySelectorAll(".canvas-node-group").length,
  }));
}

async function settleFrame(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

test("智能体放入画布期间拒绝全局编辑入口，响应正常应用，新增锁不取消编辑器事件", async ({ page, baseURL }) => {
  // Every API is intercepted. No provider connection, generation, upload or
  // external request is needed to exercise the real perform transaction.
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Open Agent explicitly after seeding real history and selection. Its
  // deferred desktop preference must not change the fixture's starting view.
  await page.addInitScript(() => localStorage.setItem("super-canvas:inspector-open", "false"));
  const origin = new URL(baseURL ?? "http://127.0.0.1:3211").origin;
  const canvasId = "agent-mutation-lock";
  const now = "2026-10-15T00:00:00.000Z";
  const canvas = {
    id: canvasId, title: "智能体事务锁隔离回归", revision: 1,
    graph: {
      schemaVersion: 1,
      nodes: [prompt("lock-one", 64, 64), prompt("lock-two", 624, 360)],
      edges: [] as unknown[], drawings: [] as unknown[],
      // The full-bleed canvas no longer begins below a full-width header.
      // Preserve world positions, but expose both real click targets beside
      // the floating project island and Dock without force-clicking through UI.
      viewport: { x: 80, y: 100, zoom: 0.7 },
    },
  };
  const plan: AgentPlan = {
    id: "lock-plan", sessionId: "lock-task", canvasId, version: 1,
    status: "awaiting_approval", summary: "放入一个隔离文本节点", baseCanvasRevision: 1,
    proposal: {
      type: "proposal", summary: "放入一个隔离文本节点", assumptions: [], calls: [],
      texts: [{ id: "lock-text", title: "Agent 新文本", content: "仅模拟放入画布，不生成素材" }],
    },
    calls: [], patch: { nodes: [], edges: [], generationNodeIds: [], touchedExistingNodeIds: [] },
  };
  const session: AgentSession = {
    id: plan.sessionId, canvasId, title: "已有的待确认方案", messages: [], plans: [plan],
  };
  const counts = { external: 0, paid: 0, uploads: 0, materialize: 0, saves: 0 };
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  let held = false;
  let release: () => void = () => undefined;
  const responseGate = new Promise<void>(resolve => { release = resolve; });
  let approvedGraph = structuredClone(canvas.graph);
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin && !["data:", "blob:", "about:"].includes(url.protocol)) {
      counts.external++;
      return route.abort("blockedbyclient");
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname;
    const method = request.method();
    if (path === "/api/projects") return route.fulfill({ json: { projects: [{
      id: canvasId, title: canvas.title, nodeCount: canvas.graph.nodes.length,
      createdAt: now, updatedAt: now,
    }] } });
    if (path === `/api/canvas/${canvasId}`) {
      if (method === "PUT") {
        counts.saves++;
        const body = request.postDataJSON() as { graph: typeof canvas.graph; title: string };
        canvas.graph = body.graph;
        canvas.title = body.title;
        canvas.revision++;
      }
      return route.fulfill({ json: canvas });
    }
    if (path === "/api/agent/sessions") return route.fulfill({ json: [{ id: session.id, title: session.title }] });
    if (path === `/api/agent/sessions/${session.id}`) return route.fulfill({ json: session });
    if (path === `/api/agent/plans/${plan.id}/materialize`) {
      counts.materialize++;
      expect(request.postDataJSON()).toMatchObject({ version: 1, canvasRevision: canvas.revision });
      // Freeze the authoritative response before attempting conflicting edits.
      approvedGraph = structuredClone(canvas.graph);
      held = true;
      await responseGate;
      canvas.graph = {
        ...approvedGraph, nodes: [...approvedGraph.nodes, prompt("agent-applied", 624, 64)],
      };
      canvas.revision++;
      plan.status = "awaiting_execution";
      return route.fulfill({ json: { plan, canvas } });
    }
    if (path === "/api/assets/upload") {
      counts.uploads++;
      return route.abort("blockedbyclient");
    }
    if ((path === "/api/runs" && method !== "GET") ||
        path === "/api/agent/turn" || /\/api\/agent\/plans\/[^/]+\/(execute|preflight)$/.test(path)) {
      counts.paid++;
      return route.abort("blockedbyclient");
    }
    if (["/api/providers", "/api/suppliers", "/api/assets", "/api/runs", "/api/agent/models"].includes(path) || path.includes("/models")) {
      return route.fulfill({ json: [] });
    }
    if (path.includes("/chat")) return route.fulfill({ json: { messages: [] } });
    return route.fulfill({ json: { groups: [], items: [], runs: [], drops: [] } });
  });

  await page.goto(`/canvas/${canvasId}`);
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await page.locator('.react-flow__node[data-id="lock-one"] .node-title').click();
  // Exercise both directions of actual history first, leaving a fourth node
  // available to redo. Empty history must not make the lock test pass vacuously.
  const shortcut = async (key: string) => page.evaluate(key => window.dispatchEvent(new KeyboardEvent("keydown", {
    key, ctrlKey: true, bubbles: true, cancelable: true,
  })), key);
  await shortcut("d");
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await shortcut("d");
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await shortcut("z");
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await shortcut("y");
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await shortcut("z");
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  // Exactly two of three nodes make both Group and Select All meaningful.
  // Selection changes do not create a graph history checkpoint or consume redo.
  await page.locator('.react-flow__node[data-id="lock-one"] .node-title').click();
  await page.locator('.react-flow__node[data-id="lock-two"] .node-title').click({ modifiers: ["Control"] });
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  // Seed the real production node clipboard rather than just its MIME marker.
  const copied = await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    const clipboardData = new DataTransfer();
    window.dispatchEvent(new ClipboardEvent("copy", { clipboardData, bubbles: true, cancelable: true }));
    return clipboardData.getData("application/x-super-canvas-nodes");
  });
  expect(copied).toBe("1");
  await page.getByRole("button", { name: "打开智能体", exact: true }).click();
  await page.getByRole("button", { name: "放入画布", exact: true }).click();
  await expect.poll(() => held).toBe(true);
  await expect(page.locator(".canvas-editor")).toHaveAttribute("inert", "");
  await settleFrame(page);
  const baseline = await graphOnScreen(page);
  expect(baseline.nodes.filter(node => node.selected)).toHaveLength(2);
  expect(baseline.groups).toBe(0);
  const savesBeforeAttempts = counts.saves;
  const attempts: Array<{ action: string; prevented: boolean; graph: Awaited<ReturnType<typeof graphOnScreen>> }> = [];
  let editorKeys = { selectAllPrevented: true, pastePrevented: true };
  let savesDuringAttempts = savesBeforeAttempts;
  try {
    // inert already prevents native input while perform owns the canvas. These
    // synthetic events only prove the added global handler does not cancel an
    // editor-scoped event; they do not claim the user can type through inert.
    editorKeys = await page.getByLabel("创作任务要求").evaluate(element => {
      const selectAll = new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true });
      element.dispatchEvent(selectAll);
      const paste = new ClipboardEvent("paste", { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
      element.dispatchEvent(paste);
      return { selectAllPrevented: selectAll.defaultPrevented, pastePrevented: paste.defaultPrevented };
    });
    for (const key of ["Delete", "z", "y", "a", "d", "g", "Enter", "o"]) {
      const prevented = await page.evaluate(key => {
        const event = new KeyboardEvent("keydown", {
          key, ctrlKey: !["Delete", "o"].includes(key), bubbles: true, cancelable: true,
        });
        // Alternating targets also covers shortcuts dispatched from non-Elements.
        (key === "Delete" || key === "o" ? document : window).dispatchEvent(event);
        return event.defaultPrevented;
      }, key);
      await settleFrame(page);
      attempts.push({ action: `keydown ${key}`, prevented, graph: await graphOnScreen(page) });
    }
    for (const key of ["z", "y"]) {
      const prevented = await page.getByRole("button", { name: "抓手模式", exact: true }).evaluate((element, key) => {
        const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }, key);
      await settleFrame(page);
      attempts.push({ action: `canvas button Ctrl+${key}`, prevented, graph: await graphOnScreen(page) });
    }
    for (const kind of ["nodes", "image"] as const) {
      const prevented = await page.evaluate(kind => {
        const clipboardData = new DataTransfer();
        if (kind === "nodes") clipboardData.setData("application/x-super-canvas-nodes", "1");
        else {
          const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="), value => value.charCodeAt(0));
          clipboardData.items.add(new File([bytes], "lock.png", { type: "image/png" }));
        }
        const event = new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true });
        document.dispatchEvent(event);
        return event.defaultPrevented;
      }, kind);
      await settleFrame(page);
      attempts.push({ action: `paste ${kind}`, prevented, graph: await graphOnScreen(page) });
    }
    // Programmatic activation reaches the handler despite inert, validating the
    // shared canEditCanvas entry guard rather than pointer blocking alone.
    await page.getByRole("button", { name: "新建提示词节点", exact: true }).evaluate(element => (element as HTMLButtonElement).click());
    await settleFrame(page);
    attempts.push({ action: "add prompt", prevented: true, graph: await graphOnScreen(page) });
    savesDuringAttempts = counts.saves;
  } finally {
    release();
  }
  // Verify the response applies even when a preceding assertion would expose a
  // missing lock; never leave the held request hanging on a regression failure.
  await expect(page.locator('.react-flow__node[data-id="agent-applied"]')).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(page.locator(".canvas-editor")).not.toHaveAttribute("inert");
  for (const attempt of attempts) {
    expect(attempt.prevented, attempt.action).toBe(true);
    expect(attempt.graph, attempt.action).toEqual(baseline);
  }
  expect(editorKeys, "新增事务锁不取消发往输入框的事件；此处不验证 inert 期间原生输入").toEqual({ selectAllPrevented: false, pastePrevented: false });
  expect(savesDuringAttempts).toBe(savesBeforeAttempts);
  expect(counts).toMatchObject({ external: 0, paid: 0, uploads: 0, materialize: 1 });
  expect(pageErrors).toEqual([]);
});
