import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const cache = new Map<string, number>();
type Probe = (file: string) => Promise<string>;
const probe: Probe = async file => (await execute(process.env.SUPERCANVAS_FFPROBE_PATH || "ffprobe", [
  "-v", "error", "-protocol_whitelist", "file", "-show_entries", "format=duration:stream=duration", "-of", "json", file,
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

/** Probe local bytes only. Unreadable durations stay unknown instead of being guessed. */
export async function readLocalMediaDuration(bytes: Uint8Array, run: Probe = probe): Promise<number | undefined> {
  const fingerprint = createHash("sha256").update(bytes).digest("hex");
  if (run === probe && cache.has(fingerprint)) return cache.get(fingerprint);
  const directory = await mkdtemp(join(tmpdir(), "supercanvas-media-duration-"));
  const file = join(directory, "input.bin");
  try {
    await writeFile(file, bytes);
    const duration = durationFromProbe(await run(file));
    if (duration !== undefined && run === probe) {
      if (cache.size >= 64) cache.delete(cache.keys().next().value!);
      cache.set(fingerprint, duration);
    }
    return duration;
  } catch { return undefined; }
  finally { await unlink(file).catch(() => {}); await rmdir(directory).catch(() => {}); }
}
