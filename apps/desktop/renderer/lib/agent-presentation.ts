import type { AgentMessage, AgentSession } from "./agent-contracts";

export function agentRelativeTime(value: string | undefined, now = Date.now()): string {
  const time = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return "—";
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 0) return new Date(time).toLocaleDateString("zh-CN");
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)} 天前`;
  return new Date(time).toLocaleDateString("zh-CN");
}

export function hasAgentTurnReply(session: AgentSession, requestId: string): boolean {
  return session.messages.some(message => message.role === "assistant" && message.metadata.requestId === requestId &&
    ["message", "artifact", "clarify", "proposal"].includes(String(message.metadata.kind)));
}

export const agentOperationNames: Readonly<Record<string, string>> = {
  "image.generate": "图片生成", "image.edit": "图片编辑", "video.generate": "视频生成",
  "video.edit": "视频编辑", "video.extend": "视频续写", "text.generate": "文字创作", "audio.generate": "音频生成",
};
export const agentToolNames: Readonly<Record<string, string>> = {
  read_canvas: "读取当前画布", list_models: "检查可用模型", inspect_assets: "读取参考素材", read_results: "检查生成结果",
};

/** Consecutive observations remain available, in order, behind one disclosure. */
export function agentConversationItems(messages: readonly AgentMessage[]): AgentMessage[] {
  const items: AgentMessage[] = [];
  for (const message of messages) {
    if (message.metadata.kind !== "tool") { items.push(message); continue; }
    const previous = items.at(-1);
    if (previous?.metadata.kind === "timeline") {
      const steps = previous.metadata.steps as AgentMessage[];
      items[items.length - 1] = { ...previous, metadata: { ...previous.metadata, steps: [...steps, message] } };
    } else items.push({ ...message, metadata: { kind: "timeline", steps: [message] } });
  }
  return items;
}

/** Conversion is an explicit new request, never a reinterpretation of the original chat. */
export function agentPlanRequest(user: string, assistant: string): string {
  return `请把下面讨论整理成待我检查的画布方案。先规划，不执行生成。\n\n我的想法：\n${user}\n\n讨论结果：\n${assistant}`;
}

export function agentReplyContext(messages: readonly AgentMessage[], replyId: string): { message: string; attachmentAssetIds: string[] } {
  const index = messages.findIndex(message => message.id === replyId && message.role === "assistant");
  const user = index < 0 ? undefined : messages.slice(0, index).reverse().find(message => message.role === "user");
  const raw = user?.metadata.attachmentAssetIds;
  return { message: user?.content ?? "", attachmentAssetIds: Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === "string"))] : [] };
}

export type MarkdownBlock = { kind: "paragraph" | "quote"; text: string } |
  { kind: "heading"; text: string; level: number } | { kind: "code"; text: string; language: string } |
  { kind: "list"; ordered: boolean; items: string[] } | { kind: "table"; headers: string[]; rows: string[][] };

/** A bounded text parser: no HTML, image fetches, or executable markup. */
export function agentMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^\s*```([^`]*)$/.exec(line);
    if (fence) {
      const text: string[] = []; i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) text.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ kind: "code", language: fence[1].trim(), text: text.join("\n") }); continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) { blocks.push({ kind: "heading", text: heading[2], level: heading[1].length }); i++; continue; }
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      const headers = cells(line), rows: string[][] = []; i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(cells(lines[i++]).slice(0, headers.length));
      blocks.push({ kind: "table", headers, rows }); continue;
    }
    const list = /^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(line);
    if (list) {
      const items: string[] = []; const ordered = Boolean(list[2]);
      while (i < lines.length) {
        const match = /^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(lines[i]);
        if (!match || Boolean(match[2]) !== ordered) break;
        items.push(match[3]); i++;
      }
      blocks.push({ kind: "list", ordered, items }); continue;
    }
    if (/^>\s?/.test(line)) {
      const text: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) text.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ kind: "quote", text: text.join("\n") }); continue;
    }
    const text = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^(?:#{1,6}\s|\s*```|>\s?|\s*(?:[-+*]|\d+[.)])\s)/.test(lines[i]) && !(lines[i].includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? ""))) text.push(lines[i++]);
    blocks.push({ kind: "paragraph", text: text.join("\n") });
  }
  return blocks;
}

export function safeAgentLink(url: string): string | undefined {
  try { const parsed = new URL(url); return ["https:", "http:", "mailto:"].includes(parsed.protocol) ? parsed.href : undefined; }
  catch { return undefined; }
}
