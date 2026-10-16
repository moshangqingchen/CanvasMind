import type { AgentEvent, AgentTurnInput } from "./agent-contracts";

// A session event contains the complete conversation and plans. Keep ample room
// for long histories; bound only one frame, never the whole stream/conversation.
export const MAX_AGENT_PARTIAL_FRAME_CHARACTERS = 64 * 1024 * 1024;
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
  options: { maxPartialFrameCharacters?: number } = {},
) {
  const maximumFrameCharacters = options.maxPartialFrameCharacters ?? MAX_AGENT_PARTIAL_FRAME_CHARACTERS;
  if (!Number.isSafeInteger(maximumFrameCharacters) || maximumFrameCharacters < 1 ||
      maximumFrameCharacters > MAX_AGENT_PARTIAL_FRAME_CHARACTERS)
    throw new Error("Invalid Agent partial-frame memory limit");
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
  let frameParts: string[] = [];
  let frameCharacters = 0;
  let pendingCarriageReturn = false;
  let receivedDone = false;
  const acceptFrame = (frame: string) => {
    signal.throwIfAborted();
    const data = frame.split("\n").filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    const event = JSON.parse(data) as AgentEvent;
    if (event.type === "done") receivedDone = true;
    onEvent(event);
  };
  const appendFramePart = (part: string) => {
    if (!part) return;
    const nextLength = frameCharacters + part.length;
    // A final LF may be the first half of a separator split across reads.
    if (nextLength - Number(part.endsWith("\n")) > maximumFrameCharacters)
      throw new Error("智能体响应过大或格式不完整，已停止读取以保护内存。请手动重试，或新建对话继续。");
    frameCharacters = nextLength;
    // Merge similarly sized fragments, keeping tiny network chunks from adding
    // an unbounded number of array entries/rope nodes below the character limit.
    while (frameParts.length && frameParts[frameParts.length - 1].length <= part.length)
      part = [frameParts.pop()!, part].join("");
    frameParts.push(part);
  };
  const finishFrame = () => {
    const frame = frameParts.join("");
    frameParts = [];
    frameCharacters = 0;
    acceptFrame(frame);
  };
  const consumeChunk = (chunk: string, final: boolean) => {
    if (pendingCarriageReturn) chunk = `\r${chunk}`;
    pendingCarriageReturn = !final && chunk.endsWith("\r");
    if (pendingCarriageReturn) chunk = chunk.slice(0, -1);
    chunk = chunk.replace(/\r\n/gu, "\n");
    let offset = 0;
    if (chunk.startsWith("\n") && frameParts[frameParts.length - 1]?.endsWith("\n")) {
      const last = frameParts.pop()!.slice(0, -1);
      if (last) frameParts.push(last);
      frameCharacters--;
      finishFrame();
      offset = 1;
    }
    // Parse each frame independently: one transport chunk can legitimately
    // contain many frames whose combined length exceeds the per-frame limit.
    while (!receivedDone) {
      signal.throwIfAborted();
      const end = chunk.indexOf("\n\n", offset);
      if (end < 0) { appendFramePart(chunk.slice(offset)); break; }
      appendFramePart(chunk.slice(offset, end));
      finishFrame();
      offset = end + 2;
    }
  };
  const onAbort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    signal.throwIfAborted();
    while (!receivedDone) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      consumeChunk(decoder.decode(value, { stream: !done }), done);
      if (done) {
        if (!receivedDone) finishFrame();
        break;
      }
    }
    signal.throwIfAborted();
    if (!receivedDone) throw new Error("智能体连接已中断，任务记录已保留，请重新编辑后发送。");
  } finally {
    frameParts = [];
    frameCharacters = 0;
    signal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
