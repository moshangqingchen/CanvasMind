import { describe, expect, it } from "vitest";
import { tidyCanvasRectPositions, type TidyCanvasEdge, type TidyCanvasRect } from "./graph-ui";

const rect = (id: string, x: number, y: number, extra: Partial<TidyCanvasRect> = {}): TidyCanvasRect =>
  ({ id, position: { x, y }, width: 240, height: 160, ...extra });
type Positions = ReturnType<typeof tidyCanvasRectPositions>;
const centerY = (node: TidyCanvasRect, positions: Positions) => positions.get(node.id)!.y + node.height / 2;
const moved = (nodes: readonly TidyCanvasRect[], positions: Positions) => nodes.map(node => ({ ...node, position: positions.get(node.id)! }));
const workflowFixture = (count: number) => ({
  nodes: Array.from({ length: count }, (_, index) => [
    rect(`flow-${index}-a`, 53, 77 + index * 400),
    rect(`flow-${index}-b`, 900, 97 + index * 400),
  ]).flat(),
  edges: Array.from({ length: count }, (_, index) => ({ source: `flow-${index}-a`, target: `flow-${index}-b` })),
});
function assertNoOverlap(nodes: readonly TidyCanvasRect[], positions: Positions) {
  for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
    const first = nodes[a]!, second = nodes[b]!, p = positions.get(first.id)!, q = positions.get(second.id)!;
    expect(p.x + first.width <= q.x || q.x + second.width <= p.x ||
      p.y + first.height <= q.y || q.y + second.height <= p.y, `${first.id} overlaps ${second.id}`).toBe(true);
  }
}

