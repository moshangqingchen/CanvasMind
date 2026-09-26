import { describe, expect, it } from "vitest";
import { withoutLocalExecutionConfig } from "./project-local-config";
import { prepareProjectImport } from "./project-transfer";

describe("project local execution boundary", () => {
  const data = { nodeType: "video-generation", label: "视频", provider: "cli", connectionId: "local-only", model: "video", parameters: { duration: 5, command: "untrusted", env: { TOKEN: "private" } }, cli: { executable: "untrusted" }, __runtimeConnection: { config: { executable: "untrusted" } } };
  it("removes nested execution settings while retaining portable generation choices", () => {
    expect(withoutLocalExecutionConfig(data)).toEqual({ nodeType: "video-generation", label: "视频", provider: "cli", connectionId: "local-only", model: "video", parameters: { duration: 5 } });
    expect(data.__runtimeConnection).toBeDefined();
  });
  it("strips commands from imported project nodes without resolving a connection or launching a CLI", async () => {
    const graph = { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "v", type: "workflow", position: { x: 0, y: 0 }, data }] };
    const imported = await prepareProjectImport({ file: new File([JSON.stringify({ graph, title: "含本机配置的项目" })], "project.canvas.json", { type: "application/json" }), fallbackTitle: "项目", fallbackViewport: graph.viewport, availableAssetIds: new Set() });
    expect(imported.graph.nodes[0]?.data).toEqual(withoutLocalExecutionConfig(data));
  });
});
