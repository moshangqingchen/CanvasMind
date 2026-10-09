import type { RemoteArtifact } from "./contracts.js";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Parse image-bearing chat content without turning an ordinary answer into an image URL. */
export function chatImageOutputs(value: unknown, defaultMimeType = "image/png"): RemoteArtifact[] {
  return chatMediaOutputs(value, "image", defaultMimeType);
}

/** Output kind comes from the verified model contract, never from an arbitrary text answer. */
export function chatMediaOutputs(value: unknown, kind: "image" | "video", defaultMimeType = kind === "video" ? "video/mp4" : "image/png"): RemoteArtifact[] {
  const outputs: RemoteArtifact[] = [];
  const identities = new Set<string>();
  const visited = new Set<object>();
  const add = (candidate: string, mimeType = defaultMimeType, explicitBase64 = false): void => {
    const text = candidate.trim();
    const dataUri = new RegExp(`^data:(${kind}/[\\w.+-]+);base64,([A-Za-z0-9+/=\\s]+)$`, "u").exec(text);
    const encoded = dataUri?.[2] ?? (explicitBase64 && mimeType.startsWith(`${kind}/`) ? text : undefined);
    if (encoded) {
      const compact = encoded.replace(/\s/gu, "");
      if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(compact) || compact.length % 4 === 1) return;
      const mime = dataUri?.[1] ?? mimeType;
      const identity = `data:${mime}:${compact}`;
      if (!identities.has(identity)) {
        identities.add(identity);
        outputs.push({ kind, mimeType: mime, data: new Uint8Array(Buffer.from(compact, "base64")) });
      }
      return;
    }
    if (!/^https?:\/\/\S+$/iu.test(text)) return;
    try {
      const url = new URL(text);
      if (url.username || url.password || identities.has(url.href)) return;
      identities.add(url.href);
      outputs.push({ kind, url: url.href });
    } catch { /* Malformed URLs are not image outputs. */ }
  };
  const visit = (item: unknown): void => {
    if (typeof item === "string") {
      const markdown = [...item.matchAll(/(!?)\[([^\]]*)\]\((https?:\/\/[^\s)]+|data:(?:image|video)\/[\w.+-]+;base64,[A-Za-z0-9+/=]+)(?:\s+"[^"]*")?\)/giu)];
      for (const match of markdown) if (match[3] && (kind === "image" ? !!match[1]
        : /^(?:video|视频|生成视频|下载视频|播放视频|video result|generated video|download video)$/iu.test(match[2] ?? "") || /\.(?:mp4|webm|mov|m4v|mkv)(?:$|[?#])/iu.test(match[3]) || match[3].startsWith("data:video/"))) add(match[3]);
      for (const match of item.matchAll(new RegExp(`data:${kind}/[\\w.+-]+;base64,[A-Za-z0-9+/]+={0,2}`, "gu"))) add(match[0]);
      // A plain URL is supported; informational prose and ordinary Markdown links are not images.
      if (!markdown.length) add(item);
      return;
    }
    if (Array.isArray(item)) { for (const nested of item) visit(nested); return; }
    if (!record(item) || visited.has(item)) return;
    visited.add(item);
    const declaredType = typeof item.type === "string" ? item.type : "";
    const oppositeKind = kind === "image" ? "video" : "image";
    if (new RegExp(`^(?:(?:input|output)_)?${oppositeKind}(?:_url)?$`, "iu").test(declaredType)) return;
    const mime = typeof item.mimeType === "string" ? item.mimeType : typeof item.mime_type === "string" ? item.mime_type : defaultMimeType;
    if (typeof item.b64_json === "string") add(item.b64_json, mime, true);
    if (typeof item.url === "string" && mime.startsWith(`${kind}/`)) add(item.url, mime);
    for (const key of [kind === "image" ? "image_url" : "video_url", kind === "image" ? "imageUrl" : "videoUrl", kind, `${kind}s`, "content", "parts", "text"])
      if (item[key] !== undefined) visit(item[key]);
    const inline = item.inlineData ?? item.inline_data;
    if (record(inline) && typeof inline.data === "string") {
      const inlineMime = typeof inline.mimeType === "string" ? inline.mimeType : typeof inline.mime_type === "string" ? inline.mime_type : mime;
      add(inline.data, inlineMime, true);
    }
    const file = item.fileData ?? item.file_data;
    if (record(file)) {
      const uri = file.fileUri ?? file.file_uri;
      const fileMime = typeof file.mimeType === "string" ? file.mimeType : typeof file.mime_type === "string" ? file.mime_type : mime;
      if (typeof uri === "string" && fileMime.startsWith(`${kind}/`)) add(uri);
    }
  };
  visit(value);
  return outputs;
}
