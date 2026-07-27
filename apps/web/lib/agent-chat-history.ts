export interface AgentHistoryMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  error?: boolean;
  pending?: boolean;
  streaming?: boolean;
}

export interface AgentApiHistoryMessage {
  role: "assistant" | "user";
  content: string;
}

export const AGENT_HISTORY_MAX_TURNS = 10;
export const AGENT_HISTORY_MAX_CHARACTERS = 20_000;

export function agentHistoryStorageKey(canvasId: string): string {
  return `super-canvas:agent-history:v2:${canvasId}`;
}

export function legacyAgentHistoryStorageKey(canvasId: string): string {
  return `super-canvas:agent-history:${canvasId}`;
}

function messageTurnId(message: AgentHistoryMessage): string | null {
  const suffix = message.role === "user" ? "-user" : "-assistant";
  return message.id.endsWith(suffix) ? message.id.slice(0, -suffix.length) : null;
}

export function successfulAgentHistory(
  messages: readonly AgentHistoryMessage[],
  options: { maxTurns?: number; maxCharacters?: number } = {},
): AgentHistoryMessage[] {
  const maxTurns = Math.max(0, options.maxTurns ?? AGENT_HISTORY_MAX_TURNS);
  const maxCharacters = Math.max(
    0,
    options.maxCharacters ?? AGENT_HISTORY_MAX_CHARACTERS,
  );
  if (maxTurns === 0 || maxCharacters === 0) return [];

  const turns = new Map<
    string,
    {
      firstIndex: number;
      user?: AgentHistoryMessage;
      assistant?: AgentHistoryMessage;
      invalid: boolean;
    }
  >();

  messages.forEach((message, index) => {
    const turnId = messageTurnId(message);
    if (!turnId || !message.text.trim()) return;
    const turn = turns.get(turnId) ?? { firstIndex: index, invalid: false };
    if (message.error || message.pending || message.streaming) turn.invalid = true;
    if (message.role === "user") {
      if (turn.user) turn.invalid = true;
      turn.user = message;
    } else {
      if (turn.assistant) turn.invalid = true;
      turn.assistant = message;
    }
    turns.set(turnId, turn);
  });

  const completeTurns = Array.from(turns.values())
    .filter((turn) => !turn.invalid && turn.user && turn.assistant)
    .sort((left, right) => left.firstIndex - right.firstIndex)
    .map((turn) => [turn.user!, turn.assistant!] as const);

  const selected: Array<readonly [AgentHistoryMessage, AgentHistoryMessage]> = [];
  let characterCount = 0;
  for (let index = completeTurns.length - 1; index >= 0; index -= 1) {
    const turn = completeTurns[index];
    const turnCharacters = turn[0].text.length + turn[1].text.length;
    if (selected.length >= maxTurns || characterCount + turnCharacters > maxCharacters)
      break;
    selected.push(turn);
    characterCount += turnCharacters;
  }

  return selected.reverse().flatMap(([user, assistant]) => [user, assistant]);
}

export function agentApiHistory(
  messages: readonly AgentHistoryMessage[],
): AgentApiHistoryMessage[] {
  return successfulAgentHistory(messages).map((message) => ({
    role: message.role,
    content: message.text,
  }));
}
