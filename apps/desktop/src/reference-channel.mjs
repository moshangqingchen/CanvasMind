import { createServer } from "node:http";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { access, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createProviderAssetToken, verifyProviderAssetToken } from "@super-canvas/providers/provider-asset-token";
import { createLoopbackOriginFetch } from "./reference-origin-http.mjs";

const HEALTH_TIMEOUT_MS = 12_000;
const HEALTH_ATTEMPTS = 2;
const NETWORK_ERROR_CODES = new Set([
  "ERR_REFERENCE_LENGTH_MISMATCH", "ERR_REFERENCE_LENGTH_INVALID", "ERR_STREAM_PREMATURE_CLOSE",
  "ERR_LOOPBACK_ORIGIN_INVALID", "ERR_LOOPBACK_TARGET_INVALID", "ERR_LOOPBACK_REDIRECT", "ERR_LOOPBACK_ENCODING",
  "ERR_LOOPBACK_STATUS", "ERR_LOOPBACK_RESPONSE", "ERR_LOOPBACK_REQUEST",
  "ERR_HTTP2_PROTOCOL_ERROR", "ERR_HTTP2_STREAM_ERROR", "ERR_QUIC_PROTOCOL_ERROR",
  "ERR_CONNECTION_CLOSED", "ERR_CONNECTION_RESET", "ERR_CONNECTION_ABORTED", "ERR_ABORTED",
  "ERR_CONTENT_LENGTH_MISMATCH", "ERR_CONTENT_DECODING_FAILED", "ERR_INCOMPLETE_CHUNKED_ENCODING",
  "ERR_NETWORK_CHANGED", "ERR_TIMED_OUT", "ERR_NAME_NOT_RESOLVED", "ERR_TUNNEL_CONNECTION_FAILED",
  "ERR_SSL_PROTOCOL_ERROR", "ERR_CERT_AUTHORITY_INVALID", "ERR_CERT_DATE_INVALID", "ERR_CERT_COMMON_NAME_INVALID", "ERR_FAILED",
  "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
  "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_SSL_WRONG_VERSION_NUMBER",
]);

/** @typedef {"timeout" | "dns" | "tls" | "network" | "http" | "unexpected_response"} ReferenceChannelFailureKind */
/**
 * @typedef {object} ReferenceChannelDiagnostic
 * @property {"health" | "asset"} stage
 * @property {"ready" | "unreachable" | "http_error" | "transfer_failed" | "transferred"} outcome
 * @property {number} durationMs
 * @property {ReferenceChannelFailureKind} [kind]
 * @property {ReferenceChannelFailureKind} [recoveredFrom]
 * @property {number} [status]
 * @property {number} [attempts]
 * @property {number} [checkedAt]
 * @property {number} [lastSuccessAt]
 * @property {"local_origin" | "public_probe"} [source]
 * @property {number} [expectedBytes] Comparable, unencoded upstream Content-Length.
 * @property {number} [actualBytes] Bytes read from the source, not a remote receipt acknowledgement.
 * @property {boolean} [requestComplete] Whether Node received the complete incoming request.
 * @property {string} [errorCode] A code from the fixed NETWORK_ERROR_CODES allowlist.
 */

// Never retain exception messages, request URLs or cloudflared stderr: any of
// them can contain credentials. Diagnostics contain only our own categories.
export function referenceChannelErrorCode(error) {
  for (let current = error, depth = 0; current && depth < 4; current = current.cause, depth++) {
    if (NETWORK_ERROR_CODES.has(current.code)) return current.code;
    // Electron puts Chromium's code in the entire message (net::ERR_*).
    // Do not extract a code embedded in a URL or arbitrary exception text.
    const exact = /^(?:net::)?(ERR_[A-Z0-9_]+)$/.exec(String(current.message || ""));
    if (exact && NETWORK_ERROR_CODES.has(exact[1])) return exact[1];
  }
}

