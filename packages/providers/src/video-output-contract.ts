const outputFields = new Set(["size", "width", "height", "resolution", "ratio", "aspect_ratio", "aspectRatio",
  "duration", "seconds", "duration_seconds", "quality", "fps", "frame_rate", "audio", "generate_audio", "generateAudio"]);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Snapshot the actual outgoing body, after mode-dependent fields were omitted.
 * Never retain prompts, auth, media URLs or the request body in the task envelope. */
export function videoOutputParametersFromBody(body: BodyInit | undefined): Record<string, unknown> {
  let values: Record<string, unknown> = {};
  if (typeof body === "string") {
    try { values = record(JSON.parse(body)); } catch { return {}; }
    values = { ...values, ...record(record(values.generationConfig).videoConfig) };
  } else if (body instanceof FormData) {
    for (const key of outputFields) if (typeof body.get(key) === "string") values[key] = body.get(key);
  }
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => outputFields.has(key) &&
    (typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) ||
      typeof value === "string" && value.length <= 120 && !value.includes("://")))
    .map(([key, value]) => [key, ["audio", "generate_audio", "generateAudio"].includes(key) && (value === "true" || value === "false") ? value === "true" : value]));
}
