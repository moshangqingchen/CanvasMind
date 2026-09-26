// Workers fetch() traverses Cloudflare's HTTP origin proxy, whose read timeout
// is shorter than a synchronous image generation. These DNS-only We-AI hosts
// support direct TLS; keep other suppliers on their existing fetch transport.
const DIRECT_HOSTS = new Set(["asian-acc.we-token.cc", "us-la.we-token.cc", "sub2api.we-token.cc"]);
export const usesDirectTls = value => DIRECT_HOSTS.has(new URL(value).hostname);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_HEADERS = 64 * 1024;

class HttpReader {
  constructor(reader, wait) { this.reader = reader; this.wait = wait; this.pending = new Uint8Array(); }
  async take(max = 64 * 1024) {
    while (!this.pending.length) {
      const next = await this.wait(this.reader.read());
      if (next.done) return null;
      this.pending = next.value;
    }
    const part = this.pending.subarray(0, max);
    this.pending = this.pending.subarray(part.length);
    return part;
  }
  async line(limit) {
    const chunks = []; let length = 0;
    while (true) {
      if (!this.pending.length) {
        const next = await this.wait(this.reader.read());
        if (next.done) throw new Error("Truncated HTTP headers");
        this.pending = next.value;
      }
      const newline = this.pending.indexOf(10);
      const count = newline < 0 ? this.pending.length : newline + 1;
      length += count;
      if (length > limit) throw new Error("HTTP headers too large");
      chunks.push(this.pending.subarray(0, count));
      this.pending = this.pending.subarray(count);
      if (newline >= 0) {
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        if (bytes[length - 2] !== 13) throw new Error("Invalid HTTP line ending");
        return decoder.decode(bytes.subarray(0, length - 2));
      }
    }
  }
}

