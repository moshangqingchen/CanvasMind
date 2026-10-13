/** Request identity only: never an authentication value, task ID or result URL. */
export interface ProviderRequestEvidence {
  requestIds: string[];
  observations: Array<{ requestId: string; source: "header:x-request-id" | "header:x-oneapi-request-id" | "json:request_id" | "json:upstream_request_id" | "json:error.request_id" }>;
}

function safeRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value) &&
    !/^(?:sk-|eyJ|Bearer|Basic|https?:|data:)/iu.test(value);
}

export function storedProviderRequestEvidence(value: unknown): ProviderRequestEvidence | undefined {
  if (!value || typeof value !== "object") return;
  const raw = (value as { observations?: unknown }).observations;
  if (!Array.isArray(raw)) return;
  const observations: ProviderRequestEvidence["observations"] = [];
  for (const row of raw.slice(0,8)) {
    if (!row || typeof row !== "object") continue;
    const { requestId, source } = row as { requestId?: unknown; source?: unknown };
    if (!safeRequestId(requestId) || !["header:x-request-id", "header:x-oneapi-request-id", "json:request_id", "json:upstream_request_id", "json:error.request_id"].includes(String(source))) continue;
    if (!observations.some(o => o.requestId === requestId && o.source === source))
      observations.push({ requestId, source: source as ProviderRequestEvidence["observations"][number]["source"] });
  }
  return observations.length ? { requestIds: [...new Set(observations.map(o => o.requestId))], observations } : undefined;
}

export function providerResponseRequestEvidence(headers: Headers, body?: unknown, previous?: ProviderRequestEvidence): ProviderRequestEvidence | undefined {
  const observations = [...(storedProviderRequestEvidence(previous)?.observations ?? [])];
  const add = (requestId: unknown, source: ProviderRequestEvidence["observations"][number]["source"]) => {
    if (safeRequestId(requestId)) observations.push({ requestId, source });
  };
  add(headers.get("x-request-id"), "header:x-request-id");
  // New API uses this response header for its actual upstream request identity.
  add(headers.get("x-oneapi-request-id"), "header:x-oneapi-request-id");
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const json = body as Record<string, unknown>;
    add(json.request_id, "json:request_id");
    add(json.upstream_request_id, "json:upstream_request_id");
    if (json.error && typeof json.error === "object") add((json.error as Record<string,unknown>).request_id, "json:error.request_id");
  }
  return storedProviderRequestEvidence({ observations });
}
