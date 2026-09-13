import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** Originals downloaded interactively can be staged locally for archive-only recovery. */
export async function readRecoveredArtifact(
  url: string,
  maxBytes: number,
  directory = join(process.cwd(), "data", "artifact-recovery"),
): Promise<{ bytes: Uint8Array; contentType: string } | undefined> {
  const id = createHash("sha256").update(url).digest("hex");
  let manifest: { url?: string; sha256?: string; contentType?: string };
  try {
    const metadataPath = join(directory, `${id}.json`);
    if ((await stat(metadataPath)).size > 4096)
      throw new Error("Recovered artifact manifest is too large");
    manifest = JSON.parse(await readFile(metadataPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (manifest.url !== url || !/^[a-f0-9]{64}$/u.test(manifest.sha256 ?? "") ||
      !/^(?:image|video|audio)\/[a-z0-9.+-]+$/u.test(manifest.contentType ?? ""))
    throw new Error("Recovered artifact manifest does not match the output");
  const path = join(directory, `${id}.bin`);
  if ((await stat(path)).size > maxBytes)
    throw new Error(`Provider output exceeds ${maxBytes} bytes`);
  const bytes = await readFile(path);
  if (bytes.byteLength > maxBytes)
    throw new Error(`Provider output exceeds ${maxBytes} bytes`);
  if (createHash("sha256").update(bytes).digest("hex") !== manifest.sha256)
    throw new Error("Recovered artifact checksum does not match");
  return { bytes: new Uint8Array(bytes), contentType: manifest.contentType! };
}
