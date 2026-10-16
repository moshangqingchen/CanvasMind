import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { APIRequestContext } from "@playwright/test";
import type { CanvasDocument } from "../../components/types";

type RealAsset = {
  id: string; name: string; mimeType: string; kind: string; size: number;
  relativePath: string; metadata: Record<string, unknown>; sourceSHA256: string; copySHA256: string;
};
type RealManifest = {
  canvas: { id: string; title: string; graphFile: string };
  assets: RealAsset[];
};

/** Only the explicitly prepared, credential-free evidence copy is consumed. */
export async function loadRealMemoryFixture(request: APIRequestContext, connectionId: string) {
  const configured = process.env.P0_MEMORY_REAL_FIXTURE_DIR;
  if (!configured) throw new Error("P0_MEMORY_FIXTURE=real requires P0_MEMORY_REAL_FIXTURE_DIR");
  const root = await realpath(configured);
  const pathInFixture = async (relative: string) => {
    const path = await realpath(resolve(root, relative));
    if (!path.toLowerCase().startsWith(`${root.toLowerCase()}${sep}`)) throw new Error("Real fixture path escapes prepared copy");
    return path;
  };
  const manifest = JSON.parse(await readFile(await pathInFixture("manifest.json"), "utf8")) as RealManifest;
  const rawGraph = JSON.parse(await readFile(await pathInFixture(manifest.canvas.graphFile), "utf8")) as CanvasDocument;
  const ids = new Map<string, string>();
  const assets: Array<Record<string, unknown> & { id: string; metadata: Record<string, unknown> }> = [];
  const identity: Array<{ originalId: string; isolatedId: string; originalSha256: string; uploadedSha256: string; size: number }> = [];
  for (const asset of manifest.assets) {
    const bytes = await readFile(await pathInFixture(asset.relativePath));
    const sourceHash = createHash("sha256").update(bytes).digest("hex");
    if (sourceHash !== asset.copySHA256 || sourceHash !== asset.sourceSHA256) throw new Error(`Prepared asset hash mismatch: ${asset.id}`);
    const uploaded = await request.post("/api/assets/upload", { multipart: { file: { name: asset.name, mimeType: asset.mimeType, buffer: bytes } } });
    if (!uploaded.ok()) throw new Error(`Isolated original upload failed: ${uploaded.status()} (${asset.id})`);
    const saved = await uploaded.json() as Record<string, unknown> & { id: string; metadata: Record<string, unknown> };
    await uploaded.dispose();
    // Read the immutable original endpoint, never the archive-producing download route.
    const content = await request.get(`/api/assets/${saved.id}/content`);
    if (!content.ok()) throw new Error(`Isolated original read failed: ${content.status()}`);
    const uploadedHash = createHash("sha256").update(await content.body()).digest("hex");
    await content.dispose();
    if (uploadedHash !== sourceHash) throw new Error(`Upload changed original bytes: ${asset.id}`);
    ids.set(asset.id, saved.id);
    // The standard upload API records upload provenance. Preserve the prepared
    // original dimensions/alpha/result metadata in renderer GET responses only.
    assets.push({ ...saved, metadata: { ...saved.metadata, ...asset.metadata } });
    identity.push({ originalId: asset.id, isolatedId: saved.id, originalSha256: sourceHash, uploadedSha256: uploadedHash, size: bytes.length });
  }
  const remap = (value: unknown): unknown => {
    if (typeof value === "string") return ids.get(value) ?? (value === "p0-isolated-fake-connection" ? connectionId : value);
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)]));
    return value;
  };
  const graph = remap(rawGraph) as CanvasDocument;
  let mappedGenerators = 0;
  for (const node of graph.nodes) {
    if (["image-generation", "video-generation", "audio-generation", "text-generation", "music-generation"].includes(node.data.nodeType ?? "")) {
      node.data.provider = "fake";
      node.data.connectionId = connectionId;
      node.data.model = node.data.nodeType === "video-generation" ? "fake-video-v1" : node.data.nodeType === "audio-generation" || node.data.nodeType === "music-generation" ? "fake-audio-v1" : "fake-image-v1";
      mappedGenerators++;
    }
  }
  const remappedAssets = remap(assets) as typeof assets;
  return { graph, assets: remappedAssets, imageIds: remappedAssets.filter(asset => asset.kind === "image").map(asset => asset.id),
    evidence: { source: "read-only prepared real canvas graph and exact original local media", sourceCanvasId: manifest.canvas.id,
      nodes: graph.nodes.length, edges: graph.edges.length, assets: assets.length, images: remappedAssets.filter(asset => asset.kind === "image").length,
      generatedResults: graph.nodes.filter(node => node.data.generatedResult).length, mappedGenerators, providerMapping: "Every generation node is isolated Fake; original model identity is not execution configuration",
      metadata: "Original safe metadata overlaid in browser asset GET responses; native production content and preview endpoints serve the byte-identical uploaded original",
      viewport: graph.viewport, originalBytesVerified: true, identity } };
}
