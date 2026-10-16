interface JsonScope { kind: "object" | "array"; path: string; key?: string; keyExpected: boolean }

/** Incremental JSON string decoder; nested decision strings reuse the same lexer. */
class JsonMessageLexer {
  private scopes: JsonScope[] = [];
  private string: { key: boolean; value: string; target: "message" | "decision" | null; scope?: JsonScope } | null = null;
  private escape = false;
  private unicode = "";
  private unicodeRemaining = 0;
  private nested: JsonMessageLexer | null = null;
  private invalid = false;
  private pendingSurrogate = "";

  constructor(private readonly append: (text: string) => void) {}

  private decoded(character: string) {
    const token = this.string;
    if (!token) return;
    if (token.key) { token.value += character; return; }
    if (token.target === "decision") { this.nested?.push(character); return; }
    if (token.target !== "message") return;
    if (this.pendingSurrogate) {
      character = this.pendingSurrogate + character;
      this.pendingSurrogate = "";
    }
    const last = character.charCodeAt(character.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) {
      this.pendingSurrogate = character.at(-1)!;
      character = character.slice(0, -1);
    }
    if (character) this.append(character);
  }

  push(text: string) {
    for (const character of text) {
      if (this.invalid) return;
      if (this.string) {
        if (this.unicodeRemaining) {
          if (!/^[a-f0-9]$/iu.test(character)) { this.invalid = true; return; }
          this.unicode += character;
          if (!--this.unicodeRemaining) { this.decoded(String.fromCharCode(Number.parseInt(this.unicode, 16))); this.unicode = ""; }
          continue;
        }
        if (this.escape) {
          this.escape = false;
          if (character === "u") { this.unicodeRemaining = 4; continue; }
          const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
          if (!(character in escapes)) { this.invalid = true; return; }
          this.decoded(escapes[character]);
          continue;
        }
        if (character === "\\") { this.escape = true; continue; }
        if (character === '"') {
          if (this.string.key && this.string.scope) {
            this.string.scope.key = this.string.value;
            this.string.scope.keyExpected = false;
          }
          if (this.pendingSurrogate) { this.append(this.pendingSurrogate); this.pendingSurrogate = ""; }
          this.string = null;
          continue;
        }
        if (character.charCodeAt(0) < 32) { this.invalid = true; return; }
        this.decoded(character);
        continue;
      }
      const scope = this.scopes.at(-1);
      if (character === '"') {
        const key = scope?.kind === "object" && scope.keyExpected;
        const decisionRoot = scope?.path === "" || scope?.path === "decision";
        const target = !key && decisionRoot && scope?.key === "message" ? "message"
          : !key && scope?.path === "" && scope.key === "decision" ? "decision" : null;
        this.string = { key: Boolean(key), value: "", target, scope };
        if (target === "decision") this.nested = new JsonMessageLexer(this.append);
      } else if (character === "{" || character === "[") {
        const path = !scope ? "" : scope.path ? `${scope.path}.${scope.key ?? "[]"}` : scope.key ?? "[]";
        this.scopes.push({ kind: character === "{" ? "object" : "array", path, keyExpected: character === "{" });
      } else if (character === "}" || character === "]") this.scopes.pop();
      else if (character === "," && scope?.kind === "object") { scope.key = undefined; scope.keyExpected = true; }
    }
  }
}

/** Preview only. The final complete response must still pass AgentDecisionSchema. */
export class AgentMessageProjection {
  private pending: string[] = [];
  private emitted = 0;
  private mode: "pending" | "json" | "plain" = "pending";
  private prefix = "";
  private readonly lexer = new JsonMessageLexer(text => {
    const remaining = 32_000 - this.emitted;
    if (remaining <= 0) return;
    const part = text.slice(0, remaining);
    this.pending.push(part); this.emitted += part.length;
  });

  push(text: string): string {
    this.pending = [];
    if (this.mode === "pending") {
      this.prefix += text;
      const prefix = this.prefix.trimStart();
      if (!prefix || (prefix.startsWith("`") && !prefix.includes("{"))) return "";
      this.mode = prefix.startsWith("{") || prefix.startsWith("[") || prefix.startsWith("`") ? "json" : "plain";
      text = this.prefix; this.prefix = "";
      if (this.mode === "json" && text.trimStart().startsWith("`")) text = text.slice(text.indexOf("{"));
    }
    if (this.mode === "json") this.lexer.push(text);
    else {
      const part = text.slice(0, Math.max(0, 32_000 - this.emitted));
      this.pending.push(part); this.emitted += part.length;
    }
    const delta = this.pending.join("");
    this.pending = [];
    return delta;
  }
}