function networkFailureKind(error) {
  if (["ERR_REFERENCE_LENGTH_MISMATCH", "ERR_REFERENCE_LENGTH_INVALID"].includes(referenceChannelErrorCode(error))) return "unexpected_response";
  for (let current = error, depth = 0; current && depth < 4; current = current.cause, depth++) {
    if (current.name === "TimeoutError" || ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(current.code)) return "timeout";
    if (["ENOTFOUND", "EAI_AGAIN"].includes(current.code)) return "dns";
    if (["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_SSL_WRONG_VERSION_NUMBER"].includes(current.code)) return "tls";
  }
  return "network";
}

/** @param {(value: ReferenceChannelDiagnostic) => void | Promise<void>} callback
 * @param {ReferenceChannelDiagnostic} diagnostic */
function emitDiagnostic(callback, diagnostic) {
  try { void Promise.resolve(callback(diagnostic)).catch(() => {}); } catch {}
}

export function referenceConfiguration(input, previous = {}) {
  if (!input || typeof input.enabled !== "boolean") throw new Error("素材通道设置无效");
  if (!input.enabled) return { ...previous, enabled: false };
  const url = new URL(String(input.baseUrl || ""));
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash ||
      !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname) || /\.(?:localhost|local|internal)$/i.test(url.hostname))
    throw new Error("请填写完整的公网 HTTPS 域名，不包含路径或端口");
  const supplied = String(input.tunnelToken || "").trim();
  const token = supplied.replace(/^cloudflared(?:\.exe)?\s+service\s+install\s+/i, "") || previous.tunnelToken;
  try {
    if (!token || token.length > 4096 || !/^[A-Za-z0-9+/=_-]+$/.test(token)) throw new Error();
    const decoded = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
    if (!/^[a-f0-9]{32}$/i.test(decoded.a) || !/^[a-f0-9-]{36}$/i.test(decoded.t) || typeof decoded.s !== "string" || decoded.s.length < 16) throw new Error();
  } catch { throw new Error("隧道凭据无效，请粘贴 Cloudflare 的安装命令或现有 Tunnel Token"); }
  return { enabled: true, baseUrl: url.origin, tunnelToken: token };
}