describe("left-to-right canvas layout", () => {
  it("packs ten fan-in siblings in a four-column reading grid and centers the entire grid on the target port", () => {
    const sources = Array.from({ length: 10 }, (_, index) => rect(`asset-${index}`, 40, index * 200,
      { fileName: `${10 - index}.png`, nodeType: "asset-input", width: index === 3 ? 280 : 240,
        height: index === 5 ? 240 : 160, portCenters: { source: [{ id: "image", y: 80 }], target: [] } }));
    const target = rect("target", 500, 100, { height: 220,
      portCenters: { source: [], target: [{ id: "references", y: 58 }] } });
    const nodes = [...sources, target];
    const edges = sources.map(source => ({ source: source.id, sourceHandle: "image", target: target.id, targetHandle: "references" }));
    const positions = tidyCanvasRectPositions(nodes, edges);
    const expected = [...sources].reverse();
    for (let index = 0; index < expected.length; index++) {
      const point = positions.get(expected[index]!.id)!;
      expect(point.x).toBe(40 + index % 4 * (280 + 24));
      if (index % 4) expect(point.y).toBe(positions.get(expected[index - 1]!.id)!.y);
      if (index >= 4) expect(point.y).toBeGreaterThan(positions.get(expected[index - 4]!.id)!.y);
    }
    const top = Math.min(...sources.map(source => positions.get(source.id)!.y));
    const bottom = Math.max(...sources.map(source => positions.get(source.id)!.y + source.height));
    expect(positions.get(target.id)!.y + 58).toBe((top + bottom) / 2);
    expect(positions.get(target.id)!.x).toBeGreaterThan(Math.max(...sources.map(source => positions.get(source.id)!.x + source.width)));
    expect(tidyCanvasRectPositions(moved(nodes, positions), edges)).toEqual(positions);
    assertNoOverlap(nodes, positions);
  });

  it("uses target reference numbering instead of the source-node array when connection order is selected", () => {
    const sources = ["10", "2", "1", "3", "4", "5"].map((name, index) =>
      rect(`asset-${name}`, index * 300, 0, { fileName: `${name}.png`, nodeType: "asset-input" }));
    const nodes = [...sources, rect("target", 2000, 0)];
    const order = ["3", "10", "4", "2", "5", "1"];
    const edges = order.map(id => ({ source: `asset-${id}`, target: "target" }));
    const connected = tidyCanvasRectPositions(nodes, edges, { arrangementOrder: "connection" });
    const named = tidyCanvasRectPositions(nodes, edges, { arrangementOrder: "filename" });
    const readingOrder = (positions: Positions) => [...sources].sort((a, b) =>
      positions.get(a.id)!.y - positions.get(b.id)!.y || positions.get(a.id)!.x - positions.get(b.id)!.x).map(node => node.id);
    expect(readingOrder(connected)).toEqual(order.map(id => `asset-${id}`));
    expect(readingOrder(named)).toEqual(["1", "2", "3", "4", "5", "10"].map(id => `asset-${id}`));
    expect(new Set(sources.map(source => connected.get(source.id)!.x)).size).toBe(3);
    expect(new Set(sources.map(source => connected.get(source.id)!.y)).size).toBe(2);
    assertNoOverlap(nodes, connected);
    assertNoOverlap(nodes, named);
  });

  it("only combines singleton ungrouped sources with no scoped upstream and exactly the same target set", () => {
    const sources = Array.from({ length: 4 }, (_, index) => rect(`asset-${index}`, index * 300, 800,
      { nodeType: "asset-input", fileName: `${index}.png` }));
    const nodes = [...sources, rect("target", 1800, 0), rect("other", 1800, 400),
      rect("upstream", -500, 100), rect("group-a", -500, 400, { canvasGroupId: "group" }),
      rect("group-b", -180, 460, { canvasGroupId: "group" })];
    const edges = [...sources.map(source => ({ source: source.id, target: "target" })),
      { source: "asset-3", target: "other" }, { source: "upstream", target: "asset-2" },
      { source: "group-a", target: "target" }, { source: "group-b", target: "target" }];
    const positions = tidyCanvasRectPositions(nodes, edges);
    expect(positions.get("asset-0")!.x).toBe(positions.get("asset-1")!.x);
    expect(positions.get("asset-0")!.y).not.toBe(positions.get("asset-1")!.y);
    expect(positions.get("group-b")!.x - positions.get("group-a")!.x).toBe(320);
    expect(positions.get("group-b")!.y - positions.get("group-a")!.y).toBe(60);
    assertNoOverlap(nodes, positions);
  });

  it("keeps a prompt feeding the same target outside the asset grid", () => {
    const sources = Array.from({ length: 4 }, (_, index) => rect(`asset-${index}`, 0, index * 200,
      { nodeType: "asset-input", fileName: `${index}.png` }));
    const prompt = rect("prompt", 0, 900, { nodeType: "prompt", label: "提示词", width: 360 });
    const nodes = [...sources, prompt, rect("target", 1600, 200)];
    const edges = [...sources, prompt].map(source => ({ source: source.id, target: "target" }));
    const positions = tidyCanvasRectPositions(nodes, edges);
    expect(new Set(sources.map(source => positions.get(source.id)!.x)).size).toBe(2);
    const gridBottom = Math.max(...sources.map(source => positions.get(source.id)!.y + source.height));
    const gridTop = Math.min(...sources.map(source => positions.get(source.id)!.y));
    const promptTop = positions.get("prompt")!.y;
    expect(promptTop >= gridBottom || promptTop + prompt.height <= gridTop).toBe(true);
    assertNoOverlap(nodes, positions);
  });

  it("arranges selected fan-in siblings without expanding a group or pulling in outside upstream nodes", () => {
    const sources = Array.from({ length: 4 }, (_, index) => rect(`asset-${index}`, 0, index * 200,
      { nodeType: "asset-input", fileName: `${4 - index}.png` }));
    const nodes = [...sources, rect("target", 1600, 200), rect("outside", -500, -500),
      rect("group-a", 400, 1600, { canvasGroupId: "group" }), rect("group-b", 720, 1660, { canvasGroupId: "group" })];
    const edges = [...sources.map(source => ({ source: source.id, target: "target" })),
      { source: "outside", target: "asset-0" }];
    const selectedIds = [...sources.map(source => source.id), "target"];
    const positions = tidyCanvasRectPositions(nodes, edges, { selectedIds });
    expect(new Set(sources.map(source => positions.get(source.id)!.x)).size).toBe(2);
    for (const node of nodes.filter(node => !selectedIds.includes(node.id))) expect(positions.get(node.id)).toEqual(node.position);
    assertNoOverlap(nodes, positions);
  });

  it("naturally sorts each isolated type and fills rows from left to right", () => {
    const names = ["10.png", "2.png", "1.png", "4.png", "3.png", "5.png"];
    const nodes = names.map((fileName, index) => rect(fileName, index * 280, index * 20,
      { fileName, nodeType: "asset-input" }));
    nodes.splice(2, 0, rect("prompt", 1600, 40, { nodeType: "prompt", label: "A prompt" }));
    const named = tidyCanvasRectPositions(nodes, [], { arrangementOrder: "filename", viewportWidth: 400 });
    const connected = tidyCanvasRectPositions(nodes, [], { arrangementOrder: "connection", viewportWidth: 400 });
    expect(named.get("1.png")!.y).toBe(named.get("2.png")!.y);
    expect(named.get("1.png")!.x).toBeLessThan(named.get("2.png")!.x);
    expect(named.get("4.png")!.y).toBeGreaterThan(named.get("3.png")!.y);
    expect(connected.get("10.png")!.x).toBeLessThan(connected.get("2.png")!.x);
    expect(named.get("prompt")!.y).toBeGreaterThanOrEqual(named.get("10.png")!.y);
    assertNoOverlap(nodes, named);
    assertNoOverlap(nodes, connected);
  });

  it("moves a selected workflow as a whole only when its arranged bounds hit an outside card", () => {
    const selected = [rect("source", 0, 0), rect("target", 900, 400)];
    const edges = [{ source: "source", target: "target" }];
    const baseline = tidyCanvasRectPositions(selected, edges);
    const blocker = rect("outside", 360, 0);
    const nodes = [...selected, blocker];
    const positions = tidyCanvasRectPositions(nodes, edges, { selectedIds: ["source", "target"] });
    expect(positions.get("outside")).toEqual(blocker.position);
    const shift = { x: positions.get("source")!.x - baseline.get("source")!.x,
      y: positions.get("source")!.y - baseline.get("source")!.y };
    expect(shift).not.toEqual({ x: 0, y: 0 });
    expect(positions.get("target")).toEqual({ x: baseline.get("target")!.x + shift.x, y: baseline.get("target")!.y + shift.y });
    expect(tidyCanvasRectPositions(moved(nodes, positions), edges, { selectedIds: ["source", "target"] })).toEqual(positions);
    const distant = { ...blocker, position: { x: 1800, y: 1800 } };
    const clear = tidyCanvasRectPositions([...selected, distant], edges, { selectedIds: ["source", "target"] });
    for (const node of selected) expect(clear.get(node.id)).toEqual(baseline.get(node.id));
    assertNoOverlap(nodes, positions);
  });

  it("balances four independent workflows against usable viewport height while preserving their anchor and reading order", () => {
    const fixture = workflowFixture(4);
    const nodes = [...fixture.nodes, rect("loose-a", 5000, 3000, { nodeType: "asset-input" }),
      rect("loose-b", 5500, 3400, { nodeType: "prompt" })];
    const options = { viewportWidth: 1400, viewportHeight: 800 };
    const before = structuredClone(nodes), positions = tidyCanvasRectPositions(nodes, fixture.edges, options);
    expect(positions.get("flow-0-a")).toEqual({ x: 53, y: 77 });
    expect(positions.get("flow-1-a")!.y).toBe(77);
    expect(positions.get("flow-1-a")!.x).toBeGreaterThan(positions.get("flow-0-b")!.x + 240);
    expect(positions.get("flow-2-a")!.x).toBe(53);
    expect(positions.get("flow-2-a")!.y).toBe(77 + 160 + 160);
    expect(positions.get("flow-3-a")!.y).toBe(positions.get("flow-2-a")!.y);
    for (let index = 0; index < 4; index++) {
      const source = positions.get(`flow-${index}-a`)!, target = positions.get(`flow-${index}-b`)!;
      expect(target.x - source.x).toBe(240 + 120);
      expect(target.y).toBe(source.y);
    }
    const totalWidth = Math.max(...nodes.map(node => positions.get(node.id)!.x + node.width)) - 53;
    const totalHeight = Math.max(...nodes.map(node => positions.get(node.id)!.y + node.height)) - 77;
    expect(totalWidth).toBeLessThanOrEqual(options.viewportWidth * 2.5);
    expect(Math.max(totalWidth / options.viewportWidth, totalHeight / options.viewportHeight)).toBeLessThan(1);
    expect(positions.get("loose-a")!.y).toBe(positions.get("flow-2-a")!.y + 160 + 80);
    expect(tidyCanvasRectPositions(nodes, fixture.edges, options)).toEqual(positions);
    expect(tidyCanvasRectPositions(moved(nodes, positions), fixture.edges, options)).toEqual(positions);
    expect(nodes).toEqual(before);
    assertNoOverlap(nodes, positions);
  });

  it("includes the entire unconnected tray when choosing rows instead of scoring workflow bounds alone", () => {
    const fixture = workflowFixture(4), options = { viewportWidth: 1400, viewportHeight: 1000 };
    const withoutTray = tidyCanvasRectPositions(fixture.nodes, fixture.edges, options);
    const nodes = [...fixture.nodes, ...Array.from({ length: 36 }, (_, index) =>
      rect(`loose-${index}`, 5000 + index * 20, 4000, { nodeType: "prompt" }))];
    const positions = tidyCanvasRectPositions(nodes, fixture.edges, options);
    // A two-by-two workflow grid alone fits best. The large last tray instead
    // needs three workflows across, giving its cards six compact columns.
    expect(withoutTray.get("flow-2-a")!.y).toBeGreaterThan(withoutTray.get("flow-0-a")!.y);
    expect(positions.get("flow-2-a")!.y).toBe(positions.get("flow-0-a")!.y);
    expect(positions.get("flow-3-a")!.y).toBeGreaterThan(positions.get("flow-2-a")!.y);
    const bottom = Math.max(...fixture.nodes.map(node => positions.get(node.id)!.y + node.height));
    expect(positions.get("loose-0")!.y).toBe(bottom + 80);
    expect(tidyCanvasRectPositions(moved(nodes, positions), fixture.edges, options)).toEqual(positions);
    assertNoOverlap(nodes, positions);
  });

  it("keeps legacy packing when usable viewport height is omitted or invalid", () => {
    const fixture = workflowFixture(4);
    const legacy = tidyCanvasRectPositions(fixture.nodes, fixture.edges, { viewportWidth: 1400 });
    expect(new Set(fixture.nodes.map(node => legacy.get(node.id)!.y)).size).toBe(1);
    for (const viewportHeight of [undefined, 0, -1, NaN, Infinity])
      expect(tidyCanvasRectPositions(fixture.nodes, fixture.edges, { viewportWidth: 1400, viewportHeight })).toEqual(legacy);
  });

  it("keeps the unconnected tray within the main workflow width and close to its bottom", () => {
    const nodes = [rect("a", 0, 0), rect("b", 800, 50), ...Array.from({ length: 8 }, (_, index) => rect(`loose-${index}`, index * 500, 1000))];
    const edges = [{ source: "a", target: "b" }];
    const positions = tidyCanvasRectPositions(nodes, edges, { viewportWidth: 1920 });
    const workflowRight = positions.get("b")!.x + 240;
    const workflowBottom = Math.max(positions.get("a")!.y, positions.get("b")!.y) + 160;
    for (const node of nodes.slice(2)) expect(positions.get(node.id)!.x + node.width).toBeLessThanOrEqual(workflowRight);
    expect(Math.min(...nodes.slice(2).map(node => positions.get(node.id)!.y)) - workflowBottom).toBe(80);
    expect(tidyCanvasRectPositions(moved(nodes, positions), edges, { viewportWidth: 1920 })).toEqual(positions);
    assertNoOverlap(nodes, positions);
  });
  it("aligns measured handle centers across unequal cards and an attached result, not card centers", () => {
    const nodes = [rect("prompt", 800, 500, { height: 210, nodeType: "prompt",
      portCenters: { source: [{ id: "prompt", y: 105 }], target: [] } }),
    rect("generation", 53, 77, { height: 272, nodeType: "image-generation",
      portCenters: { source: [{ id: "images", y: 136 }], target: [{ id: "prompt", y: 58 }, { id: "reference", y: 100 }] } }),
    rect("result", 400, 300, { height: 237, generatedFromNodeId: "generation",
      portCenters: { source: [], target: [{ id: "generated", y: 118.5 }] } })];
    const edges = [{ source: "prompt", sourceHandle: "prompt", target: "generation", targetHandle: "prompt" },
      // Old saved result edges legitimately omit handles; React Flow picks the first.
      { source: "generation", target: "result" }];
    const positions = tidyCanvasRectPositions(nodes, edges, { viewportWidth: 1400, viewportHeight: 700 });
    expect(positions.get("prompt")!.y + 105).toBe(positions.get("generation")!.y + 58);
    expect(positions.get("generation")!.y + 136).toBe(positions.get("result")!.y + 118.5);
    expect(Math.min(...[...positions.values()].map(point => point.x))).toBe(53);
    expect(Math.min(...[...positions.values()].map(point => point.y))).toBe(77);
    expect(tidyCanvasRectPositions(moved(nodes, positions), edges, { viewportWidth: 1400, viewportHeight: 700 })).toEqual(positions);
    assertNoOverlap(nodes, positions);
  });

  it("uses the selected second port and its measured offset instead of the first port or a type formula", () => {
    const nodes = [rect("source", 800, 600, { height: 310,
      portCenters: { source: [{ id: "one", y: 50 }, { id: "two", y: 191.25 }], target: [] } }),
    rect("target", 53, 77, { height: 240,
      portCenters: { source: [], target: [{ id: "one", y: 59 }, { id: "two", y: 99.75 }] } }),
    rect("outside", -500, -500)];
    const edges = [{ source: "source", sourceHandle: "two", target: "target", targetHandle: "two" }];
    const positions = tidyCanvasRectPositions(nodes, edges, { selectedIds: ["source", "target"] });
    expect(positions.get("source")!.y + 191.25).toBe(positions.get("target")!.y + 99.75);
    expect(positions.get("source")).toEqual({ x: 53, y: 77 });
    expect(positions.get("outside")).toEqual(nodes[2]!.position);
    expect(tidyCanvasRectPositions(moved(nodes, positions), edges, { selectedIds: ["source", "target"] })).toEqual(positions);
  });

  it("centers fan-out at the median of the connected ports while preserving sibling clearance", () => {
    const nodes = [rect("parent", 50, 600, { portCenters: { source: [{ id: "out", y: 80 }], target: [] } }),
      ...[58, 100, 142].map((y, index) => rect(`child-${index}`, 800, index * 300, {
        height: 220, portCenters: { source: [], target: [{ id: "in", y }] },
      }))];
    const edges = nodes.slice(1).map(node => ({ source: "parent", sourceHandle: "out", target: node.id, targetHandle: "in" }));
    const positions = tidyCanvasRectPositions(nodes, edges);
    const portYs = nodes.slice(1).map(node => positions.get(node.id)!.y + node.portCenters!.target[0]!.y).sort((a, b) => a - b);
    expect(positions.get("parent")!.y + 80).toBe(portYs[1]);
    expect(tidyCanvasRectPositions(moved(nodes, positions), edges)).toEqual(positions);
    assertNoOverlap(nodes, positions);
  });

  it("balances multiple port constraints with their median and includes a rigid group's member offset", () => {
    const nodes = [rect("group-a", 50, 300, { canvasGroupId: "group",
      portCenters: { source: [{ id: "out", y: 30 }], target: [] } }),
    rect("group-b", 350, 500, { canvasGroupId: "group",
      portCenters: { source: [{ id: "out", y: 80 }], target: [] } }),
    rect("target", 800, 50, { portCenters: { source: [], target: [{ id: "one", y: 40 }, { id: "two", y: 100 }] } })];
    const edges = [{ source: "group-a", sourceHandle: "out", target: "target", targetHandle: "one" },
      { source: "group-b", sourceHandle: "out", target: "target", targetHandle: "two" }];
    const positions = tidyCanvasRectPositions(nodes, edges);
    const firstError = positions.get("group-a")!.y + 30 - positions.get("target")!.y - 40;
    const secondError = positions.get("group-b")!.y + 80 - positions.get("target")!.y - 100;
    expect(firstError + secondError).toBe(0);
    expect(positions.get("group-b")!.y - positions.get("group-a")!.y).toBe(200);
    expect(tidyCanvasRectPositions(moved(nodes, positions), edges)).toEqual(positions);
    assertNoOverlap(nodes, positions);
  });

  it("makes a measured-size chain straight, left aligned and anchored to its original top left", () => {
    const nodes = [rect("a", 704, 512, { width: 320, height: 120 }),
      rect("b", 48, 304, { width: 420, height: 200 }), rect("c", 400, 80, { width: 280, height: 160 })];
    const edges = [{ source: "a", target: "b" }, { source: "b", target: "c" }];
    const positions = tidyCanvasRectPositions(nodes, edges);
    expect(positions.get("a")!.x).toBe(48);
    expect(Math.min(...[...positions.values()].map(point => point.y))).toBe(80);
    expect([...positions.values()].every(point => point.x % 8 === 0 && point.y % 8 === 0)).toBe(true);
    const centers = nodes.map(node => centerY(node, positions));
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(4);
    for (let index = 1; index < nodes.length; index++)
      expect(positions.get(nodes[index]!.id)!.x - positions.get(nodes[index - 1]!.id)!.x - nodes[index - 1]!.width).toBeGreaterThanOrEqual(120);
    assertNoOverlap(nodes, positions);
  });

  it("centers a fan-out parent over its children while keeping forty pixels between cards", () => {
    const nodes = [rect("parent", 24, 600), rect("top", 840, 800), rect("middle", 440, 32), rect("bottom", 160, 280)];
    const edges = nodes.slice(1).map(node => ({ source: "parent", target: node.id }));
    const positions = tidyCanvasRectPositions(nodes, edges);
    const children = nodes.slice(1).sort((a, b) => positions.get(a.id)!.y - positions.get(b.id)!.y);
    expect(children.map(node => positions.get(node.id)!.x)).toEqual(Array(3).fill(positions.get("top")!.x));
    expect(centerY(nodes[0]!, positions)).toBe((centerY(children[0]!, positions) + centerY(children[2]!, positions)) / 2);
    for (let index = 1; index < children.length; index++)
      expect(positions.get(children[index]!.id)!.y - positions.get(children[index - 1]!.id)!.y - 160).toBe(40);
    assertNoOverlap(nodes, positions);
  });

  it("pulls a late reference source directly before its deeper join and uses the column maximum width", () => {
    const nodes = [rect("a", 0, 0), rect("b", 0, 200), rect("c", 0, 400, { width: 360 }),
      rect("join", 0, 600), rect("reference", 0, 800, { width: 120 })];
    const edges = [{ source: "a", target: "b" }, { source: "b", target: "c" },
      { source: "c", target: "join" }, { source: "reference", target: "join" }];
    const positions = tidyCanvasRectPositions(nodes, edges);
    expect(positions.get("reference")!.x).toBe(positions.get("c")!.x);
    expect(positions.get("join")!.x - positions.get("c")!.x - 360).toBe(120);
    assertNoOverlap(nodes, positions);
  });

  it("removes avoidable layer crossings rather than retaining the final sweep unconditionally", () => {
    const sources = ["a", "b", "c", "d"], targets = ["w", "x", "y", "z"];
    const nodes = [...sources, ...targets].map((id, index) => rect(id, index * 20, index * 180));
    const edges = sources.map((source, index) => ({ source, target: targets[3 - index]! }));
    // Connect the pairs into one component without adding an avoidable crossing.
    edges.push({ source: "a", target: "y" }, { source: "b", target: "x" }, { source: "c", target: "w" });
    const positions = tidyCanvasRectPositions(nodes, edges);
    let crossings = 0;
    for (let a = 0; a < edges.length; a++) for (let b = a + 1; b < edges.length; b++) {
      const first = edges[a]!, second = edges[b]!;
      if ((positions.get(first.source)!.y - positions.get(second.source)!.y) *
          (positions.get(first.target)!.y - positions.get(second.target)!.y) < 0) crossings++;
    }
    expect(crossings).toBe(0);
    assertNoOverlap(nodes, positions);
  });

  it("keeps manual groups rigid and grouped results in their manually chosen relative positions", () => {
    const nodes = [rect("upstream", 8, 0), rect("one", 280, 240, { canvasGroupId: "manual" }),
      rect("two", 600, 200, { canvasGroupId: "manual" }),
      rect("result", 940, 256, { canvasGroupId: "manual", generatedFromNodeId: "two" }), rect("downstream", 1400, 8)];
    const edges = [{ source: "upstream", target: "one" }, { source: "one", target: "two" }, { source: "result", target: "downstream" }];
    const before = structuredClone(nodes), positions = tidyCanvasRectPositions(nodes, edges);
    for (const id of ["two", "result"]) {
      const node = nodes.find(item => item.id === id)!;
      expect(positions.get(id)!.x - positions.get("one")!.x).toBe(node.position.x - nodes[1]!.position.x);
      expect(positions.get(id)!.y - positions.get("one")!.y).toBe(node.position.y - nodes[1]!.position.y);
    }
    expect(nodes).toEqual(before);
    assertNoOverlap(nodes, positions);
  });

  it("attaches four ungrouped results as a compact grid without shrinking their actual dimensions", () => {
    const nodes = [rect("source", 80, 100, { width: 420, height: 210 }),
      ...Array.from({ length: 4 }, (_, index) => rect(`result-${index}`, 40 * index, 20 * index,
        { width: 200, height: 150, generatedFromNodeId: "source" })), rect("next", 800, 900)];
    const positions = tidyCanvasRectPositions(nodes, [{ source: "result-0", target: "next" }]);
    expect(positions.get("result-0")!.x - positions.get("source")!.x - 420).toBeGreaterThanOrEqual(24);
    expect(positions.get("result-1")!.x - positions.get("result-0")!.x - 200).toBe(16);
    expect(positions.get("result-2")!.y - positions.get("result-0")!.y - 150).toBeGreaterThanOrEqual(16);
    expect(positions.get("next")!.x).toBeGreaterThan(positions.get("result-1")!.x + 200);
    expect(nodes[0]!.width).toBe(420);
    expect(nodes[1]!.height).toBe(150);
    assertNoOverlap(nodes, positions);
  });

  it("packs workflows in reading order, wraps at the viewport budget and puts typed isolated cards last", () => {
    const nodes = [rect("b1", 800, 500), rect("b2", 1000, 520), rect("a1", 40, 40), rect("a2", 100, 60),
      rect("video", 0, 0, { nodeType: "video-generation" }), rect("prompt", 20, 20, { nodeType: "prompt" }),
      rect("asset", 50, 50, { nodeType: "asset-input" }), rect("prompt-2", 20, 25, { nodeType: "prompt" })];
    const edges = [{ source: "b1", target: "b2" }, { source: "a1", target: "a2" }];
    const positions = tidyCanvasRectPositions(nodes, edges, { viewportWidth: 300 });
    expect(positions.get("a1")!.x).toBe(0);
    expect(positions.get("b1")!.x).toBe(0);
    expect(positions.get("b1")!.y - positions.get("a1")!.y - 160).toBe(160);
    expect(positions.get("asset")!.y).toBeGreaterThan(positions.get("b1")!.y + 160);
    expect(positions.get("asset")!.y).toBe(positions.get("prompt")!.y);
    expect(positions.get("asset")!.x).toBeLessThan(positions.get("prompt")!.x);
    expect(positions.get("prompt-2")!.y).toBeLessThanOrEqual(positions.get("video")!.y);
    assertNoOverlap(nodes, positions);
  });

  it("only arranges two or more selected nodes and never expands a partial group or result attachment", () => {
    const nodes = [rect("outside", -400, -300, { canvasGroupId: "group" }),
      rect("one", 53, 77, { selected: true, canvasGroupId: "group" }),
      rect("two", 400, 130, { selected: true, canvasGroupId: "group" }),
      rect("result", 1300, 160, { generatedFromNodeId: "one" })];
    const positions = tidyCanvasRectPositions(nodes, [{ source: "outside", target: "one" }]);
    expect(positions.get("outside")).toEqual(nodes[0]!.position);
    expect(positions.get("result")).toEqual(nodes[3]!.position);
    expect(positions.get("one")).toEqual({ x: 53, y: 77 });
    expect(positions.get("two")!.x - positions.get("one")!.x).toBe(347);
    expect(positions.get("two")!.y - positions.get("one")!.y).toBe(53);
    const full = tidyCanvasRectPositions(nodes, [], { selectedIds: ["one"] });
    expect(Math.min(...[...full.values()].map(point => point.x))).toBe(-400);
    expect(Math.min(...[...full.values()].map(point => point.y))).toBe(-300);
  });

  it("rearranges an explicit selected chain at its own anchor while leaving external nodes exactly untouched", () => {
    const nodes = [rect("outside", -400, -300), rect("one", 800, 500), rect("two", 100, 200),
      rect("outside-result", 1600, 100, { generatedFromNodeId: "one" })];
    const positions = tidyCanvasRectPositions(nodes, [
      { source: "outside", target: "one" }, { source: "one", target: "two" }, { source: "one", target: "outside-result" },
    ], { selectedIds: ["one", "two"] });
    expect(positions.get("one")).toEqual({ x: 100, y: 200 });
    expect(positions.get("two")).toEqual({ x: 460, y: 200 });
    expect(positions.get("outside")).toEqual(nodes[0]!.position);
    expect(positions.get("outside-result")).toEqual(nodes[3]!.position);
  });

  it("attaches a selected nested result to its nearest available source without pulling in an outside ancestor", () => {
    const nodes = [rect("outside", -400, -300), rect("source-result", 800, 500, { generatedFromNodeId: "outside" }),
      rect("nested-result", 100, 200, { generatedFromNodeId: "source-result" })];
    const positions = tidyCanvasRectPositions(nodes, [], { selectedIds: ["source-result", "nested-result"] });
    expect(positions.get("outside")).toEqual(nodes[0]!.position);
    expect(positions.get("nested-result")!.x - positions.get("source-result")!.x - 240).toBe(24);
    expect(positions.get("nested-result")!.y).toBe(positions.get("source-result")!.y);
  });

  it("is deterministic and idempotent with mixed sizes, branches, result grids and independent workflows", () => {
    const nodes = [rect("a", 80, 400, { width: 300, height: 140 }), rect("b", 600, 100, { width: 420, height: 210 }),
      rect("c", 400, 700), rect("d", 50, 1500), rect("e", 200, 1400),
      ...Array.from({ length: 5 }, (_, index) => rect(`result-${index}`, index * 27, index * 19, { generatedFromNodeId: "b", width: 200, height: 150 })),
      rect("isolated", 2000, 20, { nodeType: "prompt" })];
    const edges = [{ source: "a", target: "b" }, { source: "a", target: "c" }, { source: "d", target: "e" }];
    const first = tidyCanvasRectPositions(nodes, edges, { viewportWidth: 600 });
    expect(tidyCanvasRectPositions(nodes, edges, { viewportWidth: 600 })).toEqual(first);
    expect(tidyCanvasRectPositions(moved(nodes, first), edges, { viewportWidth: 600 })).toEqual(first);
    assertNoOverlap(nodes, first);
  });

  it("handles cycles, duplicate and unknown edges without collapse, mutation or non-finite coordinates", () => {
    const nodes = [rect("a", 8, 16), rect("b", 8, 16), rect("c", 8, 16), rect("tail", 8, 16)];
    const edges = [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "c", target: "a" },
      { source: "a", target: "tail" }, { source: "a", target: "a" }, { source: "missing", target: "a" }, { source: "a", target: "b" }];
    const original = structuredClone({ nodes, edges }), first = tidyCanvasRectPositions(nodes, edges);
    expect([...first.values()].every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    expect(tidyCanvasRectPositions(moved(nodes, first), edges)).toEqual(first);
    expect({ nodes, edges }).toEqual(original);
    assertNoOverlap(nodes, first);
  });

  it("calculates a connected 300-node branching graph within a twenty millisecond warm median", () => {
    const nodes = Array.from({ length: 300 }, (_, index) => rect(`n-${index}`, index * 13 % 1200, index * 29 % 800,
      { width: 200 + index % 3 * 80, height: 120 + index % 3 * 40,
        portCenters: { source: [{ id: "out", y: 60 + index % 3 * 20 }], target: [{ id: "in", y: 58 }] } }));
    const edges: TidyCanvasEdge[] = [];
    for (let layer = 0; layer < 9; layer++) for (let row = 0; row < 30; row++)
      for (const target of [row, (row + 1) % 30]) edges.push({ source: `n-${layer * 30 + row}`, sourceHandle: "out",
        target: `n-${(layer + 1) * 30 + target}`, targetHandle: "in" });
    tidyCanvasRectPositions(nodes, edges);
    const samples = Array.from({ length: 5 }, () => {
      const started = performance.now();
      const positions = tidyCanvasRectPositions(nodes, edges);
      const elapsed = performance.now() - started;
      expect(positions.size).toBe(300);
      return elapsed;
    }).sort((a, b) => a - b);
    console.log(`300-node layout: median ${samples[2]!.toFixed(2)} ms, maximum ${samples[4]!.toFixed(2)} ms`);
    expect(samples[2]).toBeLessThan(20);
  });

  it("balances 300 nodes across many independent workflows within a twenty millisecond warm median", () => {
    const fixture = workflowFixture(145);
    const nodes = [...fixture.nodes, ...Array.from({ length: 10 }, (_, index) =>
      rect(`loose-${index}`, 3000 + index * 40, 60000, { nodeType: "prompt" }))];
    const options = { viewportWidth: 1400, viewportHeight: 800 };
    tidyCanvasRectPositions(nodes, fixture.edges, options);
    const samples = Array.from({ length: 5 }, () => {
      const started = performance.now();
      const positions = tidyCanvasRectPositions(nodes, fixture.edges, options);
      const elapsed = performance.now() - started;
      expect(positions.size).toBe(300);
      return elapsed;
    }).sort((a, b) => a - b);
    console.log(`300-node workflow packing: median ${samples[2]!.toFixed(2)} ms, maximum ${samples[4]!.toFixed(2)} ms`);
    expect(samples[2]).toBeLessThan(20);
  });
});
