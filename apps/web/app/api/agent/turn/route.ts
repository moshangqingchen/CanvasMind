import {
  parseJsonRequest,
  MAX_SMALL_JSON_BODY_BYTES,
} from "../../../../lib/api-validation";
import {
  AgentTurnSchema,
  type AgentEvent,
} from "../../../../lib/agent-contracts";
import { runAgentTurn } from "../../../../lib/agent-service";
import { agentError } from "../_shared";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const p = await parseJsonRequest(
    request,
    AgentTurnSchema,
    MAX_SMALL_JSON_BODY_BYTES,
  );
  if (!p.success) return p.response;
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: AgentEvent) => {
        if (!closed) {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          } catch {
            closed = true;
            abort.abort();
          }
        }
      };
      heartbeat = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          } catch {
            abort.abort();
          }
        }
      }, 15000);
      request.signal.addEventListener("abort", () => abort.abort(), {
        once: true,
      });
      void runAgentTurn(p.data, send, abort.signal)
        .catch(async (error) => {
          const payload = await agentError(error).json();
          send({ type: "error", message: payload.error });
        })
        .finally(() => {
          clearInterval(heartbeat);
          send({ type: "done" });
          if (!closed) {
            closed = true;
            controller.close();
          }
        });
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
