// Synthetic data only. Never opens a user profile or existing database.
import { performance } from "node:perf_hooks";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { MemoryRepository } from "../packages/db/dist/memory.js";
import { FileRepository } from "../packages/db/dist/file.js";

const counts = [1_000, 10_000, 50_000];
const rows = [];
const directory = await mkdtemp(join(tmpdir(), "supercanvas-db-benchmark-"));
const percentile = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)];
const measure = async (operation) => {
  const samples = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    await operation();
    samples.push(performance.now() - start);
  }
  return Number(percentile(samples).toFixed(3));
};
try {
  for (const count of counts) {
    const snapshot = new MemoryRepository().exportSnapshot();
    const time = new Date(0).toISOString();
    for (let i = 0; i < count / 10; i++) {
      snapshot.runs.push({
        id: `run-${i}`,
        canvasId: `canvas-${i % 100}`,
        clientRequestId: `request-${i}`,
        scope: "all",
        status: "succeeded",
        revisionGraph: { nodes: [] },
        createdAt: time,
        updatedAt: time,
      });
      for (let n = 0; n < 10; n++)
        snapshot.nodeRuns.push({
          id: `nr-${i}-${n}`,
          workflowRunId: `run-${i}`,
          nodeId: `node-${n}`,
          status: "succeeded",
          attempt: 1,
          providerTaskId: null,
          inputJson: {},
          outputAssetIds: [`asset-${i}-${n}`],
          errorJson: null,
          createdAt: time,
          updatedAt: time,
        });
    }
    const repository = new MemoryRepository(snapshot);
    const path = join(directory, `${count}.json`);
    await writeFile(path, JSON.stringify(snapshot));
    const persistent = new FileRepository(path);
    const writes = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      await persistent.updateNodeRun("nr-0-0", { inputJson: { sample: i } });
      writes.push(performance.now() - start);
    }
    const runMap = new Map(snapshot.runs.map((run) => [run.id, run]));
    rows.push({
      nodeRuns: count,
      snapshotMiB: Number(
        ((await readFile(path)).byteLength / 1024 / 1024).toFixed(2),
      ),
      listBaselineP95ms: await measure(() =>
        snapshot.nodeRuns
          .filter((row) => row.workflowRunId === "run-0")
          .map((row) => structuredClone(row)),
      ),
      listIndexedP95ms: await measure(() => repository.listNodeRuns("run-0")),
      latestBaselineP95ms: await measure(
        () =>
          snapshot.nodeRuns
            .filter(
              (row) =>
                runMap.get(row.workflowRunId)?.canvasId === "canvas-0" &&
                row.nodeId === "node-0" &&
                row.status === "succeeded" &&
                row.outputAssetIds.length > 0,
            )
            .sort(
              (a, b) =>
                b.updatedAt.localeCompare(a.updatedAt) ||
                b.createdAt.localeCompare(a.createdAt) ||
                b.id.localeCompare(a.id),
            )[0],
      ),
      latestIndexedP95ms: await measure(() =>
        repository.findLatestSucceededNodeRun("canvas-0", "node-0"),
      ),
      snapshotWriteP95ms: Number(percentile(writes).toFixed(3)),
    });
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        timestamp: new Date().toISOString(),
        rows,
      },
      null,
      2,
    ),
  );
} finally {
  if (dirname(resolve(directory)) !== resolve(tmpdir()))
    throw new Error("Unexpected benchmark directory");
  await rm(directory, { recursive: true, force: true });
}
