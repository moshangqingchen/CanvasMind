import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";

type PreparedAsset = { id: string; kind: string; relativePath: string; sourceSHA256: string; copySHA256: string };
type PreparedManifest = { owner: string; sourceReadOnly: boolean; credentialsCopied: boolean; assets: PreparedAsset[] };
type Dimensions = { width: number; height: number; hasAlpha: boolean };
export type VisualThumbnailEvidence = {
  purpose: "local UI screenshot fixture thumbnail; not upstream generation/output verification";
  source: { preparedRelativePath: string; sourceSHA256: string; copySHA256: string; bytes: number; format: string | null } & Dimensions;
  preview: { format: "png"; sha256: string; bytes: number; hasTransparentPixels: boolean; hasVisiblePixels: boolean } & Dimensions;
  transform: "sharp auto-orient + resize inside 640x480 without enlargement + PNG; original untouched";
};
type VisualPreview = { bytes: Buffer; evidence: VisualThumbnailEvidence };
type VisualFixture = { previews: VisualPreview[]; evidence: {
  mode: "isolated-real-thumbnail-screenshot-only"; assetDirectory: string; sourceManifest: string;
  selection: string; thumbnails: VisualThumbnailEvidence[];
} };

// Keep only one set of at most eight small buffers in this test worker. The
// performance fixture never imports this module when the environment is unset.
let cached: { directory: string; pending: Promise<VisualFixture> } | undefined;
const inside = (root: string, path: string) => path.toLowerCase().startsWith(`${root.toLowerCase()}${sep}`);
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function rejectFormalPath(path: string) {
  if (process.env.LOCALAPPDATA) {
    const formal = resolve(process.env.LOCALAPPDATA, "SuperCanvasDesktop");
    if (path.toLowerCase() === formal.toLowerCase() || inside(formal, path)) throw new Error("Visual fixture refuses the formal desktop profile");
  }
}

/** Consume only the previously prepared read-only P0 copy, never the live profile. */
export function loadPhase3VisualAssets(configuredDirectory: string): Promise<VisualFixture> {
  const configured = resolve(configuredDirectory);
  rejectFormalPath(configured);
  if (cached?.directory === configured) return cached.pending;
  const pending = load(configured);
  cached = { directory: configured, pending };
  void pending.catch(() => { if (cached?.pending === pending) cached = undefined; });
  return pending;
}

async function load(configured: string): Promise<VisualFixture> {
  const assetDirectory = await realpath(configured);
  rejectFormalPath(assetDirectory);
  if (basename(assetDirectory).toLowerCase() !== "assets") throw new Error("UI_PHASE3_VISUAL_ASSET_DIR must point to the prepared fixture assets directory");
  const fixtureDirectory = dirname(assetDirectory);
  const fixturePath = async (relative: string, root = fixtureDirectory) => {
    const requested = resolve(fixtureDirectory, relative);
    rejectFormalPath(requested);
    if (!inside(root, requested)) throw new Error("Visual source path escapes the prepared fixture");
    const path = await realpath(requested);
    rejectFormalPath(path);
    if (!inside(root, path)) throw new Error("Visual source symlink escapes the prepared fixture");
    return path;
  };
  const marker = JSON.parse(await readFile(await fixturePath(".p0-owned-fixture.json"), "utf8")) as { owner?: string; sourceReadOnly?: boolean; providerConfigCopied?: boolean };
  if (marker.owner !== "codex-phase3-p0-real-canvas" || marker.sourceReadOnly !== true || marker.providerConfigCopied !== false)
    throw new Error("Visual sources must be the owned, read-only P0 fixture copy");
  const sourceManifest = await fixturePath("manifest.json");
  const manifest = JSON.parse(await readFile(sourceManifest, "utf8")) as PreparedManifest;
  if (manifest.owner !== marker.owner || manifest.sourceReadOnly !== true || manifest.credentialsCopied !== false || !Array.isArray(manifest.assets))
    throw new Error("Prepared visual manifest is not the credential-free copy");
  const originals = manifest.assets.filter(asset => asset.kind === "image" && /(?:^|\/)original\.[a-z0-9]+$/iu.test(asset.relativePath))
    .sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
  const seen = new Set<string>();
  const selected = originals.filter(asset => {
    if (seen.has(asset.copySHA256)) return false;
    seen.add(asset.copySHA256); return true;
  }).slice(0, 8);
  if (selected.length === 0) throw new Error("Prepared visual fixture has no original images");
  const { default: sharp } = await import("sharp");
  const previews: VisualPreview[] = [];
  for (const asset of selected) {
    const path = await fixturePath(asset.relativePath, assetDirectory);
    const before = await stat(path);
    const original = await readFile(path);
    const originalHash = sha256(original);
    if (originalHash !== asset.copySHA256 || originalHash !== asset.sourceSHA256) throw new Error(`Prepared visual source hash mismatch: ${asset.id}`);
    const source = await sharp(original).metadata();
    if (!source.width || !source.height || (source.pages ?? 1) !== 1) throw new Error(`Visual fixture needs a single-frame image: ${asset.id}`);
    const { data, info } = await sharp(original).rotate().resize({ width: 640, height: 480, fit: "inside", withoutEnlargement: true })
      .png().toBuffer({ resolveWithObject: true });
    const preview = await sharp(data).metadata();
    const alpha = preview.hasAlpha === true ? await sharp(data).stats() : undefined;
    const after = await stat(path);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`Prepared original changed while deriving visual preview: ${asset.id}`);
    if (preview.width !== info.width || preview.height !== info.height || info.width > 640 || info.height > 480)
      throw new Error("Derived visual thumbnail dimensions do not match the actual PNG");
    const evidence: VisualThumbnailEvidence = {
      purpose: "local UI screenshot fixture thumbnail; not upstream generation/output verification",
      source: { preparedRelativePath: asset.relativePath, sourceSHA256: asset.sourceSHA256, copySHA256: originalHash,
        bytes: original.length, format: source.format ?? null, width: source.width, height: source.height, hasAlpha: source.hasAlpha === true },
      preview: { format: "png", sha256: sha256(data), bytes: data.length, width: info.width, height: info.height,
        hasAlpha: preview.hasAlpha === true, hasTransparentPixels: alpha ? !alpha.isOpaque : false,
        hasVisiblePixels: alpha ? alpha.channels[alpha.channels.length - 1]!.max > 0 : true },
      transform: "sharp auto-orient + resize inside 640x480 without enlargement + PNG; original untouched",
    };
    previews.push({ bytes: data, evidence });
  }
  return { previews, evidence: { mode: "isolated-real-thumbnail-screenshot-only", assetDirectory, sourceManifest,
    selection: "At most 8 distinct original SHA-256 values, sorted by prepared relative path; 1050 synthetic assets cycle these previews",
    thumbnails: previews.map(preview => preview.evidence) } };
}
