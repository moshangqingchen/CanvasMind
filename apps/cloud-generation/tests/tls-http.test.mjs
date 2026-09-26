import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { fetchViaTls, usesDirectTls } from "../src/tls-http.mjs";

const encoder = new TextEncoder();
function fixture(input, { open, read } = {}) {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  const sent = []; let calls = 0; let closes = 0; let offset = 0; let control;
  const connect = (address, options) => {
    assert.deepEqual(address, { hostname: "asian-acc.we-token.cc", port: 443 });
    assert.deepEqual(options, { secureTransport: "on" }); calls++;
    return {
      opened: open ?? Promise.resolve(), closed: Promise.resolve(),
      writable: new WritableStream({ write(bytes) { sent.push(bytes); } }),
      readable: new ReadableStream({ start(c) { control = c; }, async pull(c) {
        if (read) await read;
        if (offset >= bytes.length) c.close();
        else { const size = Math.min(bytes.length - offset, (offset % 11) + 1); c.enqueue(bytes.subarray(offset, offset + size)); offset += size; }
      } }),
      async close() { closes++; try { control.error(new Error("closed")); } catch {} },
    };
  };
  return { connect, sent: () => Buffer.concat(sent), calls: () => calls, closes: () => closes };
}
const url = "https://asian-acc.we-token.cc/v1/images/generations?q=a%20b";
const get = (f, options = {}, limits = {}) => fetchViaTls(f.connect, url, { method: "GET", ...options }, { bodyLength: 0, maxResponseBytes: 1024 * 1024, ...limits });

test("direct TLS is selected only for exact We-AI hostnames", () => {
  for (const host of ["asian-acc.we-token.cc", "us-la.we-token.cc", "sub2api.we-token.cc"]) assert.equal(usesDirectTls(`https://${host}/v1/images/generations`), true);
  assert.equal(usesDirectTls("https://asian-acc.we-token.cc.evil.com/v1/images/generations"), false);
  assert.equal(usesDirectTls("https://api.openai.com/v1/images/generations"), false);
});
test("fragmented HTTP headers and UTF-8 body preserve the exact paid request", async () => {
  const body = JSON.stringify({ prompt: "测试", quality: "max", size: "2880x2880", response_format: "url" });
  const response = JSON.stringify({ data: [{ url: "https://cdn.example.com/a.png" }] });
  const f = fixture(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(response)}\r\nX-Request-ID: original-id\r\n\r\n${response}`);
  const r = await get(f, { method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json", host: "wrong.example", "transfer-encoding": "chunked" }, body: new Response(body).body }, { bodyLength: Buffer.byteLength(body) });
  assert.equal(await r.text(), response); assert.equal(r.headers.get("x-request-id"), "original-id");
  const sent = f.sent().toString();
  assert.ok(sent.startsWith("POST /v1/images/generations?q=a%20b HTTP/1.1\r\n"));
  assert.ok(sent.includes(`content-length: ${Buffer.byteLength(body)}\r\n`));
  assert.ok(sent.includes("host: asian-acc.we-token.cc\r\n"));
  assert.ok(sent.includes("accept-encoding: identity\r\n"));
  assert.ok(sent.includes("authorization: Bearer test\r\n"));
  assert.ok(!sent.includes("transfer-encoding")); assert.equal(sent.split("\r\n\r\n")[1], body);
  assert.equal(f.calls(), 1); assert.equal(f.closes(), 1);
});
test("chunked bodies, extensions, trailers, and informational responses are decoded", async () => {
  const f = fixture("HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3;foo=bar\r\nabc\r\n2\r\nde\r\n0\r\nX-Trailer: done\r\n\r\n");
  const r = await get(f); assert.equal(await r.text(), "abcde"); assert.equal(r.headers.has("transfer-encoding"), false); assert.equal(f.closes(), 1);
});
test("close-delimited errors and compressed response bodies remain readable", async () => {
  const f = fixture("HTTP/1.0 524 Timeout\r\nContent-Type: text/plain\r\n\r\nerror code: 524\n");
  const r = await get(f); assert.equal(r.status, 524); assert.equal(await r.text(), "error code: 524\n");
  const compressed = gzipSync('{"data":[]}');
  const g = fixture(Buffer.concat([Buffer.from(`HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: ${compressed.length}\r\n\r\n`), compressed]));
  assert.deepEqual(await (await get(g)).json(), { data: [] });
});
test("truncated, oversized and ambiguous bodies fail without a second submission", async () => {
  for (const response of [
    "HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nabc",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nabc",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabcXX0\r\n\r\n",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Length: 3\r\n\r\nabc",
    "HTTP/1.1 200 OK\r\nContent-Length: 3, 5\r\n\r\nabc",
    "HTTP/1.1 200 OK\r\nContent-Length: 2000000\r\n\r\n",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n200000\r\n",
  ]) {
    const f = fixture(response); await assert.rejects(async () => (await get(f)).text()); assert.equal(f.calls(), 1); assert.equal(f.closes(), 1);
  }
});
test("abort during connect, headers and body closes the socket without retry", async () => {
  for (const stage of ["connect", "headers", "body"]) {
    const abort = new AbortController(); let release;
    const blocked = new Promise(resolve => { release = resolve; });
    const f = fixture("HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\ntest", stage === "connect" ? { open: blocked } : stage === "headers" ? { read: blocked } : {});
    const result = get(f, { signal: abort.signal });
    if (stage === "body") { const response = await result; abort.abort(); await assert.rejects(response.text()); }
    else { abort.abort(); await assert.rejects(result); }
    release(); assert.equal(f.calls(), 1); assert.equal(f.closes(), 1);
  }
});
test("response cancellation and empty responses release the connection", async () => {
  const f = fixture("HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n0123456789");
  await (await get(f)).body.cancel(); assert.equal(f.closes(), 1);
  const empty = fixture("HTTP/1.1 204 No Content\r\n\r\n");
  assert.equal((await get(empty)).body, null); assert.equal(empty.closes(), 1);
});

test("multipart edits are streamed byte-for-byte and a failed upload is never retried", async () => {
  const file = new Uint8Array(128 * 1024 + 3).map((_, i) => i % 256);
  const form = new FormData(); form.set("image", new Blob([file]), "reference.png"); form.set("quality", "max");
  const request = new Request(url, { method: "POST", body: form });
  const bytes = new Uint8Array(await request.arrayBuffer());
  const f = fixture("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}");
  await (await get(f, { method: "POST", headers: request.headers, body: new Response(bytes).body }, { bodyLength: bytes.length })).text();
  const sent = f.sent(); const start = sent.indexOf("\r\n\r\n") + 4;
  assert.deepEqual(sent.subarray(start), Buffer.from(bytes)); assert.equal(f.calls(), 1);
  const failed = fixture("");
  await assert.rejects(get(failed, { method: "POST", body: new Response(bytes).body }, { bodyLength: bytes.length + 1 }), /Truncated request body/);
  assert.equal(failed.calls(), 1); assert.equal(failed.closes(), 1);
});
