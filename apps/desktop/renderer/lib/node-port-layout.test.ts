import { describe, expect, it } from "vitest";
import { fallbackNodePortY, nodePortTop } from "./node-port-layout";

describe("shared rendered/fallback port placement", () => {
  it("keeps fixed generation inputs and their bottom clearance consistent", () => {
    expect(nodePortTop("image-generation", "input", 1, 3)).toBe("min(100px, calc(100% - 48px))");
    expect(fallbackNodePortY("image-generation", "input", 1, 3, 272)).toBe(101);
    expect(fallbackNodePortY("image-generation", "input", 1, 3, 120)).toBe(71);
    expect(fallbackNodePortY("video-generation", "input", 0, 4, 272)).toBe(59);
    expect(fallbackNodePortY("music-generation", "input", 0, 1, 180)).toBe(59);
    expect(fallbackNodePortY("image-generation", "input", 0, 2, 272, .8)).toBe(58.8);
  });

  it("uses the proportional position for ordinary ports and generation outputs", () => {
    expect(nodePortTop("prompt", "output", 0, 1)).toBe("50%");
    expect(fallbackNodePortY("prompt", "output", 0, 1, 210)).toBe(105);
    expect(fallbackNodePortY("image-generation", "output", 0, 1, 272)).toBe(136);
    expect(fallbackNodePortY("preview", "input", 1, 3, 240)).toBe(120);
  });
});
