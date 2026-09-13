import type { AgentEvent, AgentTurnInput } from "./agent-contracts";
export async function agentRequest<T>(
  path: string,
  body?: unknown,
  method = "POST",
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/agent${path}`, {
    method,
    cache: "no-store",
    signal,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload === null)
    throw new Error(payload?.error ?? `智能体请求失败（${response.status}）`);
  return payload as T;
}
export async function streamAgentTurn(
  input: AgentTurnInput,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
) {
  const response = await fetch("/api/agent/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ?? "智能体连接失败",
    );
  if (!response.body) throw new Error("智能体没有返回数据");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        for (const line of frame.split("\n"))
          if (line.startsWith("data: "))
            onEvent(JSON.parse(line.slice(6)) as AgentEvent);
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
