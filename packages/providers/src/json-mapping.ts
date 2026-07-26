const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export class JsonMappingError extends Error {
  public override readonly name = "JsonMappingError";

  public constructor(message: string) {
    super(message);
  }
}

function assertSafeKey(key: string): void {
  if (FORBIDDEN_KEYS.has(key)) {
    throw new JsonMappingError(`Unsafe object key is not allowed: ${key}`);
  }
}

function decodePointerToken(token: string): string {
  if (/~(?:[^01]|$)/u.test(token)) {
    throw new JsonMappingError(
      `Invalid JSON Pointer escape in token: ${token}`,
    );
  }
  const decoded = token.replace(/~1/gu, "/").replace(/~0/gu, "~");
  assertSafeKey(decoded);
  return decoded;
}

function isArrayIndex(token: string): boolean {
  return token === "-" || /^(?:0|[1-9]\d*)$/u.test(token);
}

function arrayIndex(token: string, length: number): number {
  if (token === "-") return length;
  if (!isArrayIndex(token))
    throw new JsonMappingError(`Expected an array index, received: ${token}`);
  const index = Number(token);
  if (!Number.isSafeInteger(index) || index > 10_000) {
    throw new JsonMappingError(`Array index is too large: ${token}`);
  }
  return index;
}

/**
 * Apply an RFC 6901 JSON Pointer write. Missing containers are created, and
 * prototype-polluting keys are rejected. The returned value is the new root.
 */
export function setJsonPointer(
  root: unknown,
  pointer: string,
  value: unknown,
): unknown {
  if (pointer === "") return value;
  if (!pointer.startsWith("/")) {
    throw new JsonMappingError("JSON Pointer must be empty or begin with '/'");
  }
  const tokens = pointer.slice(1).split("/").map(decodePointerToken);
  if (tokens.length === 0) return value;
  let result: unknown = root;
  if (typeof result !== "object" || result === null) {
    result = isArrayIndex(tokens[0] ?? "") ? [] : {};
  }
  let current = result as Record<string, unknown> | unknown[];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined)
      throw new JsonMappingError("Invalid JSON Pointer token");
    const isLast = index === tokens.length - 1;
    if (Array.isArray(current)) {
      const position = arrayIndex(token, current.length);
      if (isLast) {
        current[position] = value;
        break;
      }
      const nextToken = tokens[index + 1] ?? "";
      const existing = current[position];
      if (typeof existing !== "object" || existing === null) {
        current[position] = isArrayIndex(nextToken) ? [] : {};
      }
      current = current[position] as Record<string, unknown> | unknown[];
      continue;
    }
    if (isLast) {
      current[token] = value;
      break;
    }
    const nextToken = tokens[index + 1] ?? "";
    const existing = Object.hasOwn(current, token) ? current[token] : undefined;
    if (typeof existing !== "object" || existing === null) {
      current[token] = isArrayIndex(nextToken) ? [] : {};
    }
    current = current[token] as Record<string, unknown> | unknown[];
  }
  return result;
}

type PathToken =
  | { type: "property"; key: string }
  | { type: "index"; index: number }
  | { type: "wildcard" };

function decodeSingleQuoted(content: string): string {
  let result = "";
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index] ?? "";
    if (character !== "\\") {
      result += character;
      continue;
    }
    index += 1;
    const escaped = content[index];
    if (escaped === undefined)
      throw new JsonMappingError("Invalid JSONPath string escape");
    const escapes: Record<string, string> = {
      "'": "'",
      "\\": "\\",
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
    };
    result += escapes[escaped] ?? escaped;
  }
  return result;
}

function parseJsonPath(path: string): PathToken[] {
  if (!path.startsWith("$"))
    throw new JsonMappingError("JSONPath must begin with '$'");
  const tokens: PathToken[] = [];
  let position = 1;
  while (position < path.length) {
    if (path[position] === ".") {
      if (path[position + 1] === ".") {
        throw new JsonMappingError("Recursive descent is not supported");
      }
      position += 1;
      if (path[position] === "*") {
        tokens.push({ type: "wildcard" });
        position += 1;
        continue;
      }
      const property = /^[A-Za-z_$][A-Za-z0-9_$-]*/u.exec(path.slice(position));
      if (!property)
        throw new JsonMappingError(`Invalid JSONPath at position ${position}`);
      const key = property[0];
      assertSafeKey(key);
      tokens.push({ type: "property", key });
      position += key.length;
      continue;
    }
    if (path[position] === "[") {
      const rest = path.slice(position);
      const match =
        /^\[(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\d+)|(\*))\]/u.exec(
          rest,
        );
      if (!match) {
        throw new JsonMappingError(
          "Unsupported JSONPath bracket expression; filters, scripts, slices and unions are disabled",
        );
      }
      if (match[4] === "*") {
        tokens.push({ type: "wildcard" });
      } else if (match[3] !== undefined) {
        const index = Number(match[3]);
        if (!Number.isSafeInteger(index) || index > 10_000) {
          throw new JsonMappingError(
            `JSONPath array index is too large: ${match[3]}`,
          );
        }
        tokens.push({ type: "index", index });
      } else {
        let key: string;
        if (match[1] !== undefined) {
          try {
            key = JSON.parse(`"${match[1]}"`) as string;
          } catch {
            throw new JsonMappingError("Invalid JSONPath string escape");
          }
        } else {
          key = decodeSingleQuoted(match[2] ?? "");
        }
        assertSafeKey(key);
        tokens.push({ type: "property", key });
      }
      position += match[0].length;
      continue;
    }
    throw new JsonMappingError(`Invalid JSONPath at position ${position}`);
  }
  return tokens;
}

/**
 * Read the deliberately small, deterministic JSONPath subset used by REST
 * connectors: property access, numeric indices and wildcards only.
 */
export function readJsonPath(root: unknown, path: string): unknown {
  const tokens = parseJsonPath(path);
  let values: unknown[] = [root];
  let usedWildcard = false;
  for (const token of tokens) {
    const next: unknown[] = [];
    for (const value of values) {
      if (token.type === "wildcard") {
        usedWildcard = true;
        if (Array.isArray(value)) next.push(...value);
        else if (typeof value === "object" && value !== null) {
          next.push(...Object.values(value));
        }
        continue;
      }
      if (token.type === "index") {
        if (Array.isArray(value) && token.index < value.length)
          next.push(value[token.index]);
        continue;
      }
      if (
        typeof value === "object" &&
        value !== null &&
        Object.hasOwn(value, token.key)
      ) {
        next.push((value as Record<string, unknown>)[token.key]);
      }
    }
    values = next;
  }
  return usedWildcard ? values : values[0];
}

export function cloneJsonValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    throw new JsonMappingError(
      "REST connector templates must contain cloneable JSON values",
    );
  }
}

export const getJsonPath = readJsonPath;
export const setJsonPointerValue = setJsonPointer;
export const getByJsonPath = readJsonPath;
export const setByJsonPointer = setJsonPointer;
