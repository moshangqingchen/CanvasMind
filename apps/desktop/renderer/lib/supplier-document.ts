import { downloadRemoteArtifact } from "@super-canvas/runtime";
import type { ModelDescriptor } from "@super-canvas/providers";

const cache = new Map<string, { expires: number; text: Promise<string | undefined> }>();

/** Supplier documentation is descriptive data; never execute its content. */
export async function readSupplierDocument(siteUrl: string, model: ModelDescriptor): Promise<string | undefined> {
  const raw = model.metadata?.documentationUrl ?? model.metadata?.docsUrl;
  if (typeof raw !== "string") return undefined;
  let url: URL;
  try { url = new URL(raw, siteUrl); } catch { return undefined; }
  if (url.protocol !== "https:" || url.username || url.password) return undefined;
  const cached = cache.get(url.href);
  if (cached && cached.expires > Date.now()) return cached.text;
  const text = (async () => {
    try {
      const response = await downloadRemoteArtifact(url.href, { maxBytes: 512 * 1024, timeoutMs: 8000 });
      return new TextDecoder().decode(response.bytes)
        .replace(/<script[^>]*>.*?<\/script>/gsui, "")
        .replace(/<style[^>]*>.*?<\/style>/gsui, "")
        .replace(/<h([1-6])\b[^>]*>/giu, (_, level: string) => `\n${"#".repeat(Number(level))} `)
        .replace(/<\/(?:p|div|tr|li|h[1-6])>|<br[^>]*>/giu, "\n")
        .replace(/<[^>]+>/gu, " ").slice(0, 48000);
    } catch { return undefined; }
  })();
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(url.href, { expires: Date.now() + 300000, text });
  return text;
}
