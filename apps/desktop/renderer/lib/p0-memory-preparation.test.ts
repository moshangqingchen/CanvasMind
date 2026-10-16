import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertPreparationLoopback, decodePreparedMemoryFixture, memoryCatalogManifestDigest, readPreparationChildMode } from "../e2e/helpers/p0-memory-preparation";

const owner: Parameters<typeof decodePreparedMemoryFixture>[1] = {
  owner: "codex-phase3-p0-memory-preparation", nonce: "unique-child-request", scenario: "canvas-idle",
  parentWorkerPid: 123, baseURL: "http://127.0.0.1:3237", expectedBuildId: "frozen-build",
};
function envelope() {
  const fixture = { canvas: { id: "isolated-canvas" }, provider: { provider: "fake" }, assets: [], runs: [], imageIds: [] };
  return { schemaVersion: 1, identity: { ...owner }, preparationWorkerPid: 456, preparedAt: "test",
    catalogManifestSha256: memoryCatalogManifestDigest(null), fixture,
    fixtureSha256: createHash("sha256").update(JSON.stringify(fixture)).digest("hex"),
    childMemory: {}, browserStarted: false, requestDisposed: true };
}

describe("isolated API-only P0 preparation descriptor", () => {
  it("keeps the child path optional and rejects ambiguous modes", () => {
    expect(readPreparationChildMode("0")).toBe(false);
    expect(readPreparationChildMode("1")).toBe(true);
    expect(() => readPreparationChildMode("yes")).toThrow("must be 0 or 1");
  });
  it("accepts only the isolated HTTP loopback origin", () => {
    expect(() => assertPreparationLoopback(owner.baseURL)).not.toThrow();
    for (const url of ["https://p0-catalog.invalid", "http://localhost:3237", "http://127.0.0.1", "http://127.0.0.1:3237/path", "http://x:y@127.0.0.1:3237"])
      expect(() => assertPreparationLoopback(url)).toThrow();
  });
  it("accepts a small matching descriptor with a separate API-only worker", () => {
    const prepared = decodePreparedMemoryFixture(JSON.stringify(envelope()), owner);
    expect(prepared.fixture.canvas.id).toBe("isolated-canvas");
    expect(prepared.preparationWorkerPid).not.toBe(owner.parentWorkerPid);
  });
  it.each(["nonce", "scenario", "baseURL", "expectedBuildId", "parentWorkerPid"] as const)("rejects a stale or foreign %s", key => {
    const value = envelope();
    Object.assign(value.identity, { [key]: key === "parentWorkerPid" ? 999 : "different" });
    expect(() => decodePreparedMemoryFixture(JSON.stringify(value), owner)).toThrow("identity mismatch");
  });
  it("rejects wrong schema, altered payload, real execution provider and an undisposed request", () => {
    expect(() => decodePreparedMemoryFixture(JSON.stringify({ ...envelope(), schemaVersion: 2 }), owner)).toThrow("schema");
    expect(() => decodePreparedMemoryFixture(JSON.stringify({ ...envelope(), fixtureSha256: "bad" }), owner)).toThrow("SHA");
    const value = envelope(); value.fixture.provider.provider = "rest";
    expect(() => decodePreparedMemoryFixture(JSON.stringify(value), owner)).toThrow("Fake");
    expect(() => decodePreparedMemoryFixture(JSON.stringify({ ...envelope(), requestDisposed: false }), owner)).toThrow("disposed");
  });
  it("refuses large descriptors and detects catalog identity changes", () => {
    expect(() => decodePreparedMemoryFixture(" ".repeat(4 * 1024 * 1024 + 1), owner)).toThrow("too large");
    expect(memoryCatalogManifestDigest({ models: 1 })).not.toBe(memoryCatalogManifestDigest({ models: 2 }));
  });
});
