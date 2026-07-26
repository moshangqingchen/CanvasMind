const MEDIA_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
};

const SUPPORTED_MEDIA_MIME_TYPES = new Set(
  Object.values(MEDIA_MIME_BY_EXTENSION),
);

export function normalizeDraggedMediaFile(file: File): File | null {
  const declaredType = file.type.trim().toLowerCase();
  if (SUPPORTED_MEDIA_MIME_TYPES.has(declaredType)) return file;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const inferredType = MEDIA_MIME_BY_EXTENSION[extension];
  if (!inferredType) return null;
  return new File([file], file.name, {
    type: inferredType,
    lastModified: file.lastModified,
  });
}
