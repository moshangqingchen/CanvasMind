import { open, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

function validateThemeSource(source) {
  if (source !== "system" && source !== "light" && source !== "dark")
    throw new TypeError("无效的外观主题");
  return source;
}

/** Accept only Electron's public themeSource enum across the renderer boundary. */
export function applyThemeSource(nativeTheme, source) {
  nativeTheme.themeSource = validateThemeSource(source);
}

export function themeBackground(nativeTheme) {
  return nativeTheme.shouldUseDarkColors ? "#0E0F12" : "#F3F5F7";
}

/** A tiny native mirror lets the startup window match before localStorage loads. */
export async function readThemeSource(root) {
  let file;
  try {
    file = await open(join(root, "appearance.json"), "r");
    const buffer = Buffer.alloc(128);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead === buffer.length) return "system";
    return validateThemeSource(JSON.parse(buffer.toString("utf8", 0, bytesRead)).source);
  } catch { return "system"; }
  finally { await file?.close().catch(() => {}); }
}

export async function saveThemeSource(root, source) {
  validateThemeSource(source);
  await mkdir(root, { recursive: true });
  const temporary = join(root, `.appearance-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify({ source }), { encoding: "utf8", flag: "wx" });
    await rename(temporary, join(root, "appearance.json"));
  } finally { await unlink(temporary).catch(() => {}); }
}
