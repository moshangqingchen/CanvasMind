import { parseRouteIdentifier } from "../../../../../lib/api-validation";
import {
  publicRunSnapshot,
  publicRuntimeEvent,
  runService,
} from "../../../../../lib/server";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const parsedId = parseRouteIdentifier(params.id, "运行 ID");
  if (!parsedId.success) return parsedId.response;
  const id = parsedId.data;
  const initial = await runService.getRun(id);
  if (!initial) return Response.json({ error: "运行不存在" }, { status: 404 });
  const initialPublic = publicRunSnapshot(initial);
  if (!initialPublic)
    return Response.json({ error: "运行不存在" }, { status: 404 });
  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let polling: ReturnType<typeof setInterval> | undefined;
  let signature = JSON.stringify(
    initialPublic.nodes.map((node) => [
      node.id,
      node.status,
      node.outputAssetIds,
    ]),
  );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(value)}\n\n`),
          );
        } catch {
          /* client disconnected */
        }
      };
      send({ type: "snapshot", runId: id, payload: initialPublic });
      unsubscribe = runService.subscribe((event) => {
        if (event.runId === id) send(publicRuntimeEvent(event));
      });
      heartbeat = setInterval(
        () => send({ type: "heartbeat", runId: id }),
        12_000,
      );
      polling = setInterval(() => {
        void runService
          .getRun(id)
          .then((snapshot) => {
            if (!snapshot) return;
            const publicSnapshot = publicRunSnapshot(snapshot);
            if (!publicSnapshot) return;
            const nextSignature = `${publicSnapshot.run.status}:${JSON.stringify(publicSnapshot.nodes.map((node) => [node.id, node.status, node.outputAssetIds]))}`;
            if (nextSignature !== signature) {
              signature = nextSignature;
              send({ type: "snapshot", runId: id, payload: publicSnapshot });
            }
          })
          .catch(() => undefined);
      }, 750);
      request.signal.addEventListener(
        "abort",
        () => {
          unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
          if (polling) clearInterval(polling);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        },
        { once: true },
      );
    },
    cancel() {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      if (polling) clearInterval(polling);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
