import {
  parseJsonRequest,
  MAX_SMALL_JSON_BODY_BYTES,
} from "../../../../lib/api-validation";
import {
  AgentTurnSchema,
  type AgentEvent,
  type AgentTurnStatus,
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
  const onAbort = () => abort.abort();
  if (request.signal.aborted) onAbort();
  else request.signal.addEventListener("abort", onAbort, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let terminalStatus: AgentTurnStatus = "succeeded";
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
      void runAgentTurn(p.data, send, abort.signal)
        .then(status => { terminalStatus = status; })
        .catch(async (error) => {
          terminalStatus = abort.signal.aborted || (error instanceof Error &&
            (error.name === "AbortError" || /分析已停止|请求已取消/u.test(error.message))) ? "cancelled" : "failed";
          const payload = await agentError(error).json();
          send({ type: "error", message: payload.error });
        })
        .finally(() => {
          clearInterval(heartbeat);
          request.signal.removeEventListener("abort", onAbort);
          send({ type: "done", status: terminalStatus });
          if (!closed) {
            closed = true;
            controller.close();
          }
        });
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
      request.signal.removeEventListener("abort", onAbort);
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
