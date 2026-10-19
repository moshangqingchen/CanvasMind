type Entries = WeakMap<object, Map<string, Promise<Response>>>;
const globalKey = "__superCanvasSubmissionIdentities";

/** Process-lifetime rejection fences; a new user submission must use a new identity. */
export async function withSubmissionIdentity(owner: object, canvasId: string, requestId: string,
  work: () => Promise<Response>): Promise<Response> {
  const scope = globalThis as typeof globalThis & { [globalKey]?: Entries };
  const owners = scope[globalKey] ??= new WeakMap();
  let entries = owners.get(owner);
  if (!entries) { entries = new Map(); owners.set(owner, entries); }
  const key = JSON.stringify([canvasId, requestId]);
  let pending = entries.get(key);
  if (!pending) {
    const registry = entries;
    pending = Promise.resolve().then(work).then(async response => {
      const body = await response.clone().json().catch(() => null) as { code?: unknown; submissionPhase?: unknown } | null;
      // Uncertain and accepted results are never converted into a refusal fence.
      if (!(body?.submissionPhase === "not_started" &&
          ["RUN_PREFLIGHT_REJECTED", "CANVAS_REVISION_CONFLICT"].includes(String(body.code)))) registry.delete(key);
      return response;
    }, error => { registry.delete(key); throw error; });
    registry.set(key, pending);
  }
  return (await pending).clone();
}
