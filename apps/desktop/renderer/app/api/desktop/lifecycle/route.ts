import { desktopAuthorized, desktopLifecycleState } from "../../../../lib/desktop-server";
import { repository } from "../../../../lib/server";
import { isCloudSubmission } from "@super-canvas/runtime";

export const dynamic = "force-dynamic";

async function status() {
  const state = desktopLifecycleState();
  const runs = await repository.listRecoverableRuns();
  const verifications = await repository.listSupplierVerifications?.() ?? [];
  const activeVerifications = verifications.reduce((count, record) => count + record.cases.filter(test => ["submitting", "running", "archiving"].includes(test.status) &&
    !(test.status !== "archiving" && isCloudSubmission(test.task?.providerTaskId) && (test.task?.result as Record<string, unknown> | undefined)?.cloudAccepted === true)).length, 0);
  let resumableCloudRuns = 0;
  for (const run of runs) {
    const nodes = await repository.listNodeRuns(run.id);
    const running = nodes.filter(node => ["submitting", "running", "archiving", "cancel_requested"].includes(node.status));
    if (running.length && running.every(node => ["submitting", "running"].includes(node.status) && isCloudSubmission(node.providerTaskId) && node.inputJson.cloudAccepted === true)) resumableCloudRuns++;
  }
  const blockingRuns = runs.length - resumableCloudRuns;
  const store = repository as typeof repository & { flush?: () => Promise<void> };
  if (blockingRuns === 0 && activeVerifications === 0 && state.writes === 0) await store.flush?.();
  return Response.json({ draining: state.draining, activeRuns: blockingRuns + activeVerifications, resumableCloudRuns, activeVerifications, activeWrites: state.writes },
    { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  if (!desktopAuthorized(request)) return new Response(null, { status: 404 });
  return status();
}

export async function POST(request: Request) {
  if (!desktopAuthorized(request)) return new Response(null, { status: 404 });
  const body = await request.json().catch(() => null) as { draining?: unknown } | null;
  if (typeof body?.draining !== "boolean") return new Response(null, { status: 400 });
  desktopLifecycleState().draining = body.draining;
  if (!body.draining && process.env.NODE_ENV !== "test" && process.env.SUPPLIER_AUTO_VERIFY !== "off") {
    void import("../../../../lib/supplier-verification").then(module => module.resumeSupplierVerification()).catch(() => {});
  }
  return status();
}
