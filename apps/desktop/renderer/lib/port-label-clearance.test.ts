import { describe, expect, it } from "vitest";
import { portLabelObscuresCard } from "./port-label-clearance";

describe("port label clearance", () => {
  const neighbor = { left: 100, top: 100, right: 400, bottom: 320 };
  it("yields a label that would cover a neighboring card, including its border", () => {
    expect(portLabelObscuresCard({ left: 390, top: 160, right: 450, bottom: 182 }, [neighbor])).toBe(true);
    expect(portLabelObscuresCard({ left: 401, top: 160, right: 450, bottom: 182 }, [neighbor])).toBe(true);
  });
  it("keeps labels in free gaps and beyond a neighbor's vertical range", () => {
    expect(portLabelObscuresCard({ left: 415, top: 160, right: 470, bottom: 182 }, [neighbor])).toBe(false);
    expect(portLabelObscuresCard({ left: 200, top: 340, right: 260, bottom: 362 }, [neighbor])).toBe(false);
  });
  it("handles fractional zoom geometry without moving cards or ports", () => {
    const label = Object.freeze({ left: 39.9, top: 25.2, right: 54.2, bottom: 32.3 });
    const card = Object.freeze({ left: 54, top: 26, right: 84, bottom: 48 });
    expect(portLabelObscuresCard(label, [card], 0)).toBe(true);
    expect(label.right).toBe(54.2);
  });
});
