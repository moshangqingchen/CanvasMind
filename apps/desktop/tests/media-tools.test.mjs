import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { mediaToolEnvironment } from "../src/media-tools.mjs";
import { validateMediaArchive, validateMediaArchiveEntries } from "../scripts/media-tools.mjs";

test("packaged media validation resolves bundled executables, including paths with spaces", () => {
  const runtime = resolve("installed runtime");
  assert.deepEqual(mediaToolEnvironment(runtime), {
    SUPERCANVAS_FFMPEG_PATH: join(runtime, "media-tools/bin/ffmpeg.exe"),
    SUPERCANVAS_FFPROBE_PATH: join(runtime, "media-tools/bin/ffprobe.exe"),
  });
  assert.throws(() => mediaToolEnvironment("relative/runtime"), /absolute/u);
});

test("the pinned archive rejects altered bytes before executable extraction", () => {
  const bytes = Buffer.from("verified archive fixture");
  const lock = { sha256: createHash("sha256").update(bytes).digest("hex") };
  validateMediaArchive(bytes, lock);
  assert.throws(() => validateMediaArchive(Buffer.from("changed archive"), lock), /pinned SHA256/u);
});

test("archive paths cannot escape their pinned root", () => {
  validateMediaArchiveEntries(["ffmpeg/bin/ffmpeg.exe", "ffmpeg/LICENSE.txt", "ffmpeg/bin/"], "ffmpeg");
  for (const path of ["../outside", "ffmpeg/../../outside", "ffmpeg/bin/../outside", "C:/ffmpeg", "/ffmpeg/bin", "ffmpeg/C:/escape", "other/bin/tool"])
    assert.throws(() => validateMediaArchiveEntries([path], "ffmpeg"), /Unsafe/u);
  assert.throws(() => validateMediaArchiveEntries([], "ffmpeg"), /empty/u);
});
