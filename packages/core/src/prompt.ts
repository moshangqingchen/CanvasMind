import { PromptPartSchema } from "./schemas.js";
import type {
  NormalizePromptOptions,
  PromptAssetDescriptor,
  PromptAssetRole,
  PromptPart,
  PromptPartInput,
  RenderPromptOptions,
} from "./types.js";

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replaceAll("\u0000", "");
}

function toPromptPart(value: unknown): PromptPart {
  if (typeof value === "string") {
    return { type: "text", text: value };
  }
  return PromptPartSchema.parse(value);
}

export function normalizePromptParts(
  input: PromptPartInput | unknown,
  options: NormalizePromptOptions = {},
): readonly PromptPart[] {
  const { dropBlankText = true, trimOuterWhitespace = false } = options;
  const values = Array.isArray(input) ? input : [input];
  const normalized: PromptPart[] = [];

  for (const value of values) {
    const part = toPromptPart(value);
    if (part.type === "asset") {
      normalized.push({ ...part, assetId: part.assetId.trim() });
      continue;
    }

    const text = normalizeText(part.text);
    const previous = normalized.at(-1);
    if (previous?.type === "text") {
      normalized[normalized.length - 1] = {
        type: "text",
        text: previous.text + text,
      };
    } else {
      normalized.push({ type: "text", text });
    }
  }

  let result = dropBlankText
    ? normalized.filter(
        (part) => part.type !== "text" || part.text.trim().length > 0,
      )
    : normalized;

  if (trimOuterWhitespace && result.length > 0) {
    result = result.map((part, index) => {
      if (part.type !== "text") {
        return part;
      }
      if (index === 0 && index === result.length - 1) {
        return { type: "text", text: part.text.trim() };
      }
      if (index === 0) {
        return { type: "text", text: part.text.trimStart() };
      }
      if (index === result.length - 1) {
        return { type: "text", text: part.text.trimEnd() };
      }
      return part;
    });

    if (dropBlankText) {
      result = result.filter(
        (part) => part.type !== "text" || part.text.length > 0,
      );
    }
  }

  return result;
}

export function serializePromptParts(input: PromptPartInput | unknown): string {
  return JSON.stringify(normalizePromptParts(input));
}

export function deserializePromptParts(
  serialized: string,
): readonly PromptPart[] {
  const parsed: unknown = JSON.parse(serialized);
  if (!Array.isArray(parsed)) {
    throw new TypeError("Serialized prompt must contain a JSON array");
  }
  return normalizePromptParts(parsed);
}

export const promptPartsToJSON = serializePromptParts;
export const promptPartsFromJSON = deserializePromptParts;
export const serializePrompt = serializePromptParts;
export const deserializePrompt = deserializePromptParts;
export const normalizePrompt = normalizePromptParts;

function renderResolvedAsset(
  resolved: string | PromptAssetDescriptor | null | undefined,
): string | undefined {
  if (typeof resolved === "string") {
    return resolved;
  }
  if (resolved === null || resolved === undefined) {
    return undefined;
  }
  if (resolved.url !== undefined) {
    return resolved.url;
  }
  return `@${resolved.name ?? resolved.id}`;
}

function fallbackAsset(
  assetId: string,
  fallback: NonNullable<RenderPromptOptions["unresolvedAsset"]>,
): string {
  switch (fallback) {
    case "empty":
      return "";
    case "id":
      return assetId;
    case "mention":
      return `@${assetId}`;
  }
}

function appendChunk(result: string, chunk: string, separator: string): string {
  if (result.length === 0 || chunk.length === 0) {
    return result + chunk;
  }
  if (/\s$/u.test(result) || /^\s/u.test(chunk)) {
    return result + chunk;
  }
  return result + separator + chunk;
}

export function renderPromptParts(
  input: PromptPartInput | unknown,
  options: RenderPromptOptions = {},
): string {
  const {
    resolveAsset,
    separator = " ",
    unresolvedAsset = "mention",
  } = options;

  let rendered = "";
  for (const part of normalizePromptParts(input)) {
    const chunk =
      part.type === "text"
        ? part.text
        : (renderResolvedAsset(resolveAsset?.(part.assetId, part.role)) ??
          fallbackAsset(part.assetId, unresolvedAsset));
    rendered = appendChunk(rendered, chunk, separator);
  }
  return rendered;
}

export const renderPrompt = renderPromptParts;
export const promptPartsToText = renderPromptParts;

export function extractPromptAssetIds(
  input: PromptPartInput | unknown,
  role?: PromptAssetRole,
): readonly string[] {
  const ids = new Set<string>();
  for (const part of normalizePromptParts(input)) {
    if (part.type === "asset" && (role === undefined || part.role === role)) {
      ids.add(part.assetId);
    }
  }
  return [...ids];
}

export const getPromptAssetIds = extractPromptAssetIds;
