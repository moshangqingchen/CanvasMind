import IORedis from "ioredis";
import { Worker } from "bullmq";
import { getRepository } from "@super-canvas/db";
import { getRunService } from "@super-canvas/runtime";

const redisUrl = process.env.REDIS_URL;
const service = getRunService();
const repository = getRepository();

async function waitForTerminal(
  runId: string,
  timeoutMs = 10 * 60 * 1000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await service.getRun(runId);
    if (!snapshot) return "missing";
    if (
      ["succeeded", "failed", "cancelled", "needs_attention"].includes(
        snapshot.run.status,
      )
    )
      return snapshot.run.status;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Run exceeded the worker maximum wait time");
}

async function main() {
  if (!redisUrl) {
    const cancelled = await repository.listRunsByStatus(["cancelled"]);
    for (const run of cancelled) await service.reconcileCancellation(run.id);
    const pending = await repository.listRecoverableRuns();
    for (const run of pending) {
      await service.resumeRun(run.id);
      await waitForTerminal(run.id);
    }
    console.info(
      "[worker] REDIS_URL is not configured; recovered database tasks and exited",
    );
    return;
  }

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const worker = new Worker(
    "super-canvas-runs",
    async (job) => {
      const nodeRunId =
        typeof job.data?.nodeRunId === "string"
          ? job.data.nodeRunId
          : undefined;
      const nodeRun = nodeRunId ? await repository.getNodeRun(nodeRunId) : null;
      // Accept legacy runId jobs during upgrades; new jobs carry node_run_id.
      const runId =
        nodeRun?.workflowRunId ??
        (typeof job.data?.runId === "string" ? job.data.runId : undefined);
      if (!runId) throw new Error("Queue job is missing a resolvable run id");
      const run = await repository.getRun(runId);
      if (run?.status === "cancelled") {
        await service.reconcileCancellation(runId);
        return "cancelled";
      }
      await service.resumeRun(runId);
      return await waitForTerminal(runId);
    },
    { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) },
  );

  const cancelled = await repository.listRunsByStatus(["cancelled"]);
  for (const run of cancelled) await service.reconcileCancellation(run.id);
  const pending = await repository.listRecoverableRuns();
  for (const run of pending) await service.enqueueRunJob(run.id);

  worker.on("completed", (job) => console.info(`[worker] completed ${job.id}`));
  worker.on("failed", (job, error) =>
    console.error(`[worker] failed ${job?.id}`, error),
  );
  const shutdown = async () => {
    await worker.close();
    await connection.quit();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  console.info("[worker] super-canvas-runs worker started");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
