import { beforeEach, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  getCanvas: vi.fn(),
  listAssets: vi.fn(),
  listRuns: vi.fn(),
  listNodeRuns: vi.fn(),
}));
vi.mock("../../../../../lib/server", () => ({
  repository,
  jsonError: (message: string, status: number) =>
    Response.json({ error: message }, { status }),
  redactPublicText: (text: string) =>
    text.replaceAll("secret-token", "[redacted]"),
}));
import { GET } from "./route";

const graph = {
  nodes: [
    {
      id: "generator",
      data: {
        label: "海报",
        graphicDesignBrief: { customerText: "原始客户要求" },
      },
    },
  ],
  edges: [],
};
const context = { params: Promise.resolve({ id: "project" }) };
const request = (query = "") =>
  new Request(`http://localhost/api/projects/project/results${query}`);

beforeEach(() => {
  vi.resetAllMocks();
  repository.getCanvas.mockResolvedValue({ graph });
  repository.listAssets.mockResolvedValue([
    {
      id: "output",
      kind: "image",
      metadata: { runId: "run", nodeId: "generator" },
    },
    {
      id: "foreign",
      kind: "image",
      metadata: { runId: "other-run", nodeId: "generator" },
    },
    {
      id: "deleted",
      kind: "image",
      deleted: true,
      metadata: { runId: "run", nodeId: "generator" },
    },
  ]);
  repository.listRuns.mockResolvedValue([{ id: "run", revisionGraph: graph }]);
  repository.listNodeRuns.mockResolvedValue([
    {
      nodeId: "generator",
      outputAssetIds: ["output", "foreign", "deleted"],
      inputJson: { prompt: "执行提示 secret-token", apiKey: "secret-token" },
    },
    { nodeId: "preview", outputAssetIds: ["output"], inputJson: {} },
  ]);
});

it("returns only this project's original outputs and keeps full text out of the list", async () => {
  const response = await GET(request(), context);
  expect(await response.json()).toEqual([
    {
      assetId: "output",
      canvasId: "project",
      runId: "run",
      nodeId: "generator",
      label: "海报",
      instruction: "",
      requirements: "",
    },
  ]);
  expect(repository.listRuns).toHaveBeenCalledWith("project");
  const detail = await GET(request("?assetId=output"), context);
  expect(await detail.json()).toEqual([
    expect.objectContaining({
      instruction: "执行提示 [redacted]",
      requirements: "原始客户要求",
    }),
  ]);
});

it("recovers reviewed imported assets from their new canvas and handles a removed run", async () => {
  repository.listRuns.mockResolvedValue([]);
  repository.getCanvas.mockResolvedValue({
    graph: {
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id: "result-node",
          data: { assetId: "import", generatedFromNodeId: "generator" },
        },
      ],
    },
  });
  repository.listAssets.mockResolvedValue([
    {
      id: "import",
      kind: "image",
      metadata: { imageDesignReview: { status: "approved", revision: 1 } },
    },
    {
      id: "archived",
      name: "旧成果",
      kind: "image",
      metadata: {
        canvasId: "project",
        runId: "removed",
        nodeId: "old-generator",
        designSourceAssetId: "import",
      },
    },
  ]);
  const response = await GET(request(), context);
  expect(await response.json()).toEqual([
    expect.objectContaining({ assetId: "archived", sourceAssetId: "import" }),
    expect.objectContaining({
      assetId: "import",
      nodeId: "generator",
      label: "海报",
    }),
  ]);
});

it("rejects missing projects before reading assets", async () => {
  repository.getCanvas.mockResolvedValue(null);
  expect((await GET(request(), context)).status).toBe(404);
  expect(repository.listAssets).not.toHaveBeenCalled();
});
