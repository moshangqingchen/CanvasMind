/** Pure path-segment rules shared by desktop storage and browser title checks. */
export function cleanSegment(value: string, fallback: string, maxLength: number): string {
  let cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, "_")
    .slice(0, maxLength)
    .replace(/[. ]+$/gu, "");
  // Windows treats these names as devices even when followed by an extension.
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(cleaned))
    cleaned = `_${cleaned}`.slice(0, maxLength).replace(/[. ]+$/gu, "");
  return cleaned || fallback;
}

export function normalizeProjectName(value: string): string {
  return cleanSegment(value, "未命名项目", 120);
}
