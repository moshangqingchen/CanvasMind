import { memo, type ReactNode } from "react";
import { agentMarkdown, safeAgentLink } from "../lib/agent-presentation";
import styles from "./creative-agent-panel.module.css";

function inline(text: string, depth = 0): ReactNode {
  if (depth > 4) return text;
  const pattern = /(`[^`\n]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g;
  const parts: ReactNode[] = []; let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    const value = match[0], key = match.index;
    if (value.startsWith("`")) parts.push(<code key={key}>{value.slice(1, -1)}</code>);
    else if (value.startsWith("**") || value.startsWith("__")) parts.push(<strong key={key}>{inline(value.slice(2, -2), depth + 1)}</strong>);
    else if (value.startsWith("*")) parts.push(<em key={key}>{value.slice(1, -1)}</em>);
    else {
      const link = /^\[([^\]]+)\]\((.+)\)$/.exec(value)!;
      const url = safeAgentLink(link[2]);
      parts.push(url ? <a key={key} href={url} target="_blank" rel="noopener noreferrer">{link[1]}</a> : value);
    }
    cursor = match.index + value.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export const MessageContent = memo(function MessageContent({ content }: { content: string }) {
  return <div className={styles.markdown}>{agentMarkdown(content).map((block, index) => {
    if (block.kind === "code") return <pre key={index} className={styles.codeBlock} aria-label={block.language ? `${block.language} 代码` : "代码"}><code>{block.text}</code></pre>;
    if (block.kind === "quote") return <blockquote key={index}>{inline(block.text)}</blockquote>;
    if (block.kind === "heading") {
      const Heading = block.level <= 2 ? "h3" : "h4";
      return <Heading key={index}>{inline(block.text)}</Heading>;
    }
    if (block.kind === "list") {
      const List = block.ordered ? "ol" : "ul";
      return <List key={index}>{block.items.map((item, i) => <li key={i}>{inline(item)}</li>)}</List>;
    }
    if (block.kind === "table") return <div key={index} className={styles.tableScroll}><table><thead><tr>{block.headers.map((cell, i) => <th scope="col" key={i}>{inline(cell)}</th>)}</tr></thead><tbody>{block.rows.map((row, i) => <tr key={i}>{block.headers.map((_, j) => <td key={j}>{inline(row[j] ?? "")}</td>)}</tr>)}</tbody></table></div>;
    return <p key={index}>{inline(block.text)}</p>;
  })}</div>;
});
