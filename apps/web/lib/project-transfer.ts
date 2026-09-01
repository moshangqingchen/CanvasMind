import { validateGraph } from "@super-canvas/core";
import { Unzip, UnzipInflate, Zip, ZipPassThrough, strToU8 } from "fflate";
import { z } from "zod";

import type {
  AssetView,
  CanvasDocument,
  CanvasEdge,
  CanvasNode,
} from "../components/types";
import { CanvasGraphSchema } from "./api-validation";

export const PROJECT_PACKAGE_FORMAT = "super-canvas-project";
export const PROJECT_PACKAGE_VERSION = 1;
export const PROJECT_PACKAGE_EXTENSION = ".supercanvas";
export const PROJECT_JSON_FORMAT = "super-canvas-project-json";
export const PROJECT_JSON_VERSION = 1;
export const MAX_PROJECT_JSON_BYTES = 8 * 1024 * 1024;
export const MAX_PROJECT_PACKAGE_BYTES = 512 * 1024 * 1024;
const MAX_PACKAGE_ASSETS = 1_000;
const MAX_PACKAGE_ENTRIES = MAX_PACKAGE_ASSETS + 1;
const MAX_PACKAGE_PATH_LENGTH = 256;
const MAX_ASSET_ID_LENGTH = 128;
const MAX_GRAPH_ASSET_REFERENCES = 5_000;
const MAX_ASSET_REFERENCES_PER_FIELD = 1_000;
const MAX_PORTS_PER_NODE = 128;
const MAX_GRAPH_PORTS = 2_000;
const MAX_COMPRESSION_RATIO = 100;
const COMPRESSION_RATIO_GRACE_BYTES = 1024 * 1024;
const ZIP_READ_CHUNK_BYTES = 1024 * 1024;
const MANIFEST_PATH = "manifest.json";
const PROJECT_GRAPH_SCHEMA_VERSION = 1;

const AssetIdSchema = z
  .string()
  .min(1)
  .max(MAX_ASSET_ID_LENGTH)
  .refine((value) => value === value.trim(), "素材 ID 前后不能包含空白")
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/u.test(value),
    "素材 ID 包含控制字符",
  );

const PackagePathSchema = z
  .string()
  .min(1)
  .max(MAX_PACKAGE_PATH_LENGTH)
  .refine((value) => value === value.trim(), "素材路径前后不能包含空白");

const PackageAssetSchema = z
  .object({
    id: AssetIdSchema,
    name: z.string().trim().min(1).max(512),
    kind: z.enum(["image", "video", "audio"]),
    mimeType: z.string().trim().min(1).max(255),
    size: z.number().int().positive().max(MAX_PROJECT_PACKAGE_BYTES),
    path: PackagePathSchema,
  })
  .strict();

const PackageManifestSchema = z
  .object({
    format: z.literal(PROJECT_PACKAGE_FORMAT),
    version: z.literal(PROJECT_PACKAGE_VERSION),
    exportedAt: z.string().datetime({ offset: true }),
    title: z.string().trim().min(1).max(160),
    graph: CanvasGraphSchema,
    assets: z.array(PackageAssetSchema).max(MAX_PACKAGE_ASSETS),
  })
  .strict();

export interface ProjectPackageAsset {
  id: string;
  name: string;
  kind: Exclude<AssetView["kind"], "text">;
  mimeType: string;
  size: number;
  path: string;
}

export interface PreparedProjectImport {
  source: "json" | "package";
  title: string;
  graph: CanvasDocument;
  referencedAssetIds: string[];
  missingAssetIds: string[];
  packageAssets: ProjectPackageAsset[];
  packageFiles: Map<string, Blob>;
}

export interface PortableProjectExportInput {
  title: string;
  graph: CanvasDocument;
  assets: AssetView[];
  fetchAsset?: (assetId: string) => Promise<Response>;
  onProgress?: (completed: number, total: number) => void;
}

export class ProjectAssetUploadError extends Error {
  readonly uploadedAssets: readonly AssetView[];
  readonly failedAsset: ProjectPackageAsset;

