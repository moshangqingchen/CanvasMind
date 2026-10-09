import { describe, it, expect } from "vitest";
import { access, readFile } from "node:fs/promises";
import { durationFromProbe, metadataFromProbe, readLocalMediaDuration, readLocalMediaMetadata } from "./media-duration.js";

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
  it("reads real video pixels while ignoring audio and cover art, and keeps unreadable dimensions unknown", () => {
    expect(metadataFromProbe(JSON.stringify({ format: { duration: "9.25" }, streams: [
      { codec_type: "audio", width: 1, height: 1 },
      { codec_type: "video", width: 600, height: 600, disposition: { attached_pic: 1 } },
      { codec_type: "video", width: 1920, height: 1080 },
    ] }))).toEqual({ durationSeconds: 9.25, width: 1920, height: 1080 });
    for (const width of [undefined, "N/A", 0, -1, 1920.5, Infinity])
      expect(metadataFromProbe(JSON.stringify({ format: { duration: "8" }, streams: [{ codec_type: "video", width, height: 1080 }] }))).toEqual({ durationSeconds: 8 });
    expect(metadataFromProbe("invalid")).toEqual({});
  });
  it("measures pixels and duration in one local probe and cleans the temporary file on failure", async () => {
    let input = "", calls = 0;
    expect(await readLocalMediaMetadata(new Uint8Array([4,5]), async file => {
      calls++; input = file;
      expect([...await readFile(file)]).toEqual([4,5]);
      return '{"format":{"duration":"8"},"streams":[{"codec_type":"video","width":1920,"height":1080}]}';
    })).toEqual({ durationSeconds: 8, width: 1920, height: 1080 });
    expect(calls).toBe(1);
    await expect(access(input)).rejects.toThrow();
    expect(await readLocalMediaMetadata(new Uint8Array([6]), async file => { input = file; throw new Error("unreadable"); })).toEqual({});
    await expect(access(input)).rejects.toThrow();
  });
});
