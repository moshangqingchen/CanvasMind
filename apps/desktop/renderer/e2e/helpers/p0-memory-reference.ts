import { readFile, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const maximumMetadataBytes = 2 * 1024 * 1024;
const phases = ["start", "idle-end", "operations-end"] as const;

export interface MemorySnapshotReference {
  referenceDir: string;
  buildId: string;
  summaryPath: string;
  manifestPath: string;
  measuredIdleMs: number;
  measuredOperationMs: number;
  snapshots: Array<{ phase: typeof phases[number]; path: string; bytes: number }>;
  snapshotBodiesRead: false;
}

async function metadata(path: string, label: string): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0 || info.size > maximumMetadataBytes)
      throw new Error("Metadata file size is invalid");
    value = JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/u, ""));
  } catch {
    // Never echo malformed metadata contents or arbitrary parser error snippets.
    throw new Error(`Snapshot reference ${label} must be readable nonempty JSON metadata within 2 MiB`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Snapshot reference ${label} must be a JSON object`);
  return value as Record<string, unknown>;
}

/**
 * A curve-only run can cite existing full snapshots from this exact build.
 * This validates only the explicit reference; it never reclassifies raw results,
 * reads heap bodies, writes files or relaxes the new run's independent gates.
 */
export async function validateMemorySnapshotReference(
  referenceDir: string | undefined,
  expectedBuildId: string | undefined,
): Promise<MemorySnapshotReference> {
  if (!referenceDir?.trim()) throw new Error("An explicit snapshot referenceDir is required for a curve-only formal run");
  if (!expectedBuildId?.trim() || expectedBuildId.length > 256)
    throw new Error("An explicit expectedBuildId is required for a snapshot reference");
  const canonicalDir = await realpath(resolve(referenceDir));
  const summaryPath = join(canonicalDir, "summary.json");
  const manifestPath = join(canonicalDir, "manifest.json");
  const summary = await metadata(summaryPath, "summary");
  if (summary.completed !== true || summary.formalEvidenceValid !== true)
    throw new Error("Snapshot reference must be completed and formally valid in its original summary");
  if (summary.diagnosticOnly !== false)
    throw new Error("Snapshot reference must not be diagnostic for a curve-only formal run");
  if (!Array.isArray(summary.invalidReasons) || summary.invalidReasons.length !== 0)
    throw new Error("Snapshot reference invalidReasons must be an explicit empty array");
  const idleMs = summary.measuredIdleMs;
  const operationMs = summary.measuredOperationMs;
  if (typeof idleMs !== "number" || !Number.isSafeInteger(idleMs) || idleMs < 1_200_000 ||
      typeof operationMs !== "number" || !Number.isSafeInteger(operationMs) || operationMs < 300_000)
    throw new Error("Snapshot reference must complete at least 20 idle minutes and 5 operation minutes");
  const manifest = await metadata(manifestPath, "manifest");
  if (manifest.snapshots !== true)
    throw new Error("Snapshot reference manifest must explicitly record snapshots=true");
  if (manifest.runtimeBuildId !== expectedBuildId)
    throw new Error("Snapshot reference runtimeBuildId does not match the current expectedBuildId");
  const snapshots: MemorySnapshotReference["snapshots"] = [];
  for (const phase of phases) {
    const path = join(canonicalDir, `${phase}.post-gc.heapsnapshot`);
    let bytes: number;
    try {
      const info = await stat(path);
      if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size <= 0)
        throw new Error("Invalid heap file");
      bytes = info.size;
    } catch {
      throw new Error(`Snapshot reference ${phase}.post-gc.heapsnapshot must be a nonempty regular file`);
    }
    snapshots.push({ phase, path, bytes });
  }
  return { referenceDir: canonicalDir, buildId: expectedBuildId, summaryPath, manifestPath,
    measuredIdleMs: idleMs, measuredOperationMs: operationMs, snapshots, snapshotBodiesRead: false };
}