// Exactly one connection and one request. Never retry a paid POST after an
// ambiguous connection failure. The caller persists its dispatched marker first.
export async function fetchViaTls(connect, value, init, { bodyLength, maxResponseBytes }) {
  const url = new URL(value);
  const method = init.method ?? "GET";
  if (url.protocol !== "https:" || url.username || url.password || url.port || !["GET", "POST", "PUT"].includes(method)) throw new Error("Invalid TLS HTTP endpoint");
  if (!Number.isSafeInteger(bodyLength) || bodyLength < 0) throw new Error("Missing request length");
  init.signal?.throwIfAborted();
  const headers = new Headers(init.headers);
  for (const name of ["transfer-encoding", "expect", "upgrade", "proxy-authorization", "proxy-connection", "trailer", "te"]) headers.delete(name);
  headers.set("host", url.hostname);
  headers.set("connection", "close");
  headers.set("accept-encoding", "identity");
  headers.set("content-length", String(method === "GET" ? 0 : bodyLength));
  const head = `${method} ${url.pathname}${url.search} HTTP/1.1\r\n${[...headers].map(([name, val]) => `${name}: ${val}\r\n`).join("")}\r\n`;
  let socket; let requestReader; let finished = false; let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  // The abort may occur between operations, when no race is listening yet.
  aborted.catch(() => {});
  const wait = promise => Promise.race([promise, aborted]);
  const close = () => {
    if (finished) return;
    finished = true;
    init.signal?.removeEventListener("abort", abort);
    void socket?.close().catch(() => {});
    void requestReader?.cancel().catch(() => {});
  };
  const abort = () => { rejectAbort(init.signal.reason ?? new Error("TLS request aborted")); close(); };
  init.signal?.addEventListener("abort", abort, { once: true });
  try {
    socket = connect({ hostname: url.hostname, port: 443 }, { secureTransport: "on" });
    socket.closed.catch(() => {});
    await wait(socket.opened);
    const writer = socket.writable.getWriter();
    try {
      await wait(writer.write(encoder.encode(head)));
      let sent = 0;
      if (method !== "GET" && init.body) {
        requestReader = init.body.getReader();
        while (true) {
          const next = await wait(requestReader.read()); if (next.done) break;
          sent += next.value.byteLength;
          if (sent > bodyLength) throw new Error("Request length mismatch");
          await wait(writer.write(next.value));
        }
        requestReader.releaseLock(); requestReader = undefined;
      }
      if (sent !== (method === "GET" ? 0 : bodyLength)) throw new Error("Truncated request body");
    } finally { writer.releaseLock(); }
    const input = new HttpReader(socket.readable.getReader(), wait);
    let status; let outgoing; let headerBytes = 0;
    do {
      const line = await input.line(MAX_HEADERS - headerBytes); headerBytes += line.length + 2;
      const match = /^HTTP\/1\.[01] ([1-5]\d\d)(?: .*|)$/.exec(line);
      if (!match || match[1] === "101") throw new Error("Invalid HTTP status");
      status = Number(match[1]); outgoing = new Headers();
      while (true) {
        const line = await input.line(MAX_HEADERS - headerBytes); headerBytes += line.length + 2;
        if (!line) break;
        const colon = line.indexOf(":");
        if (colon <= 0 || /^[ \t]/.test(line)) throw new Error("Invalid HTTP header");
        outgoing.append(line.slice(0, colon), line.slice(colon + 1).trim());
      }
    } while (status < 200);
    const transfer = outgoing.get("transfer-encoding")?.toLowerCase();
    const length = outgoing.get("content-length");
    if (transfer && transfer !== "chunked") throw new Error("Unsupported HTTP framing");
    if (transfer && length !== null) throw new Error("Ambiguous HTTP framing");
    if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw new Error("Invalid response length");
    if (length !== null && Number(length) > maxResponseBytes) throw new Error("Response too large");
    const encoding = outgoing.get("content-encoding")?.toLowerCase();
    if (encoding && !["identity", "gzip", "deflate"].includes(encoding)) throw new Error("Unsupported HTTP encoding");
    for (const name of ["connection", "transfer-encoding", "content-length", "content-encoding", "keep-alive", "trailer"]) outgoing.delete(name);
    if ([204, 205, 304].includes(status)) { close(); return new Response(null, { status, headers: outgoing }); }
    let remaining = length === null ? null : Number(length);
    let chunkRemaining = 0; let needsChunkEnd = false; let total = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          if (transfer) {
            if (!chunkRemaining) {
              if (needsChunkEnd && await input.line(2) !== "") throw new Error("Invalid chunk ending");
              const line = await input.line(8192);
              if (!/^[\da-f]+(?:;[^\r\n]*)?$/i.test(line)) throw new Error("Invalid chunk length");
              chunkRemaining = parseInt(line.split(";")[0], 16);
              if (!Number.isSafeInteger(chunkRemaining) || chunkRemaining > maxResponseBytes - total) throw new Error("Response too large");
              if (!chunkRemaining) {
                let trailerBytes = 0;
                while (true) {
                  const trailer = await input.line(MAX_HEADERS - trailerBytes); trailerBytes += trailer.length + 2;
                  if (!trailer) break;
                }
                controller.close(); close(); return;
              }
              needsChunkEnd = true;
            }
          } else if (remaining === 0) { controller.close(); close(); return; }
          const bytes = await input.take(Math.min(64 * 1024, transfer ? chunkRemaining : remaining ?? Infinity));
          if (!bytes) {
            if (transfer || remaining !== null) throw new Error("Truncated HTTP response");
            controller.close(); close(); return;
          }
          total += bytes.byteLength;
          if (total > maxResponseBytes) throw new Error("Response too large");
          if (transfer) chunkRemaining -= bytes.byteLength;
          else if (remaining !== null) remaining -= bytes.byteLength;
          controller.enqueue(bytes);
        } catch (error) { controller.error(error); close(); }
      },
      cancel() { close(); },
    });
    return new Response(encoding && encoding !== "identity" ? stream.pipeThrough(new DecompressionStream(encoding)) : stream, { status, headers: outgoing });
  } catch (error) { close(); throw error; }
}
