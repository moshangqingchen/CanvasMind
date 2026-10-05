import { createServer } from "node:http";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { access, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createProviderAssetToken, verifyProviderAssetToken } from "@super-canvas/providers/provider-asset-token";

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

export async function startReferenceGateway({ origin, desktopToken, secret, instance, port = 3210, fetchImpl = fetch }) {
  let active = 0;
  const server = createServer(async (req, res) => {
    const reject = (status) => { res.writeHead(status, { "cache-control": "no-store" }); res.end(); };
    if (!["GET", "HEAD"].includes(req.method)) return reject(405);
    let url;
    try { url = new URL(req.url, "http://127.0.0.1"); } catch { return reject(400); }
    const match = /^\/api\/provider-assets\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
    if (!match) return reject(404);
    const id = match[1];
    if (url.searchParams.size !== 1 || !verifyProviderAssetToken({ assetId: id, secret, token: url.searchParams.get("token") || "" })) return reject(403);
    if (id === "_health") {
      res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
      return res.end(req.method === "HEAD" ? undefined : instance);
    }
    if (active >= 16) return reject(429);
    active++;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 120_000);
    let finished = false;
    const finish = () => { if (!finished) { finished = true; active--; clearTimeout(timeout); abort.abort(); } };
    res.once("close", finish);
    try {
      const headers = { "x-supercanvas-desktop-token": desktopToken };
      if (req.headers.range && /^bytes=(?:\d+-\d*|-\d+)$/.test(req.headers.range)) headers.range = req.headers.range;
      // The target and authentication are app-owned. No incoming header, query,
      // redirect or arbitrary path can reach management APIs.
      const response = await fetchImpl(new URL(`/api/assets/${encodeURIComponent(id)}/content`, origin),
        { method: req.method, headers, redirect: "error", signal: abort.signal });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 416) {
          const contentRange = response.headers.get("content-range");
          if (contentRange && /^bytes \*\/\d+$/.test(contentRange)) res.setHeader("content-range", contentRange);
          res.setHeader("accept-ranges", "bytes");
        }
        return reject(response.status === 404 ? 404 : response.status === 416 ? 416 : 502);
      }
      const outgoing = { "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "referrer-policy": "no-referrer" };
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const value = response.headers.get(name); if (value) outgoing[name] = value;
      }
      res.writeHead(response.status, outgoing);
      if (req.method === "HEAD" || !response.body) { await response.body?.cancel(); res.end(); }
      else Readable.fromWeb(response.body).on("error", () => res.destroy()).pipe(res);
    } catch { if (!res.headersSent) reject(502); else res.destroy(); }
    finally { if (res.writableEnded) finish(); }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return { port: server.address().port, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
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
  constructor({ root, protect, unprotect, onState = () => {}, spawnImpl = spawn, fetchImpl = fetch }) {
    Object.assign(this, { root, protect, unprotect, onState, spawnImpl, fetchImpl });
    this.config = { enabled: false }; this.phase = "disabled"; this.instance = randomUUID(); this.epoch = 0;
    this.statusPath = join(root, "profile", "reference-channel-status.json");
    this.configPath = join(root, "profile", "reference-channel.bin");
    this.pendingWrite = Promise.resolve();
  }
  snapshot() { return { enabled: this.config.enabled, baseUrl: this.config.baseUrl || "", tokenConfigured: Boolean(this.config.tunnelToken), phase: this.phase, message: this.message || "", port: 3210 }; }
  async publish(phase, message = "") {
    this.phase = phase; this.message = message;
    const data = JSON.stringify({ enabled: this.config.enabled, ready: phase === "ready", baseUrl: this.config.baseUrl || "", instance: this.instance, updatedAt: Date.now() });
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
      this.gateway = await startReferenceGateway({ ...runtime, instance: this.instance });
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
    try {
      const url = new URL("/api/provider-assets/_health", this.config.baseUrl);
      url.searchParams.set("token", createProviderAssetToken({ assetId: "_health", secret: this.runtime.secret, expiresInSeconds: 30 }));
      const response = await this.fetchImpl(url, { cache: "no-store", redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
      const ok = await matchesHealthResponse(response, this.instance);
      if (epoch === this.epoch) await this.publish(ok ? "ready" : "connecting", ok ? "素材通道已连通，参考链接有效期为 1 小时" : "等待公网连接，请检查隧道是否指向本机 3210 端口");
    } catch { if (epoch === this.epoch) await this.publish("connecting", "暂时无法从公网访问，正在重试…"); }
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
