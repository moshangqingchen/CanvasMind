import { describe, expect, it, vi } from "vitest";

vi.mock("@super-canvas/storage", () => { throw new Error("Browser title checks must not load the Node storage entry"); });
import { normalizeProjectName, projectTitleKey } from "./project-title";

describe("browser-safe project title identity", () => {
  it.each([
    ["  Demo.  ", "Demo"], ["a/b\\c", "a_b_c"], ["CON.txt", "_CON.txt"], ["...", "未命名项目"],
  ])("preserves existing path normalization for %s", (title, expected) => {
    expect(normalizeProjectName(title)).toBe(expected);
  });
  it("shares NFC, case, cleaning and truncation collisions with storage", () => {
    expect(projectTitleKey("É")).toBe(projectTitleKey("e\u0301"));
    expect(projectTitleKey("a/b")).toBe(projectTitleKey("a\\b"));
    expect(projectTitleKey("X".repeat(121))).toBe(projectTitleKey("x".repeat(120)));
    expect(normalizeProjectName("x".repeat(121))).toHaveLength(120);
  });
});
