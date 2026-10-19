import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { webmMediaKind } from "./webm-media.js";

const directories: string[] = [];
function element(id: number[], bytes: Buffer) {
  const size = bytes.length < 127 ? Buffer.from([0x80 | bytes.length]) : Buffer.from([0x40 | bytes.length >>> 8, bytes.length & 255]);
  return Buffer.concat([Buffer.from(id), size, bytes]);
}
export function webmFixture(types: number[]) {
  const tracks = element([0x16, 0x54, 0xae, 0x6b], Buffer.concat(types.map(type => element([0xae], element([0x83], Buffer.from([type]))))));
  return Buffer.concat([element([0x1a, 0x45, 0xdf, 0xa3], Buffer.alloc(0)), element([0x18, 0x53, 0x80, 0x67], tracks)]);
}
async function inspect(bytes: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), "supercanvas-webm-type-")); directories.push(directory);
  const file = join(directory, "input.webm"); await writeFile(file, bytes);
  const handle = await open(file, "r");
  try { return await webmMediaKind(handle, bytes.length); } finally { await handle.close(); }
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe("bounded WebM track inspection", () => {
  it("recognizes audio-only WebM", async () => { expect(await inspect(webmFixture([2]))).toBe("audio"); });
  it.each([[1], [2, 1]])("recognizes a video track in %s", async (...types) => { expect(await inspect(webmFixture(types))).toBe("video"); });
  it("leaves missing, malformed and unsupported tracks unknown", async () => {
    for (const bytes of [Buffer.from("HTML error page"), webmFixture([]), webmFixture([17]), webmFixture([2]).subarray(0, 12)]) expect(await inspect(bytes)).toBeUndefined();
  });
  it("does not mistake a track-like byte sequence in an unrelated element for Tracks", async () => {
    const payload = element([0x1f, 0x43, 0xb6, 0x75], webmFixture([1]));
    const file = Buffer.concat([element([0x1a, 0x45, 0xdf, 0xa3], Buffer.alloc(0)), element([0x18, 0x53, 0x80, 0x67], payload)]);
    expect(await inspect(file)).toBeUndefined();
  });
  it("skips a large declared payload instead of buffering it to find later Tracks", async () => {
    const payload = Buffer.concat([element([0xec], Buffer.alloc(12_000)), webmFixture([2]).subarray(10)]);
    const bytes = Buffer.concat([element([0x1a, 0x45, 0xdf, 0xa3], Buffer.alloc(0)), element([0x18, 0x53, 0x80, 0x67], payload)]);
    const directory = await mkdtemp(join(tmpdir(), "supercanvas-webm-skip-")); directories.push(directory);
    const file = join(directory, "large.webm"); await writeFile(file, bytes);
    const handle = await open(file, "r");
    try {
      const read = vi.spyOn(handle, "read");
      expect(await webmMediaKind(handle, bytes.length)).toBe("audio");
      const results = await Promise.all(read.mock.results.map(result => result.value));
      expect(results.reduce((sum, result) => sum + result.bytesRead, 0)).toBeLessThan(128);
    } finally { await handle.close(); }
  });
});
