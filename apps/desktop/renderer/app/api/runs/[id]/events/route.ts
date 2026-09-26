import { parseRouteIdentifier } from "../../../../../lib/api-validation";
import {
  publicRunSnapshot,
  publicRuntimeEvent,
  runService,
} from "../../../../../lib/server";

type Snapshot = NonNullable<ReturnType<typeof publicRunSnapshot>>;
type Listener = (frame: Uint8Array, terminal: boolean) => void;
const encoder = new TextEncoder();
const frame = (value: unknown) =>
  encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
const terminal = (snapshot: Snapshot) =>
  !["queued", "running"].includes(snapshot.run.status);

/** A run has one snapshot read/serialization and fallback timer for all subscribers. */
const streams = new Map<
  string,
  {
    snapshot: Snapshot;
    subscribe(listener: Listener): () => void;
  }
>();

function sharedStream(id: string, initial: Snapshot) {
  const existing = streams.get(id);
  if (existing) return existing;
  const listeners = new Set<Listener>();
  let disposed = false;
  let inFlight = false;
  let dirty = false;
  let signature = JSON.stringify(initial);
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let fallback: ReturnType<typeof setInterval> | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    if (heartbeat) clearInterval(heartbeat);
    if (fallback) clearInterval(fallback);
    if (streams.get(id) === hub) streams.delete(id);
  };
  const broadcast = (value: unknown, done = false) => {
    const encoded = frame(value);
    for (const listener of [...listeners]) listener(encoded, done);
  };
  const refresh = async () => {
    if (disposed) return;
    dirty = true;
    if (inFlight) return;
    inFlight = true;
    try {
      do {
        dirty = false;
        const snapshot = publicRunSnapshot(await runService.getRun(id));
        if (disposed || !snapshot) return;
        hub.snapshot = snapshot;
        const nextSignature = JSON.stringify(snapshot);
        const done = terminal(snapshot);
        if (nextSignature !== signature || done) {
          signature = nextSignature;
          broadcast({ type: "snapshot", runId: id, payload: snapshot }, done);
        }
        if (done) dispose();
      } while (dirty && !disposed);
    } catch {
      // Repair transient read failures on a later event or fallback timer.
    } finally {
      inFlight = false;
    }
  };
  const hub = {
    snapshot: initial,
    subscribe(listener: Listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        unsubscribe = runService.subscribe((event) => {
          if (event.runId !== id) return;
          broadcast(publicRuntimeEvent(event));
          void refresh();
        });
        heartbeat = setInterval(
          () => broadcast({ type: "heartbeat", runId: id }),
          12_000,
        );
        // Events are authoritative locally; this timer only repairs missed events.
        fallback = setInterval(() => {
          if (!inFlight) void refresh();
        }, 10_000);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) dispose();
      };
    },
  };
  streams.set(id, hub);
  return hub;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsedId = parseRouteIdentifier((await context.params).id, "运行 ID");
  if (!parsedId.success) return parsedId.response;
  const id = parsedId.data;
  const initial =
    streams.get(id)?.snapshot ?? publicRunSnapshot(await runService.getRun(id));
  if (!initial) return Response.json({ error: "运行不存在" }, { status: 404 });
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      const close = () => {
        if (closed) return;
        cleanup();
        try {
          controller.close();
        } catch {
          /* reader already cancelled */
        }
      };
      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        request.signal.removeEventListener("abort", close);
      };
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) {
        close();
        return;
      }
      const hub = terminal(initial) ? undefined : sharedStream(id, initial);
      const snapshot = hub?.snapshot ?? initial;
      controller.enqueue(
        frame({ type: "snapshot", runId: id, payload: snapshot }),
      );
      if (terminal(snapshot)) {
        close();
        return;
      }
      unsubscribe = hub!.subscribe((encoded, done) => {
        if (closed) return;
        try {
          controller.enqueue(encoded);
        } catch {
          close();
          return;
        }
        if (done) close();
      });
    },
    cancel() {
      cleanup();
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
