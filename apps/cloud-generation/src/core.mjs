import { readJsonPath } from "../../../packages/providers/src/json-mapping.ts";
const DAY = 24 * 60 * 60 * 1000;
const MAX_INPUT = 64 * 1024 * 1024;
const MAX_OUTPUT = 96 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const stateKey = id => `jobs/${id}/state.json`;
const responseKey = id => `jobs/${id}/response`;
const json = (value, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
const now = env => env.clock?.() ?? Date.now();
const fetcher = env => env.fetchImpl ?? fetch;

async function secretKey(secret, purpose) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${purpose}:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function protect(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await secretKey(secret, "request"), encoder.encode(JSON.stringify(value)));
  return JSON.stringify({ iv: Array.from(iv), value: Array.from(new Uint8Array(encrypted)) });
}
async function unprotect(value, secret) {
  const data = JSON.parse(value);
  return JSON.parse(decoder.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(data.iv) }, await secretKey(secret, "request"), new Uint8Array(data.value))));
}
async function authorized(request, env) {
  const actual = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.RELAY_TOKEN ?? ""}`;
  if (!env.RELAY_TOKEN || actual.length !== expected.length) return false;
  const a = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(actual)));
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(expected)));
  return a.every((value, index) => value === b[index]);
}
function publicUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname) || /\.(?:localhost|local|internal|test)$/i.test(url.hostname)) throw new Error("Invalid public URL");
  return url;
}
function manifestFrom(request, env) {
  const raw = request.headers.get("x-supercanvas-manifest") ?? "";
  if (!raw || raw.length > 48_000) throw new Error("Invalid manifest");
  const manifest = JSON.parse(decoder.decode(Uint8Array.from(atob(raw), char => char.charCodeAt(0))));
  const url = publicUrl(manifest.url);
  const allowed = String(env.ALLOWED_HOSTS ?? "").split(",").map(host => host.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(url.hostname)) throw new Error("Supplier host is not enabled for this cloud service");
  if (!["POST", "PUT", "GET"].includes(manifest.method)) throw new Error("Invalid method");
  const headers = new Headers(manifest.headers);
  for (const name of ["host", "connection", "content-length", "transfer-encoding", "cf-access-client-secret", "cf-access-client-id"]) headers.delete(name);
  headers.set("accept-encoding", "identity");
  let polling;
  if (manifest.polling) {
    const p = manifest.polling;
    const pollUrl = publicUrl(p.urlTemplate);
    if (!allowed.includes(pollUrl.hostname) || !["GET", "POST"].includes(p.method)) throw new Error("Invalid polling endpoint");
    if (p.body !== undefined && (typeof p.body !== "string" || p.body.length > 100_000)) throw new Error("Invalid polling body");
    polling = { ...p, urlTemplate: pollUrl.href, intervalMs: Math.max(2000, Math.min(15000, Number(p.intervalMs) || 3000)) };
  }
  return { url: url.href, method: manifest.method, headers: Object.fromEntries(headers), ...(polling ? { polling } : {}),
    maxResponseBytes: Math.min(MAX_OUTPUT, Math.max(1024, Number(manifest.maxResponseBytes) || 50 * 1024 * 1024)) };
}
async function getState(env, id) { return (await env.RESULTS.get(stateKey(id)))?.json() ?? null; }
async function putState(env, id, value) { await env.RESULTS.put(stateKey(id), JSON.stringify(value)); }
async function workflowExists(env, id) {
  try { return await (await env.GENERATION.get(id)).status(); }
  catch (error) {
    if (/not found|does not exist|not exist|404/i.test(String(error))) return null;
    throw error;
  }
}
// R2 requires known-length bodies. Bounded multipart chunks also avoid buffering
// large Base64 responses inside the Worker's 128 MB memory limit.
export async function storeStream(bucket, key, stream, maxBytes, options = {}) {
  if (!stream) return bucket.put(key, new Uint8Array(), options);
  const reader = stream.getReader();
  const chunkSize = 5 * 1024 * 1024;
  let buffer = new Uint8Array(chunkSize); let used = 0; let total = 0; let upload;
  const parts = [];
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new Error("Response too large");
      let offset = 0;
      while (offset < next.value.byteLength) {
        const count = Math.min(chunkSize - used, next.value.byteLength - offset);
        buffer.set(next.value.subarray(offset, offset + count), used); used += count; offset += count;
        if (used === chunkSize) {
          upload ??= await bucket.createMultipartUpload(key, options);
          parts.push(await upload.uploadPart(parts.length + 1, buffer));
          buffer = new Uint8Array(chunkSize); used = 0;
        }
      }
    }
    if (!upload) return await bucket.put(key, buffer.subarray(0, used), options);
    if (used) parts.push(await upload.uploadPart(parts.length + 1, buffer.subarray(0, used)));
    return await upload.complete(parts);
  } catch (error) {
    await reader.cancel().catch(() => {});
    await upload?.abort().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}
async function signAsset(env, id, index, expires) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(env.ENCRYPTION_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${id}:${index}:${expires}`));
  return Array.from(new Uint8Array(signature), n => n.toString(16).padStart(2, "0")).join("");
}
function replaceStrings(value, replacements) {
  if (typeof value === "string") return replacements[value] ?? value;
  if (Array.isArray(value)) return value.map(item => replaceStrings(item, replacements));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceStrings(item, replacements)]));
  return value;
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const reference = /^\/v1\/references\/([a-f0-9]{64})$/.exec(url.pathname);
  if (reference && request.method === "GET" && env.RESULTS && env.ENCRYPTION_KEY) {
    const expires = Number(url.searchParams.get("expires"));
    if (!Number.isSafeInteger(expires) || expires <= now(env) || expires > now(env) + DAY) return json({ error: "Expired" }, 410);
    if (url.searchParams.get("signature") !== await signAsset(env, reference[1], "reference", expires)) return json({ error: "Unauthorized" }, 401);
    const stored = await env.RESULTS.get(`inputs/references/${reference[1]}`);
    if (!stored || Number(stored.customMetadata?.expiresAt) <= now(env)) return json({ error: "Expired" }, 410);
    return new Response(stored.body, { headers: { "content-type": stored.httpMetadata?.contentType ?? "image/png", "cache-control": "private, no-store" } });
  }
  const asset = /^\/v1\/jobs\/([a-f0-9]{64})\/assets\/(\d+)$/.exec(url.pathname);
  if (asset && request.method === "GET" && env.RESULTS && env.ENCRYPTION_KEY) {
    const [_, id, index] = asset;
    const expires = Number(url.searchParams.get("expires"));
    const state = await getState(env, id);
    if (!state || state.expiresAt <= now(env) || !Number.isSafeInteger(expires) || expires <= now(env) || expires > state.expiresAt) return json({ error: "Expired" }, 410);
    if (url.searchParams.get("signature") !== await signAsset(env, id, index, expires)) return json({ error: "Unauthorized" }, 401);
    const stored = await env.RESULTS.get(`jobs/${id}/assets/${index}`);
    if (!stored) return json({ error: "Not found" }, 404);
    return new Response(stored.body, { headers: { "content-type": stored.httpMetadata?.contentType ?? "application/octet-stream", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  }
  if (!await authorized(request, env)) return json({ error: "Unauthorized" }, 401);
  if (url.pathname === "/v1/health" && request.method === "GET") return json({ service: "super-canvas-generation-v1",
    ready: Boolean(env.RESULTS && env.GENERATION && env.ENCRYPTION_KEY), storage: Boolean(env.RESULTS), retentionHours: 24 });
  if (!env.RESULTS || !env.ENCRYPTION_KEY) return json({ error: "R2 storage is not configured" }, 503);
  if (reference && request.method === "PUT") {
    const type = request.headers.get("content-type") ?? "";
    const length = Number(request.headers.get("content-length"));
    if (!type.startsWith("image/") || !Number.isSafeInteger(length) || length <= 0 || length > MAX_INPUT) return json({ error: "Invalid reference image" }, 400);
    const key = `inputs/references/${reference[1]}`;
    const existing = await env.RESULTS.head(key);
    let expiresAt = Number(existing?.customMetadata?.expiresAt);
    if (!existing || expiresAt <= now(env)) {
      expiresAt = now(env) + DAY;
      await storeStream(env.RESULTS, key, request.body, MAX_INPUT, { httpMetadata: { contentType: type }, customMetadata: { expiresAt: String(expiresAt) } });
    }
    return json({ url: `${url.origin}${url.pathname}?expires=${expiresAt}&signature=${await signAsset(env, reference[1], "reference", expiresAt)}` });
  }
  const match = /^\/v1\/jobs\/([a-f0-9]{64})(\/response)?$/.exec(url.pathname);
  if (!match) return json({ error: "Not found" }, 404);
  const id = match[1];
  const state = await getState(env, id);
  if (state && state.expiresAt <= now(env)) return json({ state: "expired", error: "云端保存的 24 小时已到期，图片和请求内容已过期" }, 410);
  if (request.method === "GET") {
    if (!state) {
      if (await workflowExists(env, id)) return json({ state: "queued" });
      return json({ error: "Not found" }, 404);
    }
    if (!match[2]) return json({ state: state.state, phase: state.phase, createdAt: state.createdAt, completedAt: state.completedAt, expiresAt: state.expiresAt, error: state.error, transport: state.transport });
    if (state.state !== "complete") return json({ error: "Not ready" }, 409);
    const stored = await env.RESULTS.get(responseKey(id));
    if (!stored) return json({ error: "Response is unavailable" }, 410);
    const outgoing = { "content-type": state.contentType || "application/json", "cache-control": "private, no-store", "x-supercanvas-response": "1" };
    if (state.upstreamTaskId) outgoing["x-supercanvas-upstream-task"] = encodeURIComponent(state.upstreamTaskId);
    if (state.replacements && Object.keys(state.replacements).length) {
      const replacements = {};
      for (const [source, index] of Object.entries(state.replacements)) {
        const expires = state.expiresAt;
        replacements[source] = `${url.origin}/v1/jobs/${id}/assets/${index}?expires=${expires}&signature=${await signAsset(env, id, index, expires)}`;
      }
      return new Response(JSON.stringify(replaceStrings(await stored.json(), replacements)), { status: state.httpStatus, headers: outgoing });
    }
    return new Response([204, 205, 304].includes(state.httpStatus) ? null : stored.body, { status: state.httpStatus, headers: outgoing });
  }
  if (request.method !== "PUT" || match[2]) return json({ error: "Method not allowed" }, 405);
  if (state || await workflowExists(env, id)) return json({ id, state: state?.state ?? "queued" }, 202);
  let manifest;
  try { manifest = manifestFrom(request, env); } catch (error) { return json({ error: error.message }, 400); }
  const length = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_INPUT) return json({ error: "Request must be at most 64 MB" }, 413);
  const inputPrefix = `inputs/${id}/${crypto.randomUUID()}`;
  try {
    await storeStream(env.RESULTS, `${inputPrefix}/body`, request.body, MAX_INPUT);
    await env.RESULTS.put(`${inputPrefix}/manifest`, await protect(manifest, env.ENCRYPTION_KEY));
  } catch (error) {
    await env.RESULTS.delete([`${inputPrefix}/body`, `${inputPrefix}/manifest`]);
    throw error;
  }
  try {
    await env.GENERATION.create({ id, params: { id, inputPrefix, createdAt: now(env) } });
  } catch (error) {
    // Creation can succeed while its acknowledgement is lost. Keep this input
    // until workflow/lifecycle cleanup; it may belong to the running instance.
    if (!await workflowExists(env, id)) throw error;
  }
  return json({ id, state: "queued" }, 202);
}

async function archiveLinkedImages(env, id, stored) {
  if (stored.size > 1024 * 1024) return {};
  let data; try { data = await stored.json(); } catch { return {}; }
  const urls = [];
  function visit(value, key = "") {
    if (urls.length >= 32) throw new Error("Too many image links");
    if (typeof value === "string" && /^(?:url|image_url|download_url|output_url|image|images|output|outputs|data|result|results)$/i.test(key) && value.startsWith("https://")) urls.push(value);
    else if (Array.isArray(value)) value.forEach(item => visit(item, key));
    else if (value && typeof value === "object") Object.entries(value).forEach(([name, item]) => visit(item, name));
  }
  visit(data);
  const replacements = {};
  for (const source of new Set(urls)) {
    {
      publicUrl(source);
      const response = await fetcher(env)(source, { redirect: "manual", signal: AbortSignal.timeout(120_000) });
      const mime = response.headers.get("content-type")?.split(";")[0] ?? "";
      if (!response.ok || !mime.startsWith("image/") || !response.body) { await response.body?.cancel(); throw new Error("Image download failed"); }
      const index = Object.keys(replacements).length;
      await storeStream(env.RESULTS, `jobs/${id}/assets/${index}`, response.body, MAX_OUTPUT, { httpMetadata: { contentType: mime } });
      replacements[source] = index;
    }
  }
  return replacements;
}

function mapped(value, mapping, name) {
  return [mapping?.[`${name}Path`], ...(mapping?.[`${name}FallbackPaths`] ?? [])].filter(path => typeof path === "string")
    .map(path => readJsonPath(value, path)).find(item => item !== undefined && item !== null && item !== "");
}
function nativeStatus(remote, mapping, polling) {
  const raw = mapped(remote, mapping, "status");
  const status = String(raw ?? "").toLowerCase();
  return polling.statusMap?.[String(raw)] ?? polling.statusMap?.[status] ??
    ({ success: "succeeded", completed: "succeeded", complete: "succeeded", succeeded: "succeeded", failed: "failed", error: "failed", cancelled: "cancelled" }[status] ?? "running");
}
async function inspectSmallResponse(response) {
  if (!response.body) return { response, remote: {} };
  const [inspect, original] = response.body.tee();
  const reader = inspect.getReader(); let size = 0; const chunks = [];
  while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > 1024 * 1024) { void reader.cancel(); return { response: new Response(original, { status: response.status, headers: response.headers }) }; }
    chunks.push(next.value);
  }
  void original.cancel();
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { response: new Response(bytes, { status: response.status, headers: response.headers }), remote: JSON.parse(decoder.decode(bytes)) };
}
async function finishNativeTask(env, payload, manifest, initialResponse, state) {
  let response = initialResponse;
  let remote;
  let taskId = state.upstreamTaskId;
  let status = "running";
  const polling = manifest.polling;
  if (!taskId) {
    const inspected = await inspectSmallResponse(response);
    response = inspected.response; remote = inspected.remote;
    if (remote === undefined) return { response, state };
    taskId = mapped(remote, polling.submitMapping, "taskId");
    status = nativeStatus(remote, polling.submitMapping, polling);
    // A documented REST endpoint may sometimes return a synchronous result.
    if (taskId === undefined || ["succeeded", "failed", "cancelled"].includes(status)) return { response: Response.json(remote, { status: response.status }), state };
    taskId = String(taskId);
    if (taskId.length > 1024) throw new Error("Invalid upstream task id");
    state = { ...state, upstreamTaskId: taskId, phase: "generating" };
    await putState(env, payload.id, state);
  }
  const deadline = Date.now() + 30 * 60_000;
  while (Date.now() < deadline) {
    await (env.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(polling.intervalMs);
    const url = polling.urlTemplate.replaceAll("__SUPER_CANVAS_CLOUD_TASK__", encodeURIComponent(taskId));
    let body;
    if (polling.body) body = JSON.stringify(replaceStrings(JSON.parse(polling.body), { __SUPER_CANVAS_CLOUD_TASK__: taskId }));
    try {
      response = await fetcher(env)(url, { method: polling.method, headers: polling.headers, ...(body ? { body } : {}), redirect: "manual", signal: AbortSignal.timeout(120_000) });
      if (response.status === 429 || response.status >= 500) { await response.body?.cancel(); continue; }
      if (!response.ok) return { response, state };
      // Preserve big Base64 outputs as a stream. The desktop evaluates the final
      // documented status and output mappings after retrieving this exact response.
      const inspected = await inspectSmallResponse(response);
      response = inspected.response; remote = inspected.remote;
      if (remote === undefined) return { response, state };
      status = nativeStatus(remote, polling.pollMapping, polling);
      if (["succeeded", "failed", "cancelled"].includes(status)) return { response: Response.json(remote, { status: response.status }), state };
    } catch { /* Status reads may be retried; the paid submission above never is. */ }
  }
  throw new Error("Upstream polling deadline exceeded");
}

async function dispatchOnce(env, payload) {
  const { id, inputPrefix, createdAt } = payload;
  const prior = await getState(env, id);
  // This marker also protects against infrastructure replay, not just ordinary retries.
  if (prior && !prior.upstreamTaskId) {
    if (["complete", "received", "uncertain", "expired"].includes(prior.state)) return prior;
    const recovered = await env.RESULTS.get(responseKey(id));
    if (recovered) {
      const state = { ...prior, state: "received", httpStatus: Number(recovered.customMetadata?.status ?? 200), expiresAt: now(env) + DAY };
      await putState(env, id, state); return state;
    }
    const state = { ...prior, state: "uncertain", error: "云端执行中断，未能确认供应商结果；已禁止自动重新提交" };
    await putState(env, id, state); return state;
  }
  if (prior && ["complete", "received", "uncertain", "expired"].includes(prior.state)) return prior;
  let state = prior ?? { state: "running", phase: "waiting_provider", createdAt, expiresAt: now(env) + DAY, contentType: "application/json" };
  const encoded = await env.RESULTS.get(`${inputPrefix}/manifest`);
  const body = await env.RESULTS.get(`${inputPrefix}/body`);
  if (!encoded || !body) throw new Error("Request upload is incomplete");
  const manifest = await unprotect(await encoded.text(), env.ENCRYPTION_KEY);
  state = { ...state, transport: { kind: env.submitTransportName?.(manifest.url) ?? "fetch", startedAt: now(env) } };
  await putState(env, id, state);
  try {
    let response = state.upstreamTaskId ? null : await (env.submitFetchImpl ?? fetcher(env))(manifest.url, { method: manifest.method, headers: manifest.headers,
      ...(manifest.method === "GET" ? {} : { body: body.body }), redirect: "manual", signal: AbortSignal.timeout(30 * 60_000) }, { bodyLength: body.size, maxResponseBytes: manifest.maxResponseBytes });
    if (manifest.polling && (state.upstreamTaskId || response.ok)) {
      const completed = await finishNativeTask(env, payload, manifest, response, state);
      response = completed.response; state = completed.state;
    }
    const diagnostics = {};
    for (const name of ["server", "via", "cf-ray", "x-request-id", "x-client-request-id"]) {
      const value = response.headers.get(name);
      if (value) diagnostics[name] = value.slice(0, 512);
    }
    state = { ...state, transport: { ...state.transport, receivedAt: now(env), status: response.status, headers: diagnostics } };
    if (response.ok) {
      state = { ...state, phase: "receiving" };
      await putState(env, id, state);
    }
    await storeStream(env.RESULTS, responseKey(id), response.body, manifest.maxResponseBytes, {
      customMetadata: { status: String(response.status) }, httpMetadata: { contentType: "application/json" },
    });
    const complete = { ...state, state: "received", httpStatus: response.status, contentType: response.headers.get("content-type") ?? "application/json",
      expiresAt: now(env) + DAY };
    await putState(env, id, complete); return complete;
  } catch {
    const uncertain = { ...state, state: "uncertain", error: "云端与供应商的连接中断，未收到完整结果；请核对账单，不会自动重新生成", expiresAt: now(env) + DAY };
    await putState(env, id, uncertain); return uncertain;
  } finally { await env.RESULTS.delete([`${inputPrefix}/body`, `${inputPrefix}/manifest`]); }
}
export async function purgeJob(env, payload) {
  // Delete the image, references and prompt; only a non-sensitive expired marker remains.
  const prefix = `jobs/${payload.id}/`;
  let cursor;
  do {
    const list = await env.RESULTS.list({ prefix, ...(cursor ? { cursor } : {}) });
    const keys = list.objects.map(object => object.key).filter(key => key !== stateKey(payload.id));
    if (keys.length) await env.RESULTS.delete(keys);
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  await env.RESULTS.delete([`${payload.inputPrefix}/body`, `${payload.inputPrefix}/manifest`]);
  await putState(env, payload.id, { state: "expired", expiresAt: now(env) });
}
export async function executeGeneration(env, payload, step) {
  let state;
  try {
    state = await step.do("submit-once-and-save-response", { retries: { limit: 0, delay: "1 second", backoff: "constant" }, timeout: "35 minutes" }, () => dispatchOnce(env, payload));
  } catch {
    state = { state: "uncertain", error: "云端运行中断，禁止自动重发", expiresAt: now(env) + DAY };
    await putState(env, payload.id, state);
  }
  if (state.state === "received") {
    try {
      state = await step.do("archive-image-links", { retries: { limit: 5, delay: "1 minute", backoff: "exponential" }, timeout: "10 minutes" }, async () => {
        const saved = await env.RESULTS.get(responseKey(payload.id));
        if (!saved) throw new Error("Saved response missing");
        const replacements = state.httpStatus >= 200 && state.httpStatus < 300 ? await archiveLinkedImages(env, payload.id, saved) : {};
        const complete = { ...state, state: "complete", replacements, completedAt: now(env), expiresAt: now(env) + DAY };
        await putState(env, payload.id, complete);
        const { replacements: _privateLinks, ...summary } = complete;
        return summary;
      });
    } catch {
      state = { ...state, state: "uncertain", error: "供应商已返回结果，但云端图片保存失败；已保留原响应，不会重新生成" };
      await putState(env, payload.id, state);
    }
  }
  await step.sleepUntil("retain-result-for-24-hours", new Date(state.expiresAt));
  await step.do("delete-expired-content", { retries: { limit: 10, delay: "1 minute", backoff: "exponential" } }, () => purgeJob(env, payload));
  return { id: payload.id, state: "expired" };
}

