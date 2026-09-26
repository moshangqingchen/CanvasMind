import { describe, expect, it } from "vitest";
import { nodeConfigPosition } from "./node-config-position";

describe("nodeConfigPosition", () => {
  const viewport = { left: 0, top: 76, right: 900, bottom: 700 };

  it("keeps a normal inspector below the node", () => {
    expect(nodeConfigPosition({ left: 120, top: 140, right: 520, bottom: 300 }, viewport)).toEqual({
      left: 120,
      top: 310,
      width: 400,
      height: 390,
    });
  });

  it("opens above a node near the bottom edge", () => {
    const result = nodeConfigPosition({ left: 120, top: 570, right: 520, bottom: 660 }, viewport);
    expect(result).toEqual({ left: 120, top: 76, width: 400, height: 484 });
    expect(result.top).toBeGreaterThanOrEqual(viewport.top);
    expect(result.top + result.height).toBeLessThanOrEqual(viewport.bottom);
  });

  it("clamps a wide node to the available viewport", () => {
    expect(nodeConfigPosition({ left: -80, top: 120, right: 1100, bottom: 240 }, viewport)).toMatchObject({
      left: 0,
      width: 900,
    });
  });
});
