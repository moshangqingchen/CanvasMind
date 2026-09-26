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
  let receivedDone = false;
  const acceptFrame = (frame: string) => {
    const data = frame.split("\n").filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    const event = JSON.parse(data) as AgentEvent;
    if (event.type === "done") receivedDone = true;
    onEvent(event);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/gu, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        acceptFrame(frame);
      }
      if (done) { acceptFrame(buffer); break; }
    }
    if (!receivedDone) throw new Error("智能体连接已中断，任务记录已保留，请重新编辑后发送。");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