export async function startReferenceGateway({ origin, desktopToken, secret, instance, port = 3210, fetchImpl,
  publicBaseUrl, publicFetchImpl, onDiagnostic = () => {} }) {
  // Keep local source reads off the built-in Undici network parser: a paused
  // body followed by socket EOF can assert in Electron's bundled version.
  const fetchOrigin = fetchImpl ?? createLoopbackOriginFetch({ origin, desktopToken });
  // This private relay lets the runtime use Electron's existing system/PAC
  // network path without exposing an arbitrary URL proxy or changing providers.
  const publicUrl = publicBaseUrl ? new URL(publicBaseUrl) : undefined;
  if (publicUrl && (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password || publicUrl.port ||
      publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash)) throw new Error("公网探测地址无效");
  const publicOrigin = publicUrl?.origin;
  const publicProbe = Boolean(publicOrigin && publicFetchImpl);
  let active = 0;
  const server = createServer(async (req, res) => {
    const reject = (status) => { res.writeHead(status, { "cache-control": "no-store" }); res.end(); };
    if (!["GET", "HEAD"].includes(req.method)) return reject(405);
    let url;
    try { url = new URL(req.url, "http://127.0.0.1"); } catch { return reject(400); }
    const privateMatch = /^\/api\/reference-channel-probe\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
    const isPublicProbe = Boolean(privateMatch);
    const match = privateMatch || /^\/api\/provider-assets\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
    if (!match) return reject(404);
    if (isPublicProbe) {
      if (!publicProbe) return reject(404);
      const supplied = req.headers["x-supercanvas-desktop-token"];
      if (typeof desktopToken !== "string" || !desktopToken || typeof supplied !== "string" ||
          Buffer.byteLength(supplied) !== Buffer.byteLength(desktopToken) ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(desktopToken))) return reject(403);
    }
    const id = match[1];
    if (url.searchParams.size !== 1 || !verifyProviderAssetToken({ assetId: id, secret, token: url.searchParams.get("token") || "" })) return reject(403);
    if (id === "_health" && !isPublicProbe) {
      res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
      return res.end(req.method === "HEAD" ? undefined : instance);
    }
    if (active >= 16) return reject(429);
    active++;
    const startedAt = Date.now();
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 120_000);
    const source = isPublicProbe ? "public_probe" : "local_origin";
    let response, status, expectedBytes, actualBytes = 0;
    let finished = false;
    const finish = () => { if (!finished) { finished = true; active--; clearTimeout(timeout); abort.abort(); } };
    res.once("close", finish);
    try {
      // A single local response must finish independently of keep-alive EOF
      // handling when the public consumer applies backpressure.
      const headers = { "x-supercanvas-desktop-token": desktopToken, "accept-encoding": "identity", connection: "close" };
      if (!isPublicProbe && req.headers.range && /^bytes=(?:\d+-\d*|-\d+)$/.test(req.headers.range)) headers.range = req.headers.range;
      // The target and authentication are app-owned. No incoming header, query,
      // redirect or arbitrary path can reach management APIs.
      if (isPublicProbe) {
        const target = new URL(`/api/provider-assets/${encodeURIComponent(id)}`, publicOrigin);
        target.search = url.search;
        response = await publicFetchImpl(target, { method: req.method, headers: { "accept-encoding": "identity" }, credentials: "omit", cache: "no-store",
          redirect: "error", signal: abort.signal });
      } else {
        response = await fetchOrigin(new URL(`/api/assets/${encodeURIComponent(id)}/content`, origin),
          { method: req.method, headers, redirect: "error", signal: abort.signal });
      }
      status = response.status;
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        emitDiagnostic(onDiagnostic, { stage: "asset", outcome: "http_error", source, status, requestComplete: req.complete, durationMs: Date.now() - startedAt });
        if (response.status === 416) {
          const contentRange = response.headers.get("content-range");
          if (contentRange && /^bytes \*\/\d+$/.test(contentRange)) res.setHeader("content-range", contentRange);
          res.setHeader("accept-ranges", "bytes");
        }
        return reject(isPublicProbe ? response.status : response.status === 404 ? 404 : response.status === 416 ? 416 : 502);
      }
      const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
      const decoded = Boolean(encoding && encoding !== "identity");
      const length = decoded ? null : response.headers.get("content-length");
      if (length !== null) {
        if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))
          throw Object.assign(new Error("Invalid reference response length"), { code: "ERR_REFERENCE_LENGTH_INVALID" });
        expectedBytes = Number(length);
      }
      const outgoing = { "cache-control": "private, no-store, no-transform", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "referrer-policy": "no-referrer" };
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const value = response.headers.get(name);
        // Fetch-based public reads or explicit overrides can decode bodies.
        // Never advertise their compressed wire length for decoded bytes.
        if (name === "content-length" && decoded) continue;
        if (value) outgoing[name] = value;
      }
      res.writeHead(response.status, outgoing);
      if (req.method === "HEAD") { void response.body?.cancel().catch(() => {}); res.end(); }
      else {
        const mismatch = () => Object.assign(new Error("Incomplete reference response"), { code: "ERR_REFERENCE_LENGTH_MISMATCH" });
        if (!response.body && expectedBytes > 0) throw mismatch();
        const counter = new Transform({
          transform(chunk, _encoding, callback) {
            actualBytes += chunk.byteLength;
            callback(expectedBytes !== undefined && actualBytes > expectedBytes ? mismatch() : null, chunk);
          },
          flush(callback) { callback(expectedBytes !== undefined && actualBytes !== expectedBytes ? mismatch() : null); },
        });
        await pipeline(response.body ? Readable.fromWeb(response.body) : Readable.from([]), counter, res);
        emitDiagnostic(onDiagnostic, { stage: "asset", outcome: "transferred", source, status, actualBytes, requestComplete: req.complete,
          ...(expectedBytes === undefined ? {} : { expectedBytes }), durationMs: Date.now() - startedAt });
      }
    } catch (error) {
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
      const errorCode = referenceChannelErrorCode(error);
      emitDiagnostic(onDiagnostic, { stage: "asset", outcome: "transfer_failed", source, kind: networkFailureKind(error), actualBytes, requestComplete: req.complete,
        ...(status === undefined ? {} : { status }), ...(expectedBytes === undefined ? {} : { expectedBytes }),
        ...(errorCode ? { errorCode } : {}), durationMs: Date.now() - startedAt });
      if (!res.headersSent) reject(502); else res.destroy();
    }
    finally { if (res.writableEnded) finish(); }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return { port: server.address().port, publicProbe, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}

