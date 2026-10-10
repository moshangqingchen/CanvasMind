import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { mediaToolEnvironment } from "../src/media-tools.mjs";

const execute = promisify(execFile);
const desktop = fileURLToPath(new URL("../", import.meta.url));
const workspace = resolve(desktop, "../..");
const lockPath = join(desktop, "media-tools-lock.json");
export const mediaToolsLock = JSON.parse(await readFile(lockPath, "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
async function removeTemporaryDirectory(directory, cacheRoot) {
  const target = resolve(directory);
  const withinCache = relative(resolve(cacheRoot), target);
  assert.ok(withinCache && !withinCache.startsWith("..") && !isAbsolute(withinCache), "Temporary media directory must remain within its cache");
  await rm(target, { recursive: true, force: true });
}

export function validateMediaArchive(bytes, lock = mediaToolsLock) {
  assert.equal(sha256(bytes), lock.sha256, "Media tools archive must match its pinned SHA256");
}

export function validateMediaArchiveEntries(entries, root = mediaToolsLock.archiveRoot) {
  assert.ok(entries.length > 0, "Media tools archive cannot be empty");
  for (const entry of entries) {
    const parts = entry.replaceAll("\\", "/").replace(/\/$/u, "").split("/");
    assert.ok(parts[0] === root && parts.every(part => part && part !== "." && part !== ".." && !part.includes(":")),
      `Unsafe media tools archive entry: ${entry}`);
  }
}

/** Downloaded only while building; never fetch executable code on app startup. */
export async function stageMediaTools(stage, { cacheRoot = join(workspace, ".codex-temp", "media-tools-cache") } = {}) {
  assert.equal(process.platform, "win32");
  assert.equal(process.arch, "x64");
  assert.ok(isAbsolute(stage), "Staging requires an absolute directory");
  await mkdir(cacheRoot, { recursive: true });
  const archive = join(cacheRoot, `${mediaToolsLock.sha256}.zip`);
  let bytes;
  try { bytes = await readFile(archive); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (bytes) validateMediaArchive(bytes);
  else {
    const response = await fetch(mediaToolsLock.url, { signal: AbortSignal.timeout(600_000) });
    if (!response.ok || !response.body) throw new Error(`Media tools download failed: HTTP ${response.status}`);
    const downloadDirectory = await mkdtemp(join(cacheRoot, "download-"));
    try {
      const download = join(downloadDirectory, "archive.zip");
      await pipeline(response.body, createWriteStream(download, { flags: "wx" }));
      bytes = await readFile(download);
      validateMediaArchive(bytes);
      await writeFile(archive, bytes);
    } finally { await removeTemporaryDirectory(downloadDirectory, cacheRoot); }
  }
  const extraction = await mkdtemp(join(cacheRoot, "extract-"));
  try {
    const tar = join(process.env.SystemRoot || process.env.WINDIR || "C:\\Windows", "System32", "tar.exe");
    const listing = await execute(tar, ["-tf", archive], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    validateMediaArchiveEntries(listing.stdout.trim().split(/\r?\n/u));
    await execute(tar, ["-xf", archive, "-C", extraction], { windowsHide: true, timeout: 120_000 });
    const source = join(extraction, mediaToolsLock.archiveRoot);
    const target = join(stage, "media-tools");
    assert.equal(relative(stage, target), "media-tools");
    await mkdir(target, { recursive: true });
    await cp(join(source, "bin"), join(target, "bin"), { recursive: true,
      filter: path => !path.endsWith("ffplay.exe") });
    for (const name of await readdir(source)) {
      if (/^(?:LICENSE|COPYING|README)(?:\.|$)/iu.test(name))
        await cp(join(source, name), join(target, name), { recursive: true });
    }
    assert.ok((await readdir(target)).some(name => /^(?:LICENSE|COPYING)/iu.test(name)), "Media license is required");
    // LGPLv3 incorporates GPLv3; distribute both complete license texts.
    await cp(join(desktop, "assets/licenses/FFmpeg-COPYING.GPLv3"), join(target, "COPYING.GPLv3"));
    await cp(lockPath, join(target, "manifest.json"));
    await cp(join(workspace, "packages/runtime/tests/fixtures/video-with-audio.webm"), join(target, "verification-with-audio.webm"));
    await writeFile(join(target, "SOURCE-NOTICE.txt"), [
      `FFmpeg ${mediaToolsLock.version} (BtbN Windows x64 LGPL shared build)`,
      "These unmodified command-line tools run as separate processes to inspect original local media.",
      "FFmpeg and the bundled libraries retain their respective copyrights and licenses.",
      `FFmpeg source: ${mediaToolsLock.sourceUrl}`,
      `Build recipes, dependency source URLs and patches: ${mediaToolsLock.buildSourceUrl}`,
      `Original distribution: ${mediaToolsLock.url}`,
      `Original distribution SHA256: ${mediaToolsLock.sha256}`,
      "Configure options and dependency versions are available using bin/ffmpeg.exe -version.",
      "The shared DLLs remain replaceable; the application does not link FFmpeg into its JavaScript code.", "",
    ].join("\n"));
    return verifyMediaTools(stage);
  } finally { await removeTemporaryDirectory(extraction, cacheRoot); }
}

/** Decode real offline video with no system search path; fails the build if DLLs/tools are missing. */
export async function verifyMediaTools(runtime) {
  const paths = mediaToolEnvironment(runtime);
  const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP, PATH: "" };
  const options = { env, windowsHide: true, timeout: 30_000, maxBuffer: 256 * 1024 };
  const versions = {};
  for (const [name, executable] of [["ffmpeg", paths.SUPERCANVAS_FFMPEG_PATH], ["ffprobe", paths.SUPERCANVAS_FFPROBE_PATH]]) {
    const output = (await execute(executable, ["-version"], options)).stdout;
    assert.ok(output.includes(mediaToolsLock.version), `${name} must use the pinned version`);
    assert.ok(!output.includes("--enable-gpl") && !output.includes("--enable-nonfree"), "Only LGPL media tools can be staged");
    versions[name] = output.split(/\r?\n/u)[0];
  }
  const fixture = join(runtime, "server/packages/providers/examples/fixtures/sample-480p-2-landscape.webm");
  const probe = JSON.parse((await execute(paths.SUPERCANVAS_FFPROBE_PATH, ["-v", "error", "-protocol_whitelist", "file", "-show_streams", "-show_format", "-of", "json", fixture], options)).stdout);
  const video = probe.streams.find(stream => stream.codec_type === "video");
  assert.equal(video.width, 854);
  assert.equal(video.height, 480);
  assert.ok(Math.abs(Number(probe.format.duration) - 2) < 0.1);
  await execute(paths.SUPERCANVAS_FFMPEG_PATH, ["-nostdin", "-v", "error", "-xerror", "-protocol_whitelist", "file", "-i", fixture, "-map", "0:V:0", "-an", "-f", "null", "-"], options);
  const audioFixture = join(runtime, "media-tools/verification-with-audio.webm");
  const audio = await execute(paths.SUPERCANVAS_FFMPEG_PATH, ["-nostdin", "-v", "info", "-xerror", "-protocol_whitelist", "file", "-i", audioFixture, "-map", "0:a:0", "-vn", "-af", "volumedetect", "-f", "null", "-"], options);
  const level = /mean_volume:\s*(-?[\d.]+)\s*dB/u.exec(audio.stderr);
  assert.ok(level && Number(level[1]) > -80, "Bundled tools must decode and measure the offline audible audio fixture");
  const licenseNames = await readdir(join(runtime, "media-tools"));
  assert.ok(licenseNames.some(name => /^(?:LICENSE|COPYING)/iu.test(name)));
  assert.ok((await readFile(join(runtime, "media-tools/COPYING.GPLv3"), "utf8")).includes("GNU GENERAL PUBLIC LICENSE"));
  assert.ok((await readFile(join(runtime, "media-tools/SOURCE-NOTICE.txt"), "utf8")).includes(mediaToolsLock.sourceUrl));
  return { ...versions, width: video.width, height: video.height, duration: Number(probe.format.duration), decoded: true, meanVolumeDb: Number(level[1]), systemPath: "empty" };
}
