import { isAbsolute, join } from "node:path";

/** Installed media validation must never depend on the user's system PATH. */
export function mediaToolEnvironment(runtime) {
  if (!isAbsolute(runtime)) throw new Error("Media tools require an absolute runtime directory");
  return {
    SUPERCANVAS_FFMPEG_PATH: join(runtime, "media-tools", "bin", "ffmpeg.exe"),
    SUPERCANVAS_FFPROBE_PATH: join(runtime, "media-tools", "bin", "ffprobe.exe"),
  };
}