async function matchesHealthResponse(response, instance) {
  if (!response.ok) { void response.body?.cancel().catch(() => {}); return false; }
  const reader = response.body?.getReader();
  if (!reader) return false;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks).toString("utf8") === instance;
      size += value.byteLength;
      // The gateway replies with a UUID. Do not buffer a proxy error page.
      if (size > 512) return false;
      chunks.push(value);
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export class ReferenceChannel {
  constructor({ root, protect, unprotect, onState = () => {}, onDiagnostic = () => {}, spawnImpl = spawn, fetchImpl = fetch, gatewayImpl = startReferenceGateway }) {
    Object.assign(this, { root, protect, unprotect, onState, onDiagnostic, spawnImpl, fetchImpl, gatewayImpl });
    this.config = { enabled: false }; this.phase = "disabled"; this.instance = randomUUID(); this.epoch = 0;
    this.statusPath = join(root, "profile", "reference-channel-status.json");
    this.configPath = join(root, "profile", "reference-channel.bin");
    this.pendingWrite = Promise.resolve();
  }
  snapshot() { return { enabled: this.config.enabled, baseUrl: this.config.baseUrl || "", tokenConfigured: Boolean(this.config.tunnelToken), phase: this.phase, message: this.message || "", port: 3210, ...(this.diagnostics ? { diagnostics: { ...this.diagnostics } } : {}) }; }
  async publish(phase, message = "") {
    this.phase = phase; this.message = message;
    const data = JSON.stringify({ enabled: this.config.enabled, ready: phase === "ready", baseUrl: this.config.baseUrl || "", instance: this.instance, updatedAt: Date.now(),
      ...(this.gateway?.publicProbe ? { desktopPublicProbe: true } : {}), ...(this.diagnostics ? { diagnostics: this.diagnostics } : {}) });
    this.pendingWrite = this.pendingWrite.catch(() => {}).then(async () => {
      await writeFile(`${this.statusPath}.tmp`, data); await rename(`${this.statusPath}.tmp`, this.statusPath);
    });
    await this.pendingWrite; this.onState(this.snapshot());
  }
  async load() {
    try { const saved = JSON.parse(await this.unprotect(await readFile(this.configPath))); this.config = referenceConfiguration(saved, saved); }
    catch (error) { if (error.code !== "ENOENT") this.message = "素材通道配置无法读取，请重新保存"; }
    await this.publish("disabled", this.message);
  }
  async configure(input) {
    const next = referenceConfiguration(input, this.config);
    const bytes = await this.protect(JSON.stringify(next));
    await writeFile(`${this.configPath}.tmp`, bytes); await rename(`${this.configPath}.tmp`, this.configPath);
    this.config = next;
    await this.start(this.runtime);
    return this.snapshot();
  }
  async start(runtime) {
    await this.stop(); this.runtime = runtime;
    if (!runtime || !this.config.enabled) return;
    const epoch = this.epoch;
    try {
      await this.publish("connecting", "正在连接现有隧道…");
      this.gateway = await this.gatewayImpl({ ...runtime, instance: this.instance, onDiagnostic: this.onDiagnostic,
        publicBaseUrl: this.config.baseUrl, publicFetchImpl: this.fetchImpl });
      const candidates = [join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "cloudflared/cloudflared.exe"), join(process.env.ProgramFiles || "C:/Program Files", "cloudflared/cloudflared.exe")];
      let executable;
      for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
      if (!executable) throw new Error("请先安装 Cloudflare 官方 cloudflared 客户端");
      const env = { TUNNEL_TOKEN: this.config.tunnelToken };
      for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) if (process.env[key]) env[key] = process.env[key];
      this.child = this.spawnImpl(executable, ["tunnel", "--no-autoupdate", "run"], { env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      this.child.stderr.on("data", () => {}); // Never retain credentials or signed URLs in logs.
      const failed = message => {
        if (epoch !== this.epoch) return;
        this.epoch++; clearInterval(this.timer);
        this.abortCheck();
        void this.publish("error", message);
      };
      this.child.once("error", () => failed("隧道客户端启动失败"));
      this.child.once("exit", () => failed("隧道已停止，请重新连接"));
      this.timer = setInterval(() => void this.check(epoch), 15_000);
      void this.check(epoch);
    } catch (error) { await this.stop(); await this.publish("error", error.code === "EADDRINUSE" ? "素材通道端口 3210 已被其他程序占用" : error.message); }
  }
  async check(epoch = this.epoch) {
    if (this.checkRequest || epoch !== this.epoch || !this.gateway || !this.runtime) return;
    const controller = new AbortController();
    this.checkRequest = controller;
    const startedAt = Date.now();
    try {
      let failure;
      let attempts = 0;
      for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++) {
        if (epoch !== this.epoch || controller.signal.aborted) return;
        attempts = attempt;
        const timeoutSignal = AbortSignal.timeout(HEALTH_TIMEOUT_MS);
        let response, ok;
        try {
          // A retry gets its own short-lived signature and timeout budget.
          const url = new URL("/api/provider-assets/_health", this.config.baseUrl);
          url.searchParams.set("token", createProviderAssetToken({ assetId: "_health", secret: this.runtime.secret, expiresInSeconds: 30 }));
          response = await this.fetchImpl(url, { cache: "no-store", redirect: "error", signal: AbortSignal.any([controller.signal, timeoutSignal]) });
          ok = await matchesHealthResponse(response, this.instance);
        } catch (error) {
          if (epoch !== this.epoch || controller.signal.aborted) return;
          failure = { kind: timeoutSignal.aborted ? "timeout" : networkFailureKind(error) };
          continue;
        }
        if (epoch !== this.epoch || controller.signal.aborted) return;
        if (ok) {
          const checkedAt = Date.now();
          this.diagnostics = { outcome: "ready", checkedAt, lastSuccessAt: checkedAt, durationMs: checkedAt - startedAt, attempts: attempt, ...(failure ? { recoveredFrom: failure.kind } : {}) };
          emitDiagnostic(this.onDiagnostic, { stage: "health", ...this.diagnostics });
          await this.publish("ready", "素材通道已连通，参考链接有效期为 1 小时");
          return;
        }
        failure = response.ok ? { kind: "unexpected_response" } : { kind: "http", status: response.status };
        // Credentials, routing and a different app instance will not improve
        // with an immediate retry. Only transient HTTP failures get one.
        if (response.ok || ![408, 429].includes(response.status) && response.status < 500) break;
      }
      // A failed bounded round always clears ready; old success is diagnostic
      // history, never an indefinitely renewed claim of public reachability.
      const checkedAt = Date.now();
      this.diagnostics = { outcome: "unreachable", checkedAt, ...(this.diagnostics?.lastSuccessAt ? { lastSuccessAt: this.diagnostics.lastSuccessAt } : {}), durationMs: checkedAt - startedAt, attempts, ...failure };
      emitDiagnostic(this.onDiagnostic, { stage: "health", ...this.diagnostics });
      const message = failure.kind === "http" ? `公网返回 HTTP ${failure.status}，正在重试…`
        : failure.kind === "unexpected_response" ? "等待公网连接，请检查隧道是否指向本机 3210 端口"
        : failure.kind === "timeout" ? "公网连接检查超时，正在重试…"
        : failure.kind === "dns" ? "素材域名解析暂时失败，正在重试…"
        : failure.kind === "tls" ? "素材域名的安全连接暂时失败，正在重试…"
        : "暂时无法从公网访问，正在重试…";
      await this.publish("connecting", message);
    }
    finally { if (this.checkRequest === controller) this.checkRequest = null; }
  }
  abortCheck() {
    this.checkRequest?.abort();
    this.checkRequest = null;
  }
  async stop() {
    this.epoch++; clearInterval(this.timer);
    this.abortCheck();
    const child = this.child; this.child = null;
    if (child && child.exitCode === null) await new Promise(resolve => { const timeout = setTimeout(resolve, 4000); child.once("exit", () => { clearTimeout(timeout); resolve(); }); child.kill(); });
    if (this.gateway) await this.gateway.close(); this.gateway = null;
    await this.publish("disabled");
  }
}
