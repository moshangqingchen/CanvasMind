type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Transport-only aggregation shared by chat, Responses and Google SSE. */
export function createModelStream(
  fail: (kind: "invalid" | "upstream", detail?: unknown) => never,
  onTextDelta?: (text: string) => void,
) {
  const choices = new Map<number, RecordValue>();
  const responseParts = new Map<string, string>();
  const googleCandidates = new Map<number, RecordValue>();
  let response: RecordValue = {}, google: RecordValue = {};
  let usage: unknown, citations: unknown[] = [], terminal = false, responses = false, isGoogle = false;
  let transportComplete = false;
  let source: string | undefined;
  const preview = (text: string, channel: string) => {
    if (!text) return;
    source ??= channel;
    if (source === channel) onTextDelta?.(text);
  };
  const accept = (frame: string) => {
    if (transportComplete) return;
    const lines = frame.split("\n");
    const eventName = lines.filter(line => line.startsWith("event:")).at(-1)?.slice(6).trim();
    const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    if (data.trim() === "[DONE]") { terminal = true; transportComplete = true; return; }
    let event: unknown;
    try { event = JSON.parse(data); } catch { return fail("invalid"); }
    if (!record(event)) return;
    const type = typeof event.type === "string" ? event.type : eventName;
    if (event.error || type === "error" || type === "response.failed") return fail("upstream", record(event.response) ? event.response : event);
    if (Array.isArray(event.citations)) citations = event.citations;
    if (Array.isArray(event.choices)) {
      for (const item of event.choices) {
        if (!record(item)) continue;
        const index = typeof item.index === "number" ? item.index : 0;
        const previous = choices.get(index) ?? { index, message: { role: "assistant", content: "" } };
        const message = previous.message as RecordValue;
        if (record(item.message)) Object.assign(message, item.message);
        const delta = record(item.delta) ? item.delta : item;
        for (const key of ["content", "text"] as const) {
          const text = typeof delta[key] === "string" ? delta[key] : Array.isArray(delta[key]) ? delta[key].flatMap(part => record(part) && typeof part.text === "string" ? [part.text] : []).join("") : "";
          if (text) { message.content = String(message.content ?? "") + text; if (index === 0) preview(text, "chat-content"); }
        }
        if (delta.parsed !== undefined) message.parsed = delta.parsed;
        if (Array.isArray(delta.annotations)) message.annotations = [...(Array.isArray(message.annotations) ? message.annotations : []), ...delta.annotations];
        if (Array.isArray(delta.tool_calls)) {
          const calls = Array.isArray(message.tool_calls) ? message.tool_calls as RecordValue[] : [];
          for (const call of delta.tool_calls) {
            if (!record(call)) continue;
            const n = typeof call.index === "number" ? call.index : 0;
            const prior = calls[n] ?? { function: {} };
            if (record(call.function)) {
              const fn = record(prior.function) ? prior.function : {};
              for (const key of ["name", "arguments"] as const) if (typeof call.function[key] === "string") {
                fn[key] = String(fn[key] ?? "") + call.function[key];
                if (key === "arguments" && index === 0 && n === 0) preview(call.function[key], "chat-arguments");
              }
              prior.function = fn;
            }
            calls[n] = prior;
          }
          message.tool_calls = calls;
        }
        if (item.finish_reason) { previous.finish_reason = item.finish_reason; terminal = true; }
        choices.set(index, previous);
      }
      if (event.usage) usage = event.usage;
    }
    if (type?.startsWith("response.")) {
      responses = true;
      if (record(event.response)) response = { ...response, ...event.response };
      if (type === "response.output_text.delta" && typeof event.delta === "string") {
        const key = `${event.output_index ?? 0}:${event.content_index ?? 0}`;
        responseParts.set(key, (responseParts.get(key) ?? "") + event.delta);
        preview(event.delta, `responses-content:${key}`);
      }
      if (type === "response.output_text.done" && typeof event.text === "string") responseParts.set(`${event.output_index ?? 0}:${event.content_index ?? 0}`, event.text);
      if (type === "response.completed") { response.status = "completed"; terminal = true; transportComplete = true; }
      if (type === "response.incomplete") return fail("invalid", "incomplete");
    }
    if (Array.isArray(event.candidates)) {
      isGoogle = true; google = { ...google, ...event };
      for (const candidate of event.candidates) {
        if (!record(candidate)) continue;
        const index = typeof candidate.index === "number" ? candidate.index : 0;
        const previous = googleCandidates.get(index) ?? { index, content: { role: "model", parts: [] } };
        const content = record(previous.content) ? previous.content : { role: "model", parts: [] };
        const parts = Array.isArray(content.parts) ? content.parts : [];
        if (record(candidate.content) && Array.isArray(candidate.content.parts)) for (const part of candidate.content.parts) {
          if (!record(part) || part.thought === true) continue;
          if (typeof part.text === "string") {
            const previousText = parts.at(-1);
            if (record(previousText) && typeof previousText.text === "string") previousText.text += part.text;
            else parts.push({ ...part });
            if (index === 0) preview(part.text, "google-content");
          } else parts.push(part);
        }
        googleCandidates.set(index, { ...previous, ...candidate, content: { ...content, parts } });
        if (candidate.finishReason && candidate.finishReason !== "FINISH_REASON_UNSPECIFIED") { terminal = true; transportComplete = true; }
      }
    }
    if (record(event.promptFeedback) && event.promptFeedback.blockReason) {
      isGoogle = true; google = { ...google, ...event }; terminal = true; transportComplete = true;
    }
  };
  return {
    accept,
    get complete() { return transportComplete; },
    finish() {
      if (!terminal) return fail("invalid", "interrupted");
      if (responses) {
        if (response.status !== "completed") return fail("invalid", "interrupted");
        return { ...response, ...(responseParts.size ? { output_text: [...responseParts.values()].join("\n") } : {}) };
      }
      if (isGoogle) return { ...google, candidates: [...googleCandidates.values()].sort((a, b) => Number(a.index) - Number(b.index)) };
      return { choices: [...choices.values()].sort((a, b) => Number(a.index) - Number(b.index)), usage, citations };
    },
  };
}