  constructor(
    cause: unknown,
    uploadedAssets: readonly AssetView[],
    failedAsset: ProjectPackageAsset,
  ) {
    super(cause instanceof Error ? cause.message : "素材导入失败", { cause });
    this.name = "ProjectAssetUploadError";
    this.uploadedAssets = [...uploadedAssets];
    this.failedAsset = failedAsset;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeTitle(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  const title = candidate || fallback.trim() || "超级画布项目";
  if (title.length > 160) throw new Error("项目名称不能超过 160 个字符");
  return title;
}

function assertAssetId(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ASSET_ID_LENGTH ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${label}中的素材 ID 无效`);
  }
}

function assertAssetIdArray(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error(`${label}必须是素材 ID 数组`);
  if (value.length > MAX_ASSET_REFERENCES_PER_FIELD)
    throw new Error(`${label}包含的素材引用过多`);
  for (const id of value) assertAssetId(id, label);
}

function assertPromptAssetIds(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error(`${label}必须是 Prompt 数组`);
  if (value.length > MAX_ASSET_REFERENCES_PER_FIELD)
    throw new Error(`${label}包含的 Prompt 片段过多`);
  for (const part of value) {
    if (isRecord(part) && part.type === "asset")
      assertAssetId(part.assetId, label);
  }
}

function portCollectionSize(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  return isRecord(value) ? Object.keys(value).length : 0;
}

function assertGraphTransferLimits(graph: CanvasDocument): void {
  let totalPorts = 0;
  for (const node of graph.nodes as CanvasNode[]) {
    const nodeRecord = node as unknown as Record<string, unknown>;
    const data: Record<string, unknown> = isRecord(node.data) ? node.data : {};
    let nodePorts = 0;
    for (const container of [nodeRecord, data]) {
      for (const key of ["inputs", "outputs", "inputPorts", "outputPorts"]) {
        nodePorts += portCollectionSize(container[key]);
      }
    }
    if (nodePorts > MAX_PORTS_PER_NODE)
      throw new Error(`节点 ${node.id} 的端口数量超过 ${MAX_PORTS_PER_NODE}`);
    totalPorts += nodePorts;
    if (totalPorts > MAX_GRAPH_PORTS)
      throw new Error(`画布端口总数超过 ${MAX_GRAPH_PORTS}`);

    if (data.assetId !== undefined)
      assertAssetId(data.assetId, `节点 ${node.id}`);
    assertAssetIdArray(data.lastOutputAssetIds, `节点 ${node.id} 的最近输出`);
    assertAssetIdArray(
      data.materializedOutputAssetIds,
      `节点 ${node.id} 的固化输出`,
    );
    assertPromptAssetIds(data.parts, `节点 ${node.id} 的 Prompt`);
    assertPromptAssetIds(
      data.generatedPromptParts,
      `节点 ${node.id} 的生成 Prompt`,
    );
  }
  if (collectReferencedAssetIds(graph).length > MAX_GRAPH_ASSET_REFERENCES)
    throw new Error(`画布素材引用数超过 ${MAX_GRAPH_ASSET_REFERENCES}`);
}

function normalizeGraph(
  rawGraph: unknown,
  fallbackViewport: CanvasDocument["viewport"],
): CanvasDocument {
  if (!isRecord(rawGraph)) throw new Error("文件中的画布结构无效");
  if (
    rawGraph.schemaVersion !== undefined &&
    rawGraph.schemaVersion !== PROJECT_GRAPH_SCHEMA_VERSION
  )
    throw new Error(
      `不支持的画布 schemaVersion：${String(rawGraph.schemaVersion)}`,
    );
  const viewport = isRecord(rawGraph.viewport)
    ? rawGraph.viewport
    : (fallbackViewport ?? { x: 0, y: 0, zoom: 0.85 });
  const parsed = CanvasGraphSchema.safeParse({
    schemaVersion:
      rawGraph.schemaVersion === undefined
        ? PROJECT_GRAPH_SCHEMA_VERSION
        : rawGraph.schemaVersion,
    nodes: rawGraph.nodes,
    edges: rawGraph.edges,
    ...(rawGraph.drawings === undefined ? {} : { drawings: rawGraph.drawings }),
    viewport,
  });
  if (!parsed.success)
    throw new Error(
      parsed.error.issues[0]?.message ?? "文件中的节点、连线或视图结构无效",
    );
  assertGraphTransferLimits(parsed.data as CanvasDocument);
  const graphValidation = validateGraph(parsed.data, {
    checkPorts: true,
    checkRequiredInputs: false,
  });
  if (!graphValidation.valid)
    throw new Error(
      graphValidation.errors.map((issue) => issue.message).join("；"),
    );
  return parsed.data as CanvasDocument;
}

function addAssetId(target: Set<string>, value: unknown): void {
  if (typeof value === "string" && value.trim()) target.add(value);
}

function addAssetIds(target: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const item of value) addAssetId(target, item);
}

/** Returns only durable asset references stored in a serialized graph. */
export function collectReferencedAssetIds(graph: CanvasDocument): string[] {
  const ids = new Set<string>();
  for (const node of graph.nodes as CanvasNode[]) {
    const data = node.data;
    addAssetId(ids, data?.assetId);
    addAssetIds(ids, data?.lastOutputAssetIds);
    addAssetIds(ids, data?.materializedOutputAssetIds);
    if (Array.isArray(data?.parts)) {
      for (const part of data.parts) {
        if (part?.type === "asset") addAssetId(ids, part.assetId);
      }
    }
    if (Array.isArray(data?.generatedPromptParts)) {
      for (const part of data.generatedPromptParts) {
        if (part?.type === "asset") addAssetId(ids, part.assetId);
      }
    }
  }
  return [...ids].sort();
}

function remapParts(
  value: unknown,
  assetIds: ReadonlyMap<string, string>,
): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((part) => {
    if (
      !isRecord(part) ||
      part.type !== "asset" ||
      typeof part.assetId !== "string"
    )
      return part;
    return { ...part, assetId: assetIds.get(part.assetId) ?? part.assetId };
  });
}

function remapIdArray(
  value: unknown,
  assetIds: ReadonlyMap<string, string>,
): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((id) =>
    typeof id === "string" ? (assetIds.get(id) ?? id) : id,
  );
}

export function remapGraphAssetIds(
  graph: CanvasDocument,
  assetIds: ReadonlyMap<string, string>,
): CanvasDocument {
  if (assetIds.size === 0) return graph;
  return {
    ...graph,
    nodes: (graph.nodes as CanvasNode[]).map((node) => {
      const data = node.data;
      if (!data) return node;
      return {
        ...node,
        data: {
          ...data,
          ...(typeof data.assetId === "string"
            ? { assetId: assetIds.get(data.assetId) ?? data.assetId }
            : {}),
          ...(data.lastOutputAssetIds === undefined
            ? {}
            : {
                lastOutputAssetIds: remapIdArray(
                  data.lastOutputAssetIds,
                  assetIds,
                ) as string[],
              }),
          ...(data.materializedOutputAssetIds === undefined
            ? {}
            : {
                materializedOutputAssetIds: remapIdArray(
                  data.materializedOutputAssetIds,
                  assetIds,
                ) as string[],
              }),
          ...(data.parts === undefined
            ? {}
            : { parts: remapParts(data.parts, assetIds) }),
          ...(data.generatedPromptParts === undefined
            ? {}
            : {
                generatedPromptParts: remapParts(
                  data.generatedPromptParts,
                  assetIds,
                ),
              }),
        },
      } as CanvasNode;
    }),
    edges: graph.edges as CanvasEdge[],
  };
}

function extensionForAsset(
  asset: Pick<AssetView, "mimeType" | "name">,
): string {
  const fromName = /\.([a-z0-9]{1,10})$/iu.exec(asset.name)?.[1];
  if (fromName) return fromName.toLowerCase();
  const mimeSubtype = asset.mimeType.split("/")[1]?.split(/[;+]/u)[0];
  return (
    (mimeSubtype || "bin").replace(/[^a-z0-9]/giu, "").slice(0, 10) || "bin"
  );
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

function addZipBytes(archive: Zip, path: string, bytes: Uint8Array): void {
  const entry = new ZipPassThrough(path);
  archive.add(entry);
  entry.push(copyBytes(bytes), true);
}

function zipContainerOverhead(paths: readonly string[]): number {
  // Local header + data descriptor + central directory record, plus EOCD.
  return (
    22 +
    paths.reduce((total, path) => total + 96 + strToU8(path).byteLength * 2, 0)
  );
}

async function pipeResponseToZip(
  archive: Zip,
  path: string,
  response: Response,
  declaredSize: number,
): Promise<void> {
  if (!response.ok) throw new Error(`素材读取失败 (${response.status})`);
  const entry = new ZipPassThrough(path);
  archive.add(entry);
  let received = 0;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== declaredSize)
      throw new Error("素材大小已发生变化，请刷新后重试");
    entry.push(bytes, true);
    return;
  }
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > declaredSize) {
      await reader.cancel();
      throw new Error("素材大小已发生变化，请刷新后重试");
    }
    entry.push(copyBytes(value));
  }
  if (received !== declaredSize)
    throw new Error("素材大小已发生变化，请刷新后重试");
  entry.push(new Uint8Array(), true);
}

export async function createPortableProjectPackage(
  input: PortableProjectExportInput,
): Promise<Blob> {
  const graph = normalizeGraph(input.graph, input.graph.viewport);
  const referencedIds = collectReferencedAssetIds(graph);
  if (referencedIds.length > MAX_PACKAGE_ASSETS)
    throw new Error(`完整项目包最多包含 ${MAX_PACKAGE_ASSETS} 个素材`);
  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const missing = referencedIds.filter((id) => !assetById.has(id));
  if (missing.length > 0)
    throw new Error(
      `有 ${missing.length} 个引用素材已不存在，无法生成完整项目包`,
    );
  const selected = referencedIds.map((id) => assetById.get(id)!);
  const totalBytes = selected.reduce((total, asset) => total + asset.size, 0);
  const packageAssets: ProjectPackageAsset[] = selected.map((asset, index) => {
    if (asset.kind === "text")
      throw new Error(
        "完整项目包无法迁移文本素材：当前素材上传接口仅支持图片、视频和音频，请先移除或替换文本素材引用",
      );
    return {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      mimeType: asset.mimeType,
      size: asset.size,
      path: `assets/${String(index + 1).padStart(4, "0")}.${extensionForAsset(asset)}`,
    };
  });
  const manifest = PackageManifestSchema.parse({
    format: PROJECT_PACKAGE_FORMAT,
    version: PROJECT_PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    title: safeTitle(input.title, "超级画布项目"),
    graph,
    assets: packageAssets,
  });
  const manifestBytes = strToU8(JSON.stringify(manifest, null, 2));
  if (manifestBytes.byteLength > MAX_PROJECT_JSON_BYTES)
    throw new Error("完整项目包清单超过 8 MB");
  const estimatedPackageBytes =
    totalBytes +
    manifestBytes.byteLength +
    zipContainerOverhead([
      MANIFEST_PATH,
      ...packageAssets.map((asset) => asset.path),
    ]);
  if (estimatedPackageBytes > MAX_PROJECT_PACKAGE_BYTES)
    throw new Error("项目引用的素材超过完整项目包容量，请改用系统备份迁移");

  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let archive!: Zip;
  const archiveComplete = new Promise<void>((resolve, reject) => {
    archive = new Zip((error, chunk, final) => {
      if (error) {
        reject(error);
        return;
      }
      chunks.push(copyBytes(chunk));
      if (final) resolve();
    });
  });
  try {
    addZipBytes(archive, MANIFEST_PATH, manifestBytes);
    const fetchAsset =
      input.fetchAsset ??
      ((assetId: string) =>
        fetch(`/api/assets/${encodeURIComponent(assetId)}/content`, {
          cache: "no-store",
        }));
    for (let index = 0; index < packageAssets.length; index += 1) {
      const asset = packageAssets[index]!;
      await pipeResponseToZip(
        archive,
        asset.path,
        await fetchAsset(asset.id),
        asset.size,
      );
      input.onProgress?.(index + 1, packageAssets.length);
    }
    archive.end();
    await archiveComplete;
  } catch (error) {
    archive.terminate();
    throw error;
  }
  return new Blob(chunks, {
    type: "application/vnd.super-canvas.project+zip",
  });
}

function assertSafePackagePath(path: string): void {
  if (
    path.length === 0 ||
    path.length > MAX_PACKAGE_PATH_LENGTH ||
    path.startsWith("/") ||
    /^[a-z]:/iu.test(path) ||
    path.includes("\\") ||
    path
      .split("/")
      .some(
        (segment) => segment === "" || segment === "." || segment === "..",
      ) ||
    /[\u0000-\u001f\u007f]/u.test(path)
  )
    throw new Error("项目包包含不安全的文件路径");
}

function assertAssetPackagePath(path: string): void {
  assertSafePackagePath(path);
  const segments = path.split("/");
  if (segments.length !== 2 || segments[0] !== "assets" || !segments[1])
    throw new Error("项目包素材必须位于 assets 目录的第一层");
}

function assertSafeEntryExpansion(
  entry: { size?: number; originalSize?: number },
  totalBytes: number,
): void {
  if (entry.originalSize === undefined) return;
  if (
    !Number.isSafeInteger(entry.originalSize) ||
    entry.originalSize < 0 ||
    entry.originalSize > MAX_PROJECT_PACKAGE_BYTES - totalBytes
  )
    throw new Error("完整项目包解压后超过 512 MB");
  if (
    entry.size === undefined ||
    entry.originalSize <= COMPRESSION_RATIO_GRACE_BYTES
  )
    return;
  if (
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0 ||
    (entry.size === 0 && entry.originalSize > 0) ||
    entry.originalSize >
      entry.size * MAX_COMPRESSION_RATIO + COMPRESSION_RATIO_GRACE_BYTES
  )
    throw new Error("完整项目包包含异常压缩比，已拒绝解压");
}

async function readZipEntries(file: File): Promise<Map<string, Blob>> {
  if (file.size <= 0 || file.size > MAX_PROJECT_PACKAGE_BYTES)
    throw new Error("完整项目包必须小于 512 MB");
  const entries = new Map<string, Blob>();
  const discoveredPaths = new Set<string>();
  const activeFiles = new Set<{ terminate: () => void }>();
  let discovered = 0;
  let completed = 0;
  let totalBytes = 0;
  let inputFinished = false;
  let settled = false;

  return new Promise<Map<string, Blob>>(async (resolve, reject) => {
    const finishIfReady = () => {
      if (!settled && inputFinished && completed === discovered) {
        settled = true;
        resolve(entries);
      }
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      for (const active of activeFiles) active.terminate();
      reject(error instanceof Error ? error : new Error("完整项目包解压失败"));
    };
    const unzipper = new Unzip((entry) => {
      if (settled) return;
      try {
        assertSafePackagePath(entry.name);
        discovered += 1;
        if (discovered > MAX_PACKAGE_ENTRIES)
          throw new Error("完整项目包中的文件数量过多");
        if (discoveredPaths.has(entry.name))
          throw new Error("完整项目包包含重复文件");
        discoveredPaths.add(entry.name);
        assertSafeEntryExpansion(entry, totalBytes);
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let entryBytes = 0;
        activeFiles.add(entry);
        entry.ondata = (error, data, final) => {
          if (error) {
            fail(error);
            return;
          }
          entryBytes += data.byteLength;
          totalBytes += data.byteLength;
          if (totalBytes > MAX_PROJECT_PACKAGE_BYTES) {
            fail(new Error("完整项目包解压后超过 512 MB"));
            return;
          }
          if (
            entry.name === MANIFEST_PATH &&
            entryBytes > MAX_PROJECT_JSON_BYTES
          ) {
            fail(new Error("完整项目包清单超过 8 MB"));
            return;
          }
          if (data.byteLength > 0) chunks.push(copyBytes(data));
          if (!final) return;
          activeFiles.delete(entry);
          if (
            entry.originalSize !== undefined &&
            entryBytes !== entry.originalSize
          ) {
            fail(new Error("完整项目包条目大小与 ZIP 元数据不一致"));
            return;
          }
          if (entries.has(entry.name)) {
            fail(new Error("完整项目包包含重复文件"));
            return;
          }
          entries.set(entry.name, new Blob(chunks));
          completed += 1;
          finishIfReady();
        };
        entry.start();
      } catch (error) {
        fail(error);
      }
    });
    unzipper.register(UnzipInflate);
    try {
      const streamMethod = (
        file as File & {
          stream?: () => ReadableStream<Uint8Array>;
        }
      ).stream;
      if (typeof streamMethod === "function") {
        const reader = streamMethod.call(file).getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (settled) {
            await reader.cancel();
            return;
          }
          unzipper.push(copyBytes(value));
        }
      } else {
        for (
          let offset = 0;
          offset < file.size;
          offset += ZIP_READ_CHUNK_BYTES
        ) {
          if (settled) return;
          const bytes = new Uint8Array(
            await file
              .slice(offset, Math.min(file.size, offset + ZIP_READ_CHUNK_BYTES))
              .arrayBuffer(),
          );
          unzipper.push(bytes);
        }
      }
      unzipper.push(new Uint8Array(), true);
      inputFinished = true;
      finishIfReady();
    } catch (error) {
      fail(error);
    }
  });
}

async function preparePackageImport(
  file: File,
): Promise<PreparedProjectImport> {
  const entries = await readZipEntries(file);
  const manifestBlob = entries.get(MANIFEST_PATH);
  if (!manifestBlob) throw new Error("完整项目包缺少 manifest.json");
  let raw: unknown;
  try {
    raw = JSON.parse(await manifestBlob.text()) as unknown;
  } catch {
    throw new Error("完整项目包清单不是有效 JSON");
  }
  if (!isRecord(raw)) throw new Error("完整项目包清单无效");
  if (raw.format !== PROJECT_PACKAGE_FORMAT)
    throw new Error("不支持的完整项目包格式");
  if (raw.version !== PROJECT_PACKAGE_VERSION)
    throw new Error(`不支持的完整项目包版本：${String(raw.version)}`);
  if (
    !isRecord(raw.graph) ||
    raw.graph.schemaVersion !== PROJECT_GRAPH_SCHEMA_VERSION
  )
    throw new Error(
      `不支持的画布 schemaVersion：${String(isRecord(raw.graph) ? raw.graph.schemaVersion : undefined)}`,
    );
  const parsed = PackageManifestSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? "完整项目包清单无效");
  const graph = normalizeGraph(parsed.data.graph, parsed.data.graph.viewport);
  const listedPaths = new Set([MANIFEST_PATH]);
  const ids = new Set<string>();
  const referencedAssetIds = collectReferencedAssetIds(graph);
  if (referencedAssetIds.length > MAX_PACKAGE_ASSETS)
    throw new Error(`完整项目包最多包含 ${MAX_PACKAGE_ASSETS} 个素材引用`);
  const referencedIds = new Set(referencedAssetIds);
  for (const asset of parsed.data.assets) {
    assertAssetPackagePath(asset.path);
    if (listedPaths.has(asset.path))
      throw new Error("完整项目包清单包含重复素材路径");
    if (ids.has(asset.id)) throw new Error("完整项目包清单包含重复素材 ID");
    if (!referencedIds.has(asset.id))
      throw new Error(`完整项目包包含未被画布引用的素材：${asset.name}`);
    listedPaths.add(asset.path);
    ids.add(asset.id);
    const blob = entries.get(asset.path);
    if (!blob) throw new Error(`完整项目包缺少素材：${asset.name}`);
    if (blob.size !== asset.size)
      throw new Error(`素材大小校验失败：${asset.name}`);
  }
  for (const path of entries.keys()) {
    if (!listedPaths.has(path))
      throw new Error(`完整项目包包含未声明文件：${path}`);
  }
  return {
    source: "package",
    title: parsed.data.title,
    graph,
    referencedAssetIds,
    missingAssetIds: referencedAssetIds.filter((id) => !ids.has(id)),
    packageAssets: parsed.data.assets,
    packageFiles: entries,
  };
}

async function prepareJsonImport(
  file: File,
  fallbackTitle: string,
  fallbackViewport: CanvasDocument["viewport"],
  availableAssetIds: ReadonlySet<string>,
): Promise<PreparedProjectImport> {
  if (file.size <= 0 || file.size > MAX_PROJECT_JSON_BYTES)
    throw new Error("项目 JSON 必须小于 8 MB");
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error("文件不是有效的 JSON");
  }
  if (!isRecord(raw)) throw new Error("文件不是有效的画布项目");
  if (raw.format !== undefined && raw.format !== PROJECT_JSON_FORMAT)
    throw new Error("不支持的项目文件格式");
  if (raw.version !== undefined && raw.version !== PROJECT_JSON_VERSION)
    throw new Error(`不支持的项目文件版本：${String(raw.version)}`);
  const rawGraph = isRecord(raw.graph) ? raw.graph : raw;
  const graph = normalizeGraph(rawGraph, fallbackViewport);
  const referencedAssetIds = collectReferencedAssetIds(graph);
  return {
    source: "json",
    title: safeTitle(raw.title, fallbackTitle),
    graph,
    referencedAssetIds,
    missingAssetIds: referencedAssetIds.filter(
      (id) => !availableAssetIds.has(id),
    ),
    packageAssets: [],
    packageFiles: new Map(),
  };
}

export async function prepareProjectImport(input: {
  file: File;
  fallbackTitle: string;
  fallbackViewport: CanvasDocument["viewport"];
  availableAssetIds: ReadonlySet<string>;
}): Promise<PreparedProjectImport> {
  const packageLike =
    input.file.name.toLowerCase().endsWith(PROJECT_PACKAGE_EXTENSION) ||
    input.file.type === "application/vnd.super-canvas.project+zip" ||
    input.file.type === "application/zip";
  return packageLike
    ? preparePackageImport(input.file)
    : prepareJsonImport(
        input.file,
        input.fallbackTitle,
        input.fallbackViewport,
        input.availableAssetIds,
      );
}

export async function uploadPreparedPackageAssets(input: {
  prepared: PreparedProjectImport;
  upload: (file: File) => Promise<AssetView>;
  onProgress?: (completed: number, total: number) => void;
}): Promise<{ graph: CanvasDocument; uploadedAssets: AssetView[] }> {
  if (input.prepared.source !== "package")
    return { graph: input.prepared.graph, uploadedAssets: [] };
  if (input.prepared.missingAssetIds.length > 0)
    throw new Error("完整项目包仍有缺失素材，不能开始上传");
  const uploadedAssets: AssetView[] = [];
  const uploadedIds = new Set<string>();
  const remap = new Map<string, string>();
  for (let index = 0; index < input.prepared.packageAssets.length; index += 1) {
    const descriptor = input.prepared.packageAssets[index]!;
    try {
      const blob = input.prepared.packageFiles.get(descriptor.path);
      if (!blob) throw new Error(`完整项目包缺少素材：${descriptor.name}`);
      const uploaded = await input.upload(
        new File([blob], descriptor.name, { type: descriptor.mimeType }),
      );
      uploadedAssets.push(uploaded);
      assertAssetId(uploaded.id, `已上传素材 ${descriptor.name}`);
      if (uploadedIds.has(uploaded.id))
        throw new Error("素材上传接口返回了重复 ID");
      if (uploaded.kind !== descriptor.kind)
        throw new Error(`素材类型校验失败：${descriptor.name}`);
      if (uploaded.size !== descriptor.size)
        throw new Error(`素材大小校验失败：${descriptor.name}`);
      uploadedIds.add(uploaded.id);
      remap.set(descriptor.id, uploaded.id);
      input.onProgress?.(index + 1, input.prepared.packageAssets.length);
    } catch (error) {
      throw new ProjectAssetUploadError(error, uploadedAssets, descriptor);
    }
  }
  return {
    graph: remapGraphAssetIds(input.prepared.graph, remap),
    uploadedAssets,
  };
}
