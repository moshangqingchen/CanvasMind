// Fixed authenticated loopback transport. Public requests use the native network stack.
import { request } from "node:http";
import { Readable } from "node:stream";

// Self-contained body: a main-process QA may serialize this factory and provide
// httpRequest/toWeb from process.getBuiltinModule('http'/'stream').
export function createLoopbackOriginFetch({ origin, desktopToken, httpRequest = request, toWeb = Readable.toWeb }) {
  const failure = code => Object.assign(new Error(code), { code });
  let base;
  try { base = new URL(origin); } catch { throw failure("ERR_LOOPBACK_ORIGIN_INVALID"); }
  if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || base.username || base.password ||
      base.pathname !== "/" || base.search || base.hash || typeof desktopToken !== "string" || !desktopToken ||
      desktopToken.length > 4096 || /[\u0000-\u001f\u007f]/u.test(desktopToken)) throw failure("ERR_LOOPBACK_ORIGIN_INVALID");

  return async function loopbackOriginFetch(input, init = {}) {
    let target;
    try { target = new URL(String(input)); } catch { throw failure("ERR_LOOPBACK_TARGET_INVALID"); }
    const method = String(init.method || "GET").toUpperCase();
    if (target.origin !== base.origin || target.username || target.password || target.search || target.hash ||
        !/^\/api\/assets\/[A-Za-z0-9_-]{1,128}\/content$/u.test(target.pathname) ||
        !["GET", "HEAD"].includes(method) || init.body != null) throw failure("ERR_LOOPBACK_TARGET_INVALID");
    const headers = { "x-supercanvas-desktop-token": desktopToken, "accept-encoding": "identity", connection: "close" };
    const range = new Headers(init.headers).get("range");
    if (range && /^bytes=(?:\d+-\d*|-\d+)$/u.test(range)) headers.range = range;

    return new Promise((resolve, reject) => {
      let req, incoming, settled = false;
      const fail = error => {
        incoming?.destroy(error);
        req?.destroy();
        if (!settled) { settled = true; reject(error); }
      };
      try {
        req = httpRequest(target, { method, headers, agent: false, signal: init.signal }, response => {
          incoming = response;
          // Keep errors observed even if cancellation beats creation of the Web
          // reader. Readable.toWeb still propagates read errors to the consumer.
          incoming.on("error", () => {});
          incoming.once("close", () => { if (!incoming.complete) req.destroy(); });
          if (settled) { incoming.destroy(); return; }
          const status = incoming.statusCode;
          if ([301, 302, 303, 307, 308].includes(status)) { fail(failure("ERR_LOOPBACK_REDIRECT")); return; }
          const encoding = String(incoming.headers["content-encoding"] || "").trim().toLowerCase();
          // node:http delivers wire bytes; unlike fetch it does not decode.
          if (encoding && encoding !== "identity") { fail(failure("ERR_LOOPBACK_ENCODING")); return; }
          if (!Number.isInteger(status) || status < 200 || status > 599) { fail(failure("ERR_LOOPBACK_STATUS")); return; }
          const responseHeaders = new Headers();
          for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "content-encoding", "connection"]) {
            const value = incoming.headers[name];
            if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
          }
          try {
            const empty = method === "HEAD" || [204, 205, 304].includes(status);
            const body = empty ? null : toWeb(incoming);
            const result = new Response(body, { status, headers: responseHeaders });
            if (empty) incoming.resume();
            settled = true;
            resolve(result);
          } catch { fail(failure("ERR_LOOPBACK_RESPONSE")); }
        });
        req.on("error", fail);
        req.once("upgrade", (response, socket) => {
          response.destroy(); socket.destroy(); fail(failure("ERR_LOOPBACK_STATUS"));
        });
        req.end();
      } catch { fail(failure("ERR_LOOPBACK_REQUEST")); }
    });
  };
}
