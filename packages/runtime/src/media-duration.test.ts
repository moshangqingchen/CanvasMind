import { describe, it, expect } from "vitest";
import { access, readFile } from "node:fs/promises";
import { durationFromProbe, readLocalMediaDuration } from "./media-duration.js";

describe("verified local reference duration", () => {
  it("uses format duration, falls back to the longest stream, and rejects unknown lengths", () => {
    expect(durationFromProbe('{"format":{"duration":"12.125"}}')).toBe(12.125);
    expect(durationFromProbe('{"format":{"duration":"N/A"},"streams":[{"duration":"2"},{"duration":"4.5"}]}')).toBe(4.5);
    expect(durationFromProbe('{"format":{"duration":"Infinity"}}')).toBeUndefined();
    expect(durationFromProbe("invalid")).toBeUndefined();
  });
  it("hands only a temporary local file to the probe and cleans it on success and failure", async () => {
    let input = "";
    expect(await readLocalMediaDuration(new Uint8Array([1,2]), async file => {
      input = file;
      expect([...await readFile(file)]).toEqual([1,2]);
      return '{"format":{"duration":"3.5"}}';
    })).toBe(3.5);
    await expect(access(input)).rejects.toThrow();
    expect(await readLocalMediaDuration(new Uint8Array([3]), async file => { input = file; throw new Error("unreadable"); })).toBeUndefined();
    await expect(access(input)).rejects.toThrow();
  });
});
