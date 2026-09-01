import { describe, expect, it, vi } from "vitest";
import {
  NODE_CONFIG_INTERACTIVE_SELECTOR,
  shouldReselectNodeFromConfigPointer,
} from "./node-config-pointer";

describe("node config pointer handling", () => {
  it("does not reselect the node for a native model select", () => {
    const closest = vi.fn(() => ({ tagName: "SELECT" }));

    expect(shouldReselectNodeFromConfigPointer({ closest })).toBe(false);
    expect(closest).toHaveBeenCalledWith(NODE_CONFIG_INTERACTIVE_SELECTOR);
  });

  it("keeps blank popover space selectable", () => {
    expect(
      shouldReselectNodeFromConfigPointer({ closest: () => null }),
    ).toBe(true);
    expect(shouldReselectNodeFromConfigPointer(null)).toBe(true);
  });
});
