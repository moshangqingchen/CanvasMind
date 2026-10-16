export type MessageBlock = { kind: "text"; text: string } | { kind: "code"; text: string; language: string };

/** Present fenced code as text, never as executable markup. Incomplete fences stay readable. */
export function agentMessageBlocks(content: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const fence = /```([^\r\n]*)\r?\n([\s\S]*?)```/g;
  let cursor = 0;
  for (const match of content.matchAll(fence)) {
    if (match.index > cursor) blocks.push({ kind: "text", text: content.slice(cursor, match.index) });
    blocks.push({ kind: "code", language: match[1].trim(), text: match[2].replace(/\r?\n$/, "") });
    cursor = match.index + match[0].length;
  }
  if (cursor < content.length) blocks.push({ kind: "text", text: content.slice(cursor) });
  return blocks;
}
