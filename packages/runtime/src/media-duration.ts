import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
export interface LocalMediaMetadata { durationSeconds?: number; width?: number; height?: number; }
const cache = new Map<string, LocalMediaMetadata>();
type Probe = (file: string) => Promise<string>;
const probe: Probe = async file => (await execute(process.env.SUPERCANVAS_FFPROBE_PATH || "ffprobe", [
  "-v", "error", "-protocol_whitelist", "file", "-show_entries", "format=duration:stream=duration,codec_type,width,height:stream_disposition=attached_pic", "-of", "json", file,
], { timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true })).stdout;

export function durationFromProbe(text: string): number | undefined {
  try {
    const result = JSON.parse(text) as { format?: { duration?: unknown }; streams?: { duration?: unknown }[] };
    const format = Number(result.format?.duration);
    if (Number.isFinite(format) && format > 0) return format;
    const streams = (result.streams ?? []).map(s => Number(s.duration)).filter(n => Number.isFinite(n) && n > 0);
    return streams.length ? Math.max(...streams) : undefined;
  } catch { return undefined; }
}

export function metadataFromProbe(text: string): LocalMediaMetadata {
  const durationSeconds = durationFromProbe(text);
  try {
    const result = JSON.parse(text) as { streams?: { codec_type?: unknown; width?: unknown; height?: unknown; disposition?: { attached_pic?: unknown } }[] };
    const video = result.streams?.find(stream => stream.codec_type === "video" && Number(stream.disposition?.attached_pic) !== 1);
    const width = Number(video?.width), height = Number(video?.height);
    return { ...(durationSeconds === undefined ? {} : { durationSeconds }),
      ...(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0 ? { width, height } : {}) };
  } catch { return {}; }
}

/** Probe local bytes once. Unreadable duration or dimensions remain unknown. */
export async function readLocalMediaMetadata(bytes: Uint8Array, run: Probe = probe): Promise<LocalMediaMetadata> {
  const fingerprint = createHash("sha256").update(bytes).digest("hex");
  if (run === probe && cache.has(fingerprint)) return { ...cache.get(fingerprint)! };
  const directory = await mkdtemp(join(tmpdir(), "supercanvas-media-duration-"));
  const file = join(directory, "input.bin");
  try {
    await writeFile(file, bytes);
    const metadata = metadataFromProbe(await run(file));
    if (Object.keys(metadata).length && run === probe) {
      if (cache.size >= 64) cache.delete(cache.keys().next().value!);
      cache.set(fingerprint, metadata);
    }
    return metadata;
  } catch { return {}; }
  finally { await unlink(file).catch(() => {}); await rmdir(directory).catch(() => {}); }
}

/** Compatibility wrapper for callers requiring only a measured duration. */
export async function readLocalMediaDuration(bytes: Uint8Array, run: Probe = probe): Promise<number | undefined> {
  return (await readLocalMediaMetadata(bytes, run)).durationSeconds;
}
