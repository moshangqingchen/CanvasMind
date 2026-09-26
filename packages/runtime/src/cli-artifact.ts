import { open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

function inside(root: string, path: string): boolean {
  const part = relative(root, path);
  return Boolean(part) && !isAbsolute(part) && part !== ".." && !part.startsWith(`..\\`) && !part.startsWith("../");
}

/** Recheck both the declared task directory and its real path before opening a CLI output. */
export async function consumeCliArtifact<T>(
  file: { path: string; root: string },
  expectedRoot: string,
  maxBytes: number,
  consume: (chunks: AsyncIterable<Uint8Array>) => Promise<T>,
): Promise<T> {
  const expected = resolve(expectedRoot);
  const realBase = await realpath(dirname(dirname(expected)));
  const canonicalExpected = join(realBase, basename(dirname(expected)), basename(expected));
  const declared = resolve(file.root);
  if ((relative(declared, expected) !== "" && relative(declared, canonicalExpected) !== "") || !inside(declared, resolve(file.path)))
    throw new Error("CLI 输出文件不属于当前任务的输出目录");
  const [realRoot, realFile] = await Promise.all([realpath(expected), realpath(file.path)]);
  // A replaced/symlinked output directory must never authorize a different task or user file.
  if (relative(realRoot, canonicalExpected) !== "" || !inside(realRoot, realFile))
    throw new Error("CLI 输出文件路径越界");
  const handle = await open(realFile, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0) throw new Error("CLI 输出不是有效的非空文件");
    if (stat.size > maxBytes) throw new Error(`Provider output exceeds ${maxBytes} bytes`);
    async function* chunks(): AsyncIterable<Uint8Array> {
      let total = 0;
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        total += chunk.byteLength;
        if (total > maxBytes) throw new Error(`Provider output exceeds ${maxBytes} bytes`);
        yield chunk;
      }
    }
    return await consume(chunks());
  } finally {
    await handle.close();
  }
}
