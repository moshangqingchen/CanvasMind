import {
  MAX_SMALL_JSON_BODY_BYTES,
  parseJsonRequest,
} from "../../../../lib/api-validation";
import type { DirectorTurnEvent } from "../../../../lib/director-contracts";
import { runDirectorTurn } from "../../../../lib/director-service";
import { DirectorTurnRequestSchema } from "../_schemas";
import { publicDirectorError } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function encodeEvent(event: DirectorTurnEvent): Uint8Array {
  return encoder.encode(
    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

export async function POST(request: Request) {
  const parsed = await parseJsonRequest(
    request,
    DirectorTurnRequestSchema,
    MAX_SMALL_JSON_BODY_BYTES,
  );
  if (!parsed.success) return parsed.response;

  let closed = false;
  let doneSent = false;
  let observedSessionId = parsed.data.sessionId ?? "";
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: DirectorTurnEvent) => {
        if (closed) return;
        if (event.type === "message")
          observedSessionId = event.message.sessionId;
        if (event.type === "proposal")
          observedSessionId = event.proposal.sessionId;
        if (event.type === "done") {
          doneSent = true;
          observedSessionId = event.sessionId;
        }
        try {
          controller.enqueue(encodeEvent(event));
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        if (heartbeat !== undefined) clearInterval(heartbeat);
        if (closed) return;
        try {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch {
          // The client may close the stream between the final event and close.
        }
        closed = true;
      };

      // This comment reaches the client immediately, preventing proxy buffering
      // before the first database-backed stage event is ready.
      controller.enqueue(encoder.encode(": connected\n\n"));
      // Keep long-running model/search calls alive through common reverse
      // proxies that close otherwise-idle SSE connections.
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          closed = true;
          if (heartbeat !== undefined) clearInterval(heartbeat);
        }
      }, 15_000);
      void runDirectorTurn(parsed.data, send)
        .then((sessionId) => {
          observedSessionId = sessionId;
          if (!doneSent) send({ type: "done", sessionId });
        })
        .catch((error: unknown) => {
          const safe = publicDirectorError(error);
          send({ type: "error", message: safe.error, code: safe.code });
          if (!doneSent) {
            send({ type: "done", sessionId: observedSessionId });
          }
        })
        .finally(finish);

      request.signal.addEventListener(
        "abort",
        () => {
          if (closed) return;
          closed = true;
          if (heartbeat !== undefined) clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            // The stream may already have been cancelled by the consumer.
          }
        },
        { once: true },
      );
    },
    cancel() {
      closed = true;
      if (heartbeat !== undefined) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
