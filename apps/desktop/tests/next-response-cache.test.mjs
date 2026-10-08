import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import nextConfig from "../renderer/next.config.mjs";

const requireNext = createRequire(new URL("../renderer/package.json", import.meta.url));
const { default: FileSystemCache } = requireNext("next/dist/server/lib/incremental-cache/file-system-cache.js");
const { configSchema } = requireNext("next/dist/server/config-schema.js");
const { defaultConfig } = requireNext("next/dist/server/config-shared.js");
const { getRouteCacheKey } = requireNext("next/dist/server/lib/route-cache-key.js");
const { CachedRouteKind, IncrementalCacheKind } = requireNext("next/dist/server/response-cache/types.js");
const { NEXT_META_SUFFIX, RSC_SUFFIX, RSC_SEGMENTS_DIR_SUFFIX, RSC_SEGMENT_SUFFIX } = requireNext("next/dist/lib/constants.js");

const owner = { kind: "APP_PAGE", sourceRoute: "/_not-found/page" };
const key = getRouteCacheKey("/_not-found", owner);
const context = { kind: IncrementalCacheKind.APP_PAGE, isFallback: false, isRoutePPREnabled: false };
const segmentPath = "/_not-found/__PAGE__";

async function fixture(t) {
  const root = resolve(await mkdtemp(join(tmpdir(), "super-canvas-next-cache-")));
  t.after(async () => {
    FileSystemCache.memoryCache?.remove(key);
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("super-canvas-next-cache-"));
    await rm(root, { recursive: true, force: true });
  });
  const serverDistDir = join(root, "resources/runtime/server/apps/desktop/renderer/.next-desktop/server");
  await mkdir(serverDistDir, { recursive: true });
  const writes = [];
  const reads = [];
  const fileSystem = {
    existsSync,
    readFileSync,
    stat,
    readFile: async (...args) => {
      reads.push(args[0]);
      return readFile(...args);
    },
    mkdir: async (path) => {
      writes.push(["mkdir", path]);
      return mkdir(path, { recursive: true });
    },
    writeFile: async (...args) => {
      writes.push(["writeFile", args[0]]);
      return writeFile(...args);
    },
    writeFileAtomic: async (...args) => {
      writes.push(["writeFileAtomic", args[0]]);
      return writeFile(...args);
    },
  };
  const config = configSchema.parse(nextConfig);
  assert.equal(config.experimental.isrFlushToDisk, false);
  const maxMemoryCacheSize = config.cacheMaxMemorySize ?? defaultConfig.cacheMaxMemorySize;
  assert.ok(maxMemoryCacheSize > 0 && Number.isFinite(maxMemoryCacheSize));
  const cache = new FileSystemCache({
    fs: fileSystem,
    serverDistDir,
    flushToDisk: config.experimental.isrFlushToDisk,
    maxMemoryCacheSize,
    revalidatedTags: [],
  });
  FileSystemCache.memoryCache?.remove(key);
  const longSegmentFile = cache.getFilePath(
    `${key}${RSC_SEGMENTS_DIR_SUFFIX}${segmentPath}${RSC_SEGMENT_SUFFIX}`,
    IncrementalCacheKind.APP_PAGE,
  );
  assert.ok(longSegmentFile.length > 259, "fixture must reproduce the installer path-length boundary");
  return { cache, serverDistDir, writes, reads };
}

test("desktop Next response cache retains HTML, RSC and long-path segments in memory without writing runtime files", async (t) => {
  const { cache, serverDistDir, writes, reads } = await fixture(t);
  const value = {
    kind: CachedRouteKind.APP_PAGE,
    html: "<html><body>Not found</body></html>",
    rscData: Buffer.from("synthetic RSC response"),
    segmentData: new Map([[segmentPath, Buffer.from("synthetic page segment")]]),
    headers: { "content-type": "text/html" },
    status: 404,
  };
  await cache.set(key, value, context);
  const result = await cache.get(key, context);
  assert.deepEqual(result?.value, value);
  assert.ok(Number.isFinite(result.lastModified));
  assert.deepEqual(reads, [], "the written response must be served from memory");
  assert.deepEqual(writes, [], "neither response nor segment files may be written");
  assert.equal(existsSync(join(serverDistDir, "route-cache")), false);
  assert.deepEqual(await readdir(serverDistDir), []);
});

test("desktop Next reads immutable compiled HTML, RSC and segment seeds without promoting them to long runtime cache paths", async (t) => {
  const { cache, serverDistDir, writes, reads } = await fixture(t);
  const seedKey = "/_not-found";
  const seedFiles = new Map([
    [cache.getFilePath(`${seedKey}.html`, context.kind), Buffer.from("<html><body>Compiled not found</body></html>")],
    [cache.getFilePath(`${seedKey}${RSC_SUFFIX}`, context.kind), Buffer.from("compiled RSC response")],
    [cache.getFilePath(`${seedKey}${RSC_SEGMENTS_DIR_SUFFIX}${segmentPath}${RSC_SEGMENT_SUFFIX}`, context.kind), Buffer.from("compiled page segment")],
    [cache.getFilePath(`${seedKey}${NEXT_META_SUFFIX}`, context.kind), Buffer.from(JSON.stringify({
      routeCache: { key, owner, isFallback: false },
      segmentPaths: [segmentPath],
      headers: { "content-type": "text/html" },
      status: 404,
    }))],
  ]);
  for (const [path, data] of seedFiles) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  const result = await cache.get(key, context);
  assert.equal(result?.value.kind, CachedRouteKind.APP_PAGE);
  assert.equal(result.value.html, "<html><body>Compiled not found</body></html>");
  assert.deepEqual(result.value.rscData, Buffer.from("compiled RSC response"));
  assert.deepEqual(result.value.segmentData, new Map([[segmentPath, Buffer.from("compiled page segment")]]));
  assert.equal(result.value.status, 404);
  assert.ok(reads.includes(cache.getFilePath(`${seedKey}${RSC_SUFFIX}`, context.kind)));
  const firstReadCount = reads.length;
  assert.deepEqual(await cache.get(key, context), result);
  assert.equal(reads.length, firstReadCount, "the verified build seed must then be served from memory");
  assert.deepEqual(writes, [], "build-seed promotion must not create runtime cache files");
  assert.equal(existsSync(join(serverDistDir, "route-cache")), false);
  assert.deepEqual(await readdir(serverDistDir), ["app"]);
  for (const [path, data] of seedFiles) assert.deepEqual(await readFile(path), data);
});
