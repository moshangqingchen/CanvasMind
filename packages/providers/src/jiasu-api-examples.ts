import { createHash } from "node:crypto";
import type { FetchImplementation } from "./contracts.js";
import { fetchProviderBytes } from "./http.js";
import type { JiasuVideoApiExampleTemplate } from "./jiasu-api-example-contract.js";
export { jiasuVideoApiExampleContract } from "./jiasu-api-example-contract.js";
export type { JiasuVideoApiExampleTemplate, JiasuVideoApiExampleContract } from "./jiasu-api-example-contract.js";

const JIASU_ORIGIN = "https://ai.jiasuapi.com";
/** Parse only literal example values; never execute code from the supplier. */
export function parseJiasuVideoApiExampleTemplate(source: string, sourceUrl: string, checkedAt: string): JiasuVideoApiExampleTemplate | undefined {
  let url: URL;
  try { url = new URL(sourceUrl); } catch { return undefined; }
  if (url.origin !== JIASU_ORIGIN || !/^\/static\/js\/index\.[\da-f]+\.js$/u.test(url.pathname) || url.search || url.hash) return undefined;
  const branch = /if\("openai-video"===[a-zA-Z_$][\w$]*\)/u.exec(source);
  if (!branch) return undefined;
  const section = source.slice(branch.index, branch.index + 16_384);
  const object = /JSON\.stringify\(\{(model:[a-zA-Z_$][\w$]*\.modelName,[^{}]{1,4096})\},null,2\)/u.exec(section);
  const body = object && /\bduration:(\d+),ratio:"([^"\n]{1,64})",resolution:"([^"\n]{1,64})"/u.exec(object[1]!);
  if (!body || !section.includes("/v1/videos/tasks") || !section.includes("Authorization: Bearer") || !section.includes("Content-Type: application/json")) return undefined;
  const duration = Number(body[1]);
  if (!Number.isInteger(duration) || duration <= 0) return undefined;
  return { sourceUrl: url.href, checkedAt, sourceSha256: createHash("sha256").update(source).digest("hex"),
    sourceStatus: "live", templateKind: "model-plaza-openai-video", pollPath: "/v1/videos/tasks/{task_id}",
    values: { duration, ratio: body[2]!, resolution: body[3]! },
    fields: [...new Set([...object![1]!.matchAll(/(?:^|,)\s*([a-zA-Z][a-zA-Z\d_]{0,63}):/gu)].map(match => match[1]!))] };
}

/** One public HTML + bounded JS read per discovery. No account headers or cache. */
export async function readJiasuVideoApiExampleTemplate(fetchImpl: FetchImplementation, checkedAt: string,
  signal?: AbortSignal): Promise<JiasuVideoApiExampleTemplate | undefined> {
  const read = async (url: string, maxResponseBytes: number, timeoutMs: number) => {
    const result = await fetchProviderBytes((input, init) => fetchImpl(input, { ...init, cache: "no-store" }), url,
      { phase: "connect", timeoutMs, maxResponseBytes, ...(signal ? { signal } : {}) });
    return new TextDecoder().decode(result.data);
  };
  try {
    const html = await read(`${JIASU_ORIGIN}/`, 512 * 1024, 8_000);
    const paths = [...html.matchAll(/<script\b[^>]*\bsrc=["'](\/static\/js\/index\.[\da-f]+\.js)["']/giu)].map(match => match[1]!);
    for (const path of [...new Set(paths)].slice(0, 2)) {
      const sourceUrl = `${JIASU_ORIGIN}${path}`;
      // The current official bundle is 5 MB; the production direct route can
      // need over eight seconds for its body after receiving HTTP 200 headers.
      const template = parseJiasuVideoApiExampleTemplate(await read(sourceUrl, 8 * 1024 * 1024, 30_000), sourceUrl, checkedAt);
      if (template) return template;
    }
  } catch { /* A partial docs read must not erase the current model/price feed. */ }
  return undefined;
}
